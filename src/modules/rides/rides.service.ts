import {
  Injectable,
  Logger,
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
  RideMode,
  UserRole,
} from '@prisma/client';
import { RidesRepository } from './rides.repository';
import { NotificationsService } from '../notifications/notifications.service';
import { CreateRideDto } from './dto/create-ride.dto';
import { QuoteRideDto } from './dto/quote-ride.dto';
import { SearchRidesDto } from './dto/search-rides.dto';
import { FareService } from '../fare/fare.service';
import { UniversitiesService } from '../universities/universities.service';
import { RideGateway } from '../../gateways/ride.gateway';
import { HandshakeLocationDto } from './dto/handshake-location.dto';
import { PlacesService } from '../places/places.service';
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

/// How long an INSTANT post keeps searching before it expires.
///
/// "Leaving now" means "leaving about now" — the window is how long that
/// plausibly lasts on a campus commute before the post is stale.
export const INSTANT_SEARCH_WINDOW_MS = 30 * 60 * 1000;

/// When a fresh ride's expiry job should fire, as a delay from `now`.
///
/// SCHEDULED rides expire at departure: still SEARCHING when the trip was due
/// to start means nobody took it. INSTANT rides *depart at creation* — their
/// `scheduledAt` is the posting moment — so `scheduledAt - now` is zero and
/// would expire the post the second it is born. They get the search window
/// instead.
export function expiryDelayMs(
  mode: RideMode,
  scheduledAt: Date,
  now: Date,
): number {
  if (mode === 'INSTANT') return INSTANT_SEARCH_WINDOW_MS;
  return Math.max(0, scheduledAt.getTime() - now.getTime());
}

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
export function visibleGenderPrefs(gender: Gender | null): GenderPreference[] {
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
  private readonly logger = new Logger(RidesService.name);

  constructor(
    private readonly ridesRepository: RidesRepository,
    private readonly notificationsService: NotificationsService,
    private readonly fare: FareService,
    private readonly universities: UniversitiesService,
    private readonly places: PlacesService,
    @InjectQueue(QUEUE_RIDE_EXPIRY) private readonly expiryQueue: Queue,
    @InjectQueue(QUEUE_RIDE_COMPLETION) private readonly completionQueue: Queue,
    private readonly rideGateway: RideGateway,
  ) {}

  // ── Create ─────────────────────────────────────────────────────────────────

  /**
   * Price a trip without creating anything.
   *
   * Called from the compose screen on every input change, so it stays cheap:
   * one lookup for the coefficients, then arithmetic. No campus, no
   * direction — a trip runs between two arbitrary points.
   */
  async quoteRide(userId: string, dto: QuoteRideDto) {
    const coefficients = await this.universities.fareCoefficientsFor(userId);
    return this.fare.quote(
      { lat: dto.fromLat, lng: dto.fromLng },
      { lat: dto.toLat, lng: dto.toLng },
      coefficients,
    );
  }

  async createRide(
    riderId: string,
    role: UserRole,
    activeMode: ActiveMode,
    dto: CreateRideDto,
  ) {
    // Post type follows the *view* the user is in, not the capability an admin
    // granted. An approved rider browsing as a passenger is a student who
    // needs a lift today, and must be able to ask for one.
    if (dto.type === 'OFFER') {
      if (role !== 'RIDER') {
        throw new ForbiddenException(
          'Only verified riders can offer a ride. Complete rider verification first.',
        );
      }
      if (activeMode !== 'RIDER') {
        throw new ForbiddenException('Switch to rider mode to offer a ride.');
      }
    }
    if (dto.type === 'REQUEST' && activeMode !== 'PASSENGER') {
      throw new ForbiddenException(
        'Switch to passenger mode to request a ride.',
      );
    }

    const mode = dto.mode ?? 'SCHEDULED';

    // An INSTANT ride is for right now, so it carries the request time rather
    // than a chosen one. Keeping the column non-null is what lets ordering,
    // the date filter and the expiry job stay free of null branches.
    let scheduledAt: Date;
    if (mode === 'INSTANT') {
      // Both sides may post for *now*. A rider leaving this minute saying
      // "who wants a lift?" is as valid as a passenger asking for one — this
      // is a marketplace with push, not a dispatch queue, so there is no
      // online state that a rider has to be in first.
      scheduledAt = new Date();
    } else {
      if (!dto.scheduledAt) {
        throw new BadRequestException('scheduledAt is required for a scheduled ride');
      }
      scheduledAt = new Date(dto.scheduledAt);
      if (scheduledAt <= new Date()) {
        throw new BadRequestException('scheduledAt must be a future date');
      }
    }

    await this.assertMayRestrictByGender(riderId, dto.genderPref);

    // The creator occupies the side matching their role; the other side is
    // filled when a counterpart is matched. OFFER → creator is the driver,
    // REQUEST → creator is the passenger.
    const counterpartSide =
      dto.type === 'OFFER'
        ? { rider: { connect: { id: riderId } } }
        : { passenger: { connect: { id: riderId } } };

    const trip = await this.resolveTrip(riderId, dto);

    const ride = await this.ridesRepository.create({
      type: dto.type,
      mode,
      ...trip.rideFields,
      // Bike-only: every ride carries one pillion. A client-sent seat count is
      // ignored rather than rejected, so v1 builds keep posting.
      seatsAvailable: 1,
      genderPref: dto.genderPref ?? 'ANY',
      scheduledAt,
      creator: { connect: { id: riderId } },
      ...counterpartSide,
      ...(trip.stops.length > 0 && { stops: { create: trip.stops } }),
      ...(dto.campusId && { campus: { connect: { id: dto.campusId } } }),
      ...(dto.direction && { direction: dto.direction }),
    });

    // Best-effort: surfacing the place someone posts from most often is worth
    // a write, but never worth failing a post over.
    if (trip.isTripShape) {
      void this.places
        .touch(riderId, trip.rideFields.originLat, trip.rideFields.originLng)
        .catch(() => undefined);
    }

    const delay = expiryDelayMs(mode, scheduledAt, new Date());
    await this.expiryQueue.add(
      'expire',
      { rideId: ride.id } satisfies RideExpiryJobData,
      {
        delay,
        jobId: `expire-${ride.id}`,
      },
    );

    // Fire-and-forget. A post that succeeded must not fail because a push
    // did — the ride exists either way, and the feed still shows it.
    void this.announceNewRide(ride, riderId).catch((err) =>
      this.logger.warn(`Could not announce ride ${ride.id}`, err),
    );

    return ride;
  }

  /**
   * Tells the other side of the market that a ride has been posted.
   *
   * This is what replaces going online. Riders do not sit in the app waiting
   * to be dispatched to — they get pushed when a trip appears and take it if
   * they want it. A passenger's request reaches every verified rider; a
   * rider's offer reaches passengers.
   *
   * Everyone, not the nearest few. At one campus with a couple of dozen
   * riders, ranking by proximity would filter out most of the people who might
   * actually say yes. `findRecipientsForNewRide` caps the fan-out as a safety
   * valve; the day that cap is reached is the day to start ranking.
   */
  private async announceNewRide(
    ride: { id: string; type: string; mode: string; originAddress: string; destAddress: string; genderPref: GenderPreference; scheduledAt: Date; fare: unknown; universityId: string | null },
    posterId: string,
  ): Promise<void> {
    const forRiders = ride.type === 'REQUEST';

    const recipients = await this.ridesRepository.findRecipientsForNewRide({
      posterId,
      forRiders,
      genderPref: ride.genderPref,
      universityId: ride.universityId,
    });
    if (recipients.length === 0) return;

    // Live first, push second. Anyone with the app open gets the card without
    // pulling to refresh; the notification is for everyone else.
    //
    // The same recipient list drives both, which is the point of computing it
    // here — it already encodes the audience rules (complementary side, same
    // university, gender-safe, never the poster). Deriving the socket audience
    // separately would be a second place for those rules to drift out of sync,
    // and the one that leaks is the one nobody tests.
    await this.broadcastNewRide(ride.id, recipients);

    const when =
      ride.mode === 'INSTANT'
        ? 'now'
        : ride.scheduledAt.toLocaleString('en-GB', {
            weekday: 'short',
            hour: 'numeric',
            minute: '2-digit',
          });

    const title = forRiders
      ? `Ride needed ${when} · ৳${ride.fare}`
      : `Ride available ${when} · ৳${ride.fare}`;

    await Promise.all(
      recipients.map((r) =>
        this.notificationsService.send(
          r.id,
          'RIDE_POSTED',
          title,
          `${ride.originAddress} → ${ride.destAddress}`,
          { rideId: ride.id, type: ride.type, mode: ride.mode },
        ),
      ),
    );
  }

  /**
   * Pushes a newly posted ride onto the feed of everyone entitled to see it.
   *
   * Sent as the whole ride rather than a bare id: the client can render the
   * card immediately, and a feed of N new rides stays one message instead of N
   * round-trips. The shape matches what the feed's own query returns, so the
   * same parser handles both and a socket-delivered card is indistinguishable
   * from a fetched one.
   *
   * Per-recipient rooms, not a broadcast the clients filter. Gender visibility
   * is a safety rule, and a rule enforced in the client is not enforced —
   * anyone can listen to a room they were not meant to be in.
   *
   * Never throws. A ride that exists must not be rolled back because a socket
   * was slow, and the feed still shows it on the next fetch either way.
   */
  private async broadcastNewRide(
    rideId: string,
    recipients: { id: string }[],
  ): Promise<void> {
    try {
      const ride = await this.ridesRepository.findWithRelations(rideId);
      if (!ride) return;

      for (const recipient of recipients) {
        this.rideGateway.emitToUser(recipient.id, 'ride:created', ride);
      }
    } catch (err) {
      this.logger.warn(`Could not broadcast ride ${rideId}`, err);
    }
  }

  /**
   * A gender-restricted ride may only be posted by someone of that gender.
   *
   * Without this the restriction is worse than useless: a man could post a
   * FEMALE_ONLY offer, the join check would admit only women, and a woman
   * would accept it believing the driver was female. The preference would be
   * actively misleading the people it exists to protect.
   *
   * `visibleGenderPrefs` already encodes the same rule for seeing and joining
   * a ride; posting is the third door into it and was the one left open.
   *
   * Fails closed for accounts with no gender recorded — they may post
   * unrestricted rides only, and are told how to fix it.
   */
  private async assertMayRestrictByGender(
    userId: string,
    genderPref: GenderPreference | undefined,
  ): Promise<void> {
    if (!genderPref || genderPref === 'ANY') return;

    const gender = await this.ridesRepository.findRequesterGender(userId);
    if (!visibleGenderPrefs(gender).includes(genderPref)) {
      throw new ForbiddenException(
        gender === null
          ? 'Add your gender to your profile before posting a gender-restricted ride.'
          : `Only ${genderPref === 'FEMALE_ONLY' ? 'women' : 'men'} can post a ${
              genderPref === 'FEMALE_ONLY' ? 'women' : 'men'
            }-only ride.`,
      );
    }
  }

  /**
   * Turns whichever shape the client sent into ride columns, stop rows and a
   * price.
   *
   * **Trip shape** — two real points. The fare is computed here rather than
   * trusted from the request, and both ends get a stop row carrying the coarse
   * area label that strangers see.
   *
   * **Legacy shape** — flat fields and a client fare, passed through as-is.
   * Those rides get no stop rows, and everything downstream has to tolerate
   * that (see the ride-creation plan §5.3).
   *
   * The `origin*` / `dest*` columns are written either way: they are NOT NULL,
   * v1 clients read them, and they stay until v1 is retired.
   */
  private async resolveTrip(userId: string, dto: CreateRideDto) {
    const { pickup, destination } = dto;
    const isTripShape = Boolean(pickup && destination);

    if (!isTripShape) {
      if (
        dto.originAddress === undefined ||
        dto.originLat === undefined ||
        dto.originLng === undefined ||
        dto.destAddress === undefined ||
        dto.destLat === undefined ||
        dto.destLng === undefined ||
        dto.fare === undefined
      ) {
        throw new BadRequestException(
          'Send either pickup + destination, or the full legacy set of ' +
            'addresses, coordinates and a fare.',
        );
      }
      return {
        isTripShape,
        stops: [] as {
          sequence: number;
          lat: number;
          lng: number;
          areaLabel: string;
        }[],
        rideFields: {
          originAddress: dto.originAddress,
          originLat: dto.originLat,
          originLng: dto.originLng,
          destAddress: dto.destAddress,
          destLat: dto.destLat,
          destLng: dto.destLng,
          fare: dto.fare,
        },
      };
    }

    const coefficients = await this.universities.fareCoefficientsFor(userId);
    const quote = await this.fare.quote(
      { lat: pickup!.lat, lng: pickup!.lng },
      { lat: destination!.lat, lng: destination!.lng },
      coefficients,
    );

    return {
      isTripShape,
      // Sequence 0 is the pickup — the point dispatch and the proximity feed
      // both rank against. Sequence 1 is the destination.
      stops: [
        {
          sequence: 0,
          lat: pickup!.lat,
          lng: pickup!.lng,
          areaLabel: pickup!.areaLabel,
        },
        {
          sequence: 1,
          lat: destination!.lat,
          lng: destination!.lng,
          areaLabel: destination!.areaLabel,
        },
      ],
      rideFields: {
        originAddress: pickup!.address,
        originLat: pickup!.lat,
        originLng: pickup!.lng,
        destAddress: destination!.address,
        destLat: destination!.lat,
        destLng: destination!.lng,
        fare: quote.total,
      },
    };
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

    // Editing is the second door into a gender restriction. Post an
    // unrestricted ride, then patch it to FEMALE_ONLY, and the create-time
    // check would never have run.
    await this.assertMayRestrictByGender(userId, dto.genderPref);

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

    // A cancelled ride that has already been matched has somebody waiting on
    // it, and until now nothing told them. Being stood up is bad; being stood
    // up by a screen that still says "you're matched" is worse — they would
    // wait at the pickup until they thought to pull to refresh.
    const both = [ride.riderId, ride.passengerId].filter(Boolean) as string[];
    const other = both.filter((id) => id !== userId);

    await Promise.all(
      other.map((id) =>
        this.notificationsService.send(
          id,
          'RIDE_CANCELLED',
          'Ride cancelled',
          dto.reason
            ? `The ride to ${ride.destAddress} was cancelled: ${dto.reason}`
            : `The ride to ${ride.destAddress} was cancelled`,
          { rideId },
        ),
      ),
    );

    // Both, the canceller included: the ride is over for the two of them at
    // the same moment, and neither has any reason to still be looking at it.
    if (both.length > 0) {
      this.broadcastRideUpdate(rideId, both, 'ride:cancelled');
    }

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
      const gender =
        await this.ridesRepository.findRequesterGender(requesterId);
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

      // A match is the one event worth interrupting someone for. The person
      // who accepted is already looking at the ride; the person who asked may
      // be anywhere in the app, and telling them to go and find it themselves
      // is the manual step this is here to remove.
      //
      // Its own event, not `ride:updated`: that one only refreshes whatever is
      // on screen, and a client must never be pulled across the app by an
      // ordinary state change.
      this.broadcastRideUpdate(rideId, [req.passengerId], 'ride:matched');
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

  async startRide(
    riderId: string,
    rideId: string,
    where?: HandshakeLocationDto,
  ) {
    const ride = await this.ridesRepository.findById(rideId);
    if (!ride) throw new NotFoundException('Ride not found');
    if (ride.riderId !== riderId) throw new ForbiddenException();
    if (ride.status !== 'MATCHED') {
      throw new ConflictException('Ride must be matched before starting');
    }

    // Stamped, but not yet in progress. The trip begins when the passenger
    // agrees it has — a rider alone cannot put a ride on the clock, which is
    // the same rule the completion handshake already applies at the other end.
    //
    // No new column for the waiting state: `MATCHED` with a `startedAt` is
    // exactly "the rider says they have begun and nobody has agreed yet", and
    // an extra status would have to be handled in every switch that exists.
    const updated = await this.ridesRepository.update(rideId, {
      startedAt: new Date(),
      ...RidesService.locationFields('riderStart', where),
    });

    if (ride.passengerId) {
      await this.notificationsService.send(
        ride.passengerId,
        'RIDE_STARTED',
        'Your rider has started',
        `Confirm you are on your way to ${ride.destAddress}`,
        { rideId },
      );
      this.broadcastRideUpdate(rideId, [ride.passengerId]);
    }

    return updated;
  }

  /**
   * The passenger's half of starting: the trip is now genuinely under way.
   *
   * Until this lands the ride is still `MATCHED`, which keeps it cancellable
   * and keeps the fare off the clock. A rider who marks a trip started before
   * the passenger is on the bike would otherwise be unanswerable.
   */
  async confirmStart(
    userId: string,
    rideId: string,
    where?: HandshakeLocationDto,
  ) {
    const ride = await this.ridesRepository.findById(rideId);
    if (!ride) throw new NotFoundException('Ride not found');
    if (ride.passengerId !== userId) {
      throw new ForbiddenException('Only the passenger can confirm the start');
    }
    if (ride.status !== 'MATCHED') {
      throw new ConflictException(`Ride is ${ride.status}, not matched`);
    }
    if (!ride.startedAt) {
      throw new ConflictException('The rider has not started this ride yet');
    }

    const updated = await this.ridesRepository.update(rideId, {
      status: 'IN_PROGRESS',
      ...RidesService.locationFields('passengerStart', where),
    });

    if (ride.riderId) {
      await this.notificationsService.send(
        ride.riderId,
        'RIDE_STARTED',
        'Ride under way',
        `Your passenger confirmed the trip to ${ride.destAddress}`,
        { rideId },
      );
      this.broadcastRideUpdate(rideId, [ride.riderId]);
    }

    return updated;
  }

  /**
   * The coordinate columns for one actor, or nothing.
   *
   * Both or neither: half a coordinate is not a location, and a stray lat with
   * no lng would sit in the database looking like evidence.
   */
  private static locationFields(
    prefix: 'riderStart' | 'passengerStart' | 'riderEnd' | 'passengerEnd',
    where?: HandshakeLocationDto,
  ): Record<string, number> {
    if (where?.lat === undefined || where?.lng === undefined) return {};
    return { [`${prefix}Lat`]: where.lat, [`${prefix}Lng`]: where.lng };
  }

  /**
   * Tells the other party's open app that this ride moved on.
   *
   * Both halves of a handshake happen on two different phones, so without this
   * the second person waits on a screen that will never change until they pull
   * to refresh — which is the whole reason the step feels broken.
   *
   * Never throws, for the same reason [broadcastNewRide] does not: a state
   * change that has already been written must not be undone by a socket.
   */
  private broadcastRideUpdate(
    rideId: string,
    userIds: string[],
    event = 'ride:updated',
  ): void {
    void (async () => {
      try {
        const full = await this.ridesRepository.findWithRelations(rideId);
        if (!full) return;
        for (const id of userIds) {
          this.rideGateway.emitToUser(id, event, full);
        }
      } catch (err) {
        this.logger.warn(`Could not broadcast update for ride ${rideId}`, err);
      }
    })();
  }

  // ── Confirm completion ─────────────────────────────────────────────────────

  async confirmRide(
    userId: string,
    rideId: string,
    where?: HandshakeLocationDto,
  ) {
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
      Object.assign(updateData, RidesService.locationFields('riderEnd', where));
    } else {
      if (ride.passengerConfirmed)
        throw new ConflictException('Already confirmed');
      updateData['passengerConfirmed'] = true;
      Object.assign(updateData, RidesService.locationFields('passengerEnd', where));
    }

    const newRiderConfirmed = isRider ? true : ride.riderConfirmed;
    const newPassengerConfirmed = isPassenger ? true : ride.passengerConfirmed;

    const bothConfirmed = newRiderConfirmed && newPassengerConfirmed;
    if (bothConfirmed) {
      updateData['status'] = 'COMPLETED';
      updateData['completedAt'] = new Date();
    }

    const result = await this.ridesRepository.update(rideId, updateData);

    // The other side is waiting on a screen that says "waiting for them".
    const other = isRider ? ride.passengerId : ride.riderId;
    if (other) this.broadcastRideUpdate(rideId, [other]);

    if (bothConfirmed) {
      await this.completionQueue.add('process', {
        rideId,
      } satisfies RideCompletionJobData);

      const notifyBoth = [ride.riderId, ride.passengerId].filter(
        Boolean,
      ) as string[];

      // Both, including whoever just tapped: the ride is over for the two of
      // them at the same instant, and the rating is the last thing either can
      // still do about it. Its own event, because it navigates.
      this.broadcastRideUpdate(rideId, notifyBoth, 'ride:completed');
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
