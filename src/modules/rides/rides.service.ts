import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import type {
  ActiveMode,
  Gender,
  GenderPreference,
  UserRole,
} from '@prisma/client';
import { RidesRepository } from './rides.repository';
import { NotificationsService } from '../notifications/notifications.service';
import { CreateRideDto } from './dto/create-ride.dto';
import { SearchRidesDto } from './dto/search-rides.dto';
import { UpdateRideDto } from './dto/update-ride.dto';
import { CancelRideDto } from './dto/cancel-ride.dto';
import { RequestRideDto } from './dto/request-ride.dto';
import { RespondRequestDto, RequestAction } from './dto/respond-request.dto';
import { MyRidesDto } from './dto/my-rides.dto';
import {
  getPaginationParams,
  buildPaginationMeta,
} from '../../shared/utils/pagination.util';
import {
  QUEUE_RIDE_EXPIRY,
  QUEUE_RIDE_COMPLETION,
} from '../../jobs/queue.constants';
import type { RideExpiryJobData } from '../../jobs/processors/ride-expiry.processor';
import type { RideCompletionJobData } from '../../jobs/processors/ride-completion.processor';

const GEO_BOX_DEG = 0.45; // ~50 km bounding box per side

/// The gender preferences a user of this gender is allowed to see and join.
///
/// One rule, used by the feed, the ride detail and the join check, so those
/// three can never disagree about who a restricted ride is for. They did
/// disagree: joining was enforced while the feed showed a female-only ride to
/// every man on the platform, complete with the poster's name, pickup area and
/// departure time — exposing precisely the people the preference protects.
///
/// Fails closed. A user with no gender recorded sees unrestricted rides only,
/// and `OTHER` is not treated as satisfying a female- or male-only ride; that
/// last point is a product call inherited from the join check, kept here so
/// both behave identically.
export function visibleGenderPrefs(
  gender: Gender | null,
): GenderPreference[] {
  switch (gender) {
    case 'FEMALE':
      return ['ANY', 'FEMALE_ONLY'];
    case 'MALE':
      return ['ANY', 'MALE_ONLY'];
    default:
      return ['ANY'];
  }
}

@Injectable()
export class RidesService {
  constructor(
    private readonly ridesRepository: RidesRepository,
    private readonly notificationsService: NotificationsService,
    @InjectQueue(QUEUE_RIDE_EXPIRY) private readonly expiryQueue: Queue,
    @InjectQueue(QUEUE_RIDE_COMPLETION) private readonly completionQueue: Queue,
  ) {}

  // ── Create ─────────────────────────────────────────────────────────────────

  async createRide(riderId: string, role: UserRole, dto: CreateRideDto) {
    // Role ↔ post-type integrity: drivers offer rides, passengers request them.
    if (dto.type === 'OFFER' && role !== 'RIDER') {
      throw new ForbiddenException(
        'Only verified riders can offer a ride. Complete rider verification first.',
      );
    }
    if (dto.type === 'REQUEST' && role !== 'PASSENGER') {
      throw new ForbiddenException('Only passengers can request a ride.');
    }

    const scheduledAt = new Date(dto.scheduledAt);
    if (scheduledAt <= new Date()) {
      throw new BadRequestException('scheduledAt must be a future date');
    }

    // The creator occupies the side matching their role; the other side is
    // filled when a counterpart is matched. OFFER → creator is the driver,
    // REQUEST → creator is the passenger.
    const counterpartSide =
      dto.type === 'OFFER'
        ? { rider: { connect: { id: riderId } } }
        : { passenger: { connect: { id: riderId } } };

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
      creator: { connect: { id: riderId } },
      ...counterpartSide,
    });

    const delay = Math.max(0, scheduledAt.getTime() - Date.now());
    await this.expiryQueue.add(
      'expire',
      { rideId: ride.id } satisfies RideExpiryJobData,
      {
        delay,
        jobId: `expire-${ride.id}`,
      },
    );

    return ride;
  }

  // ── Search ─────────────────────────────────────────────────────────────────

  async searchRides(
    viewer: { id: string; activeMode: ActiveMode },
    dto: SearchRidesDto,
  ) {
    const { skip, take, page, limit } = getPaginationParams(dto);

    // Show the complementary side only: rider mode sees passenger REQUESTs,
    // passenger mode sees driver OFFERs. Never show the viewer their own posts.
    //
    // Keyed on activeMode (the view the user chose), not role (the capability
    // an admin granted) — an approved rider browsing as a passenger should see
    // offers. Tokens minted before activeMode existed default to PASSENGER.
    const where: Record<string, unknown> = {
      status: 'SEARCHING',
      type: viewer.activeMode === 'RIDER' ? 'REQUEST' : 'OFFER',
      NOT: { creatorId: viewer.id },
    };

    if (dto.date) {
      const dayStart = new Date(`${dto.date}T00:00:00.000Z`);
      const dayEnd = new Date(`${dto.date}T23:59:59.999Z`);
      where['scheduledAt'] = { gte: dayStart, lte: dayEnd };
    }

    if (dto.seats) {
      where['seatsAvailable'] = { gte: dto.seats };
    }

    // Hard safety filter, applied whether or not the client asked for it. The
    // chip below can only narrow this set, never widen it — a male viewer
    // filtering for FEMALE_ONLY gets an empty feed rather than a forbidden one.
    const viewerGender = await this.ridesRepository.findRequesterGender(
      viewer.id,
    );
    const allowed = visibleGenderPrefs(viewerGender);
    where['genderPref'] = {
      in: dto.genderPref
        ? allowed.filter((pref) => pref === dto.genderPref)
        : allowed,
    };

    if (dto.originLat !== undefined && dto.originLng !== undefined) {
      where['originLat'] = {
        gte: dto.originLat - GEO_BOX_DEG,
        lte: dto.originLat + GEO_BOX_DEG,
      };
      where['originLng'] = {
        gte: dto.originLng - GEO_BOX_DEG,
        lte: dto.originLng + GEO_BOX_DEG,
      };
    }

    if (dto.destLat !== undefined && dto.destLng !== undefined) {
      where['destLat'] = {
        gte: dto.destLat - GEO_BOX_DEG,
        lte: dto.destLat + GEO_BOX_DEG,
      };
      where['destLng'] = {
        gte: dto.destLng - GEO_BOX_DEG,
        lte: dto.destLng + GEO_BOX_DEG,
      };
    }

    const [rides, total] = await Promise.all([
      this.ridesRepository.findMany({
        where: where,
        skip,
        take,
        orderBy: { scheduledAt: 'asc' },
        include: {
          creator: {
            select: {
              id: true,
              name: true,
              profilePictureUrl: true,
              stats: { select: { averageRating: true, ridesCompleted: true } },
            },
          },
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
      this.ridesRepository.count({ where: where }),
    ]);

    return { rides, pagination: buildPaginationMeta(total, page, limit) };
  }

  // ── Get one ────────────────────────────────────────────────────────────────

  async getRide(viewerId: string, rideId: string) {
    const ride = await this.ridesRepository.findWithRelations(rideId);
    if (!ride) throw new NotFoundException('Ride not found');

    // Filtering the feed alone would only hide the ride, not protect it — the
    // id is enough to fetch the poster's name, photo, pickup area and time.
    if (ride.genderPref !== 'ANY') {
      const involved =
        ride.creatorId === viewerId ||
        ride.riderId === viewerId ||
        ride.passengerId === viewerId ||
        (await this.ridesRepository.findRequest(rideId, viewerId)) !== null;

      if (!involved) {
        const gender = await this.ridesRepository.findRequesterGender(viewerId);
        if (!visibleGenderPrefs(gender).includes(ride.genderPref)) {
          // Not Forbidden: confirming the ride exists tells the caller there
          // is a female-only ride at this id, which is part of what leaked.
          throw new NotFoundException('Ride not found');
        }
      }
    }

    return ride;
  }

  // ── My rides ───────────────────────────────────────────────────────────────

  async getMyRides(userId: string, dto: MyRidesDto) {
    const { skip, take, page, limit } = getPaginationParams(dto);
    const role = dto.role;
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

  async updateRide(userId: string, rideId: string, dto: UpdateRideDto) {
    const ride = await this.ridesRepository.findById(rideId);
    if (!ride) throw new NotFoundException('Ride not found');
    if (ride.creatorId !== userId) throw new ForbiddenException();
    if (ride.status !== 'SEARCHING') {
      throw new ConflictException('Cannot edit a matched or active ride');
    }

    if (dto.scheduledAt) {
      const scheduledAt = new Date(dto.scheduledAt);
      if (scheduledAt <= new Date())
        throw new BadRequestException('scheduledAt must be a future date');
    }

    return this.ridesRepository.update(rideId, {
      ...(dto.fare !== undefined && { fare: dto.fare }),
      ...(dto.seatsAvailable !== undefined && {
        seatsAvailable: dto.seatsAvailable,
      }),
      ...(dto.scheduledAt && { scheduledAt: new Date(dto.scheduledAt) }),
      ...(dto.genderPref && { genderPref: dto.genderPref }),
    });
  }

  // ── Cancel ─────────────────────────────────────────────────────────────────

  async cancelRide(userId: string, rideId: string, dto: CancelRideDto) {
    const ride = await this.ridesRepository.findById(rideId);
    if (!ride) throw new NotFoundException('Ride not found');
    if (ride.creatorId !== userId) throw new ForbiddenException();
    if (
      ride.status === 'IN_PROGRESS' ||
      ride.status === 'COMPLETED' ||
      ride.status === 'CANCELLED'
    ) {
      throw new ConflictException(
        `Cannot cancel a ride with status ${ride.status}`,
      );
    }

    await this.ridesRepository.update(rideId, {
      status: 'CANCELLED',
      cancelledAt: new Date(),
      ...(dto.reason && { cancelReason: dto.reason }),
    });

    return { message: 'Ride cancelled' };
  }

  // ── Request to join ────────────────────────────────────────────────────────

  async requestRide(
    requester: { id: string; role: UserRole; activeMode: ActiveMode },
    rideId: string,
    dto: RequestRideDto,
  ) {
    const requesterId = requester.id;
    const ride = await this.ridesRepository.findById(rideId);
    if (!ride) throw new NotFoundException('Ride not found');
    if (ride.creatorId === requesterId)
      throw new ForbiddenException('Cannot request your own ride');
    if (ride.status !== 'SEARCHING') {
      throw new ConflictException('Ride is not accepting requests');
    }

    // The requester must be the complement of the post: passenger mode joins
    // ride offers, rider mode fulfils ride requests.
    //
    // Keyed on activeMode, not role — an approved rider browsing as a
    // passenger is a student who needs a lift today, and gating this on the
    // capability would show them a feed of offers they cannot act on.
    if (ride.type === 'OFFER' && requester.activeMode !== 'PASSENGER') {
      throw new ForbiddenException(
        'Switch to passenger mode to join a ride offer',
      );
    }
    if (ride.type === 'REQUEST') {
      // Mode alone would suffice (rider mode requires approval), but the
      // capability is re-checked here because this is the money path.
      if (requester.activeMode !== 'RIDER' || requester.role !== 'RIDER') {
        throw new ForbiddenException(
          'Only verified riders can fulfil a ride request',
        );
      }
    }

    // Gender restriction. Until now this was stored on the ride and filtered
    // in search, but never verified — anyone could join a female-only ride by
    // opening it directly.
    if (ride.genderPref !== 'ANY') {
      const gender = await this.ridesRepository.findRequesterGender(requesterId);
      // Same rule the feed uses, so what you can see and what you can join
      // cannot drift apart.
      if (!visibleGenderPrefs(gender).includes(ride.genderPref)) {
        // Fails closed for users with no gender recorded: this is a safety
        // control, so an unknown value must not pass.
        throw new ForbiddenException(
          gender === null
            ? 'Add your gender to your profile before joining this ride.'
            : `This ride is ${ride.genderPref === 'FEMALE_ONLY' ? 'female' : 'male'}-only.`,
        );
      }
    }

    const existing = await this.ridesRepository.findRequest(
      rideId,
      requesterId,
    );
    if (existing) throw new ConflictException('Already requested this ride');

    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

    const rideRequest = await this.ridesRepository.createRequest({
      ride: { connect: { id: rideId } },
      passenger: { connect: { id: requesterId } },
      message: dto.message,
      expiresAt,
    });

    const verb = ride.type === 'OFFER' ? 'join' : 'drive';
    await this.notificationsService.send(
      ride.creatorId,
      'RIDE_REQUEST',
      'New ride request',
      `Someone wants to ${verb} your ride to ${ride.destAddress}`,
      { rideId, requestId: rideRequest.id },
    );

    return rideRequest;
  }

  // ── Get requests ───────────────────────────────────────────────────────────

  async getRideRequests(userId: string, rideId: string) {
    const ride = await this.ridesRepository.findById(rideId);
    if (!ride) throw new NotFoundException('Ride not found');
    if (ride.creatorId !== userId) throw new ForbiddenException();
    return this.ridesRepository.findRequests(rideId, 'PENDING');
  }

  // ── Respond to request ─────────────────────────────────────────────────────

  async respondToRequest(
    userId: string,
    rideId: string,
    requestId: string,
    dto: RespondRequestDto,
  ) {
    const ride = await this.ridesRepository.findById(rideId);
    if (!ride) throw new NotFoundException('Ride not found');
    if (ride.creatorId !== userId) throw new ForbiddenException();
    if (ride.status !== 'SEARCHING') {
      throw new ConflictException('Ride is no longer accepting responses');
    }

    const req = await this.ridesRepository.findRequestById(requestId);
    if (!req || req.rideId !== rideId)
      throw new NotFoundException('Request not found');
    if (req.status !== 'PENDING')
      throw new ConflictException('Request is no longer pending');

    if (dto.action === RequestAction.ACCEPT) {
      // The requester fills the empty side: passengers join OFFERs, drivers
      // fulfil REQUESTs.
      const fillSide = ride.type === 'OFFER' ? 'passenger' : 'rider';
      await this.ridesRepository.acceptRequestTx(
        rideId,
        requestId,
        req.passengerId,
        fillSide,
      );
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
      if (ride.passengerConfirmed)
        throw new ConflictException('Already confirmed');
      updateData['passengerConfirmed'] = true;
    }

    const newRiderConfirmed = isRider ? true : ride.riderConfirmed;
    const newPassengerConfirmed = isPassenger ? true : ride.passengerConfirmed;

    const bothConfirmed = newRiderConfirmed && newPassengerConfirmed;
    if (bothConfirmed) {
      updateData['status'] = 'COMPLETED';
      updateData['completedAt'] = new Date();
    }

    const result = await this.ridesRepository.update(rideId, updateData);

    if (bothConfirmed) {
      await this.completionQueue.add('process', {
        rideId,
      } satisfies RideCompletionJobData);

      const notifyBoth = [ride.riderId, ride.passengerId].filter(
        Boolean,
      ) as string[];
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
