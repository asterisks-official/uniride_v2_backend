import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { RidesRepository } from './rides.repository';
import { NotificationsService } from '../notifications/notifications.service';
import { CreateRideDto } from './dto/create-ride.dto';
import { SearchRidesDto } from './dto/search-rides.dto';
import { UpdateRideDto } from './dto/update-ride.dto';
import { CancelRideDto } from './dto/cancel-ride.dto';
import { RequestRideDto } from './dto/request-ride.dto';
import { RespondRequestDto, RequestAction } from './dto/respond-request.dto';
import { MyRidesDto, MyRidesRole } from './dto/my-rides.dto';
import { getPaginationParams, buildPaginationMeta } from '../../shared/utils/pagination.util';
import { QUEUE_RIDE_EXPIRY, QUEUE_RIDE_COMPLETION } from '../../jobs/queue.constants';
import type { RideExpiryJobData } from '../../jobs/processors/ride-expiry.processor';
import type { RideCompletionJobData } from '../../jobs/processors/ride-completion.processor';

const GEO_BOX_DEG = 0.45; // ~50 km bounding box per side

@Injectable()
export class RidesService {
  constructor(
    private readonly ridesRepository: RidesRepository,
    private readonly notificationsService: NotificationsService,
    @InjectQueue(QUEUE_RIDE_EXPIRY) private readonly expiryQueue: Queue,
    @InjectQueue(QUEUE_RIDE_COMPLETION) private readonly completionQueue: Queue,
  ) {}

  // ── Create ─────────────────────────────────────────────────────────────────

  async createRide(riderId: string, dto: CreateRideDto) {
    const scheduledAt = new Date(dto.scheduledAt);
    if (scheduledAt <= new Date()) {
      throw new BadRequestException('scheduledAt must be a future date');
    }

    const ride = await this.ridesRepository.create({
      type: dto.type,
      originAddress: dto.originAddress,
      originLat: dto.originLat,
      originLng: dto.originLng,
      destAddress: dto.destAddress,
      destLat: dto.destLat,
      destLng: dto.destLng,
      fare: dto.fare,
      seatsAvailable: dto.seatsAvailable ?? 1,
      genderPref: dto.genderPref ?? 'ANY',
      scheduledAt,
      rider: { connect: { id: riderId } },
    });

    const delay = Math.max(0, scheduledAt.getTime() - Date.now());
    await this.expiryQueue.add('expire', { rideId: ride.id } satisfies RideExpiryJobData, {
      delay,
      jobId: `expire-${ride.id}`,
    });

    return ride;
  }

  // ── Search ─────────────────────────────────────────────────────────────────

  async searchRides(dto: SearchRidesDto) {
    const { skip, take, page, limit } = getPaginationParams(dto);

    const where: Record<string, unknown> = { status: 'SEARCHING' };

    if (dto.date) {
      const dayStart = new Date(`${dto.date}T00:00:00.000Z`);
      const dayEnd = new Date(`${dto.date}T23:59:59.999Z`);
      where['scheduledAt'] = { gte: dayStart, lte: dayEnd };
    }

    if (dto.seats) {
      where['seatsAvailable'] = { gte: dto.seats };
    }

    if (dto.genderPref) {
      where['genderPref'] = dto.genderPref;
    }

    if (dto.originLat !== undefined && dto.originLng !== undefined) {
      where['originLat'] = { gte: dto.originLat - GEO_BOX_DEG, lte: dto.originLat + GEO_BOX_DEG };
      where['originLng'] = { gte: dto.originLng - GEO_BOX_DEG, lte: dto.originLng + GEO_BOX_DEG };
    }

    if (dto.destLat !== undefined && dto.destLng !== undefined) {
      where['destLat'] = { gte: dto.destLat - GEO_BOX_DEG, lte: dto.destLat + GEO_BOX_DEG };
      where['destLng'] = { gte: dto.destLng - GEO_BOX_DEG, lte: dto.destLng + GEO_BOX_DEG };
    }

    const [rides, total] = await Promise.all([
      this.ridesRepository.findMany({
        where: where as never,
        skip,
        take,
        orderBy: { scheduledAt: 'asc' },
        include: {
          rider: {
            select: {
              id: true,
              name: true,
              profilePictureUrl: true,
              stats: { select: { averageRating: true, ridesCompleted: true } },
            },
          },
        },
      }),
      this.ridesRepository.count({ where: where as never }),
    ]);

    return { rides, pagination: buildPaginationMeta(total, page, limit) };
  }

  // ── Get one ────────────────────────────────────────────────────────────────

  async getRide(rideId: string) {
    const ride = await this.ridesRepository.findWithRelations(rideId);
    if (!ride) throw new NotFoundException('Ride not found');
    return ride;
  }

  // ── My rides ───────────────────────────────────────────────────────────────

  async getMyRides(userId: string, dto: MyRidesDto) {
    const { skip, take, page, limit } = getPaginationParams(dto);
    const role = dto.role as MyRidesRole | undefined;
    const { rides, total } = await this.ridesRepository.findMyRidesAndCount(
      userId,
      role,
      dto.status,
      skip,
      take,
    );
    return { rides, pagination: buildPaginationMeta(total, page, limit) };
  }

  // ── Update ─────────────────────────────────────────────────────────────────

  async updateRide(riderId: string, rideId: string, dto: UpdateRideDto) {
    const ride = await this.ridesRepository.findById(rideId);
    if (!ride) throw new NotFoundException('Ride not found');
    if (ride.riderId !== riderId) throw new ForbiddenException();
    if (ride.status !== 'SEARCHING') {
      throw new ConflictException('Cannot edit a matched or active ride');
    }

    if (dto.scheduledAt) {
      const scheduledAt = new Date(dto.scheduledAt);
      if (scheduledAt <= new Date()) throw new BadRequestException('scheduledAt must be a future date');
    }

    return this.ridesRepository.update(rideId, {
      ...(dto.fare !== undefined && { fare: dto.fare }),
      ...(dto.seatsAvailable !== undefined && { seatsAvailable: dto.seatsAvailable }),
      ...(dto.scheduledAt && { scheduledAt: new Date(dto.scheduledAt) }),
      ...(dto.genderPref && { genderPref: dto.genderPref }),
    });
  }

  // ── Cancel ─────────────────────────────────────────────────────────────────

  async cancelRide(riderId: string, rideId: string, dto: CancelRideDto) {
    const ride = await this.ridesRepository.findById(rideId);
    if (!ride) throw new NotFoundException('Ride not found');
    if (ride.riderId !== riderId) throw new ForbiddenException();
    if (ride.status === 'IN_PROGRESS' || ride.status === 'COMPLETED' || ride.status === 'CANCELLED') {
      throw new ConflictException(`Cannot cancel a ride with status ${ride.status}`);
    }

    await this.ridesRepository.update(rideId, {
      status: 'CANCELLED',
      cancelledAt: new Date(),
      ...(dto.reason && { cancelReason: dto.reason }),
    });

    return { message: 'Ride cancelled' };
  }

  // ── Request to join ────────────────────────────────────────────────────────

  async requestRide(passengerId: string, rideId: string, dto: RequestRideDto) {
    const ride = await this.ridesRepository.findById(rideId);
    if (!ride) throw new NotFoundException('Ride not found');
    if (ride.riderId === passengerId) throw new ForbiddenException('Cannot request your own ride');
    if (ride.status !== 'SEARCHING') {
      throw new ConflictException('Ride is not accepting requests');
    }

    const existing = await this.ridesRepository.findRequest(rideId, passengerId);
    if (existing) throw new ConflictException('Already requested this ride');

    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

    const rideRequest = await this.ridesRepository.createRequest({
      ride: { connect: { id: rideId } },
      passenger: { connect: { id: passengerId } },
      message: dto.message,
      expiresAt,
    });

    await this.notificationsService.send(
      ride.riderId,
      'RIDE_REQUEST',
      'New ride request',
      `Someone wants to join your ride to ${ride.destAddress}`,
      { rideId, requestId: rideRequest.id },
    );

    return rideRequest;
  }

  // ── Get requests ───────────────────────────────────────────────────────────

  async getRideRequests(riderId: string, rideId: string) {
    const ride = await this.ridesRepository.findById(rideId);
    if (!ride) throw new NotFoundException('Ride not found');
    if (ride.riderId !== riderId) throw new ForbiddenException();
    return this.ridesRepository.findRequests(rideId, 'PENDING');
  }

  // ── Respond to request ─────────────────────────────────────────────────────

  async respondToRequest(riderId: string, rideId: string, requestId: string, dto: RespondRequestDto) {
    const ride = await this.ridesRepository.findById(rideId);
    if (!ride) throw new NotFoundException('Ride not found');
    if (ride.riderId !== riderId) throw new ForbiddenException();
    if (ride.status !== 'SEARCHING') {
      throw new ConflictException('Ride is no longer accepting responses');
    }

    const req = await this.ridesRepository.findRequestById(requestId);
    if (!req || req.rideId !== rideId) throw new NotFoundException('Request not found');
    if (req.status !== 'PENDING') throw new ConflictException('Request is no longer pending');

    if (dto.action === RequestAction.ACCEPT) {
      await this.ridesRepository.acceptRequestTx(rideId, requestId, req.passengerId);
      await this.notificationsService.send(
        req.passengerId,
        'REQUEST_ACCEPTED',
        'Ride request accepted!',
        `Your request to join a ride to ${ride.destAddress} was accepted`,
        { rideId },
      );
      return { message: 'Request accepted — ride is now matched' };
    }

    await this.ridesRepository.updateRequest(requestId, { status: 'DECLINED' });
    await this.notificationsService.send(
      req.passengerId,
      'REQUEST_DECLINED',
      'Ride request declined',
      `Your request to join a ride to ${ride.destAddress} was not accepted`,
      { rideId },
    );
    return { message: 'Request declined' };
  }

  // ── Start ride ─────────────────────────────────────────────────────────────

  async startRide(riderId: string, rideId: string) {
    const ride = await this.ridesRepository.findById(rideId);
    if (!ride) throw new NotFoundException('Ride not found');
    if (ride.riderId !== riderId) throw new ForbiddenException();
    if (ride.status !== 'MATCHED') {
      throw new ConflictException('Ride must be matched before starting');
    }

    const updated = await this.ridesRepository.update(rideId, {
      status: 'IN_PROGRESS',
      startedAt: new Date(),
    });

    if (ride.passengerId) {
      await this.notificationsService.send(
        ride.passengerId,
        'RIDE_STARTED',
        'Your ride has started',
        `Your rider is on the way to ${ride.destAddress}`,
        { rideId },
      );
    }

    return updated;
  }

  // ── Confirm completion ─────────────────────────────────────────────────────

  async confirmRide(userId: string, rideId: string) {
    const ride = await this.ridesRepository.findById(rideId);
    if (!ride) throw new NotFoundException('Ride not found');

    const isRider = ride.riderId === userId;
    const isPassenger = ride.passengerId === userId;
    if (!isRider && !isPassenger) throw new ForbiddenException();
    if (ride.status !== 'IN_PROGRESS') {
      throw new ConflictException('Ride is not in progress');
    }

    const updateData: Record<string, unknown> = {};

    if (isRider) {
      if (ride.riderConfirmed) throw new ConflictException('Already confirmed');
      updateData['riderConfirmed'] = true;
    } else {
      if (ride.passengerConfirmed) throw new ConflictException('Already confirmed');
      updateData['passengerConfirmed'] = true;
    }

    const newRiderConfirmed = isRider ? true : ride.riderConfirmed;
    const newPassengerConfirmed = isPassenger ? true : ride.passengerConfirmed;

    const bothConfirmed = newRiderConfirmed && newPassengerConfirmed;
    if (bothConfirmed) {
      updateData['status'] = 'COMPLETED';
      updateData['completedAt'] = new Date();
    }

    const result = await this.ridesRepository.update(rideId, updateData as never);

    if (bothConfirmed) {
      await this.completionQueue.add(
        'process',
        { rideId } satisfies RideCompletionJobData,
      );

      const notifyBoth = [ride.riderId, ride.passengerId].filter(Boolean) as string[];
      await Promise.all(
        notifyBoth.map((uid) =>
          this.notificationsService.send(
            uid,
            'RIDE_COMPLETED',
            'Ride completed',
            `Your ride to ${ride.destAddress} is complete. Please rate your experience.`,
            { rideId },
          ),
        ),
      );
    }

    return result;
  }
}
