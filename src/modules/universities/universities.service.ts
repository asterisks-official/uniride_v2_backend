import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';

@Injectable()
export class UniversitiesService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Universities the app is live at.
   *
   * Fare coefficients are deliberately not returned: the client never prices
   * anything, and shipping the formula's inputs would invite someone to try.
   */
  listLive() {
    return this.prisma.university.findMany({
      where: { isLive: true },
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        shortName: true,
        requiresIdCard: true,
        campuses: {
          orderBy: { name: 'asc' },
          select: { id: true, name: true, address: true, lat: true, lng: true },
        },
      },
    });
  }

  async listCampuses(universityId: string) {
    const university = await this.prisma.university.findFirst({
      where: { id: universityId, isLive: true },
      select: { id: true },
    });
    if (!university) {
      throw new NotFoundException('University not found');
    }

    return this.prisma.campus.findMany({
      where: { universityId },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, address: true, lat: true, lng: true },
    });
  }

  /**
   * The campus set a given user should be offered, and the coefficients that
   * price their rides.
   *
   * A user with no university resolved yet (the ~1,000 accounts that predate
   * the column) sees every live university's campuses rather than none — the
   * same "fail open to today's behaviour" rule the visibility resolver uses.
   */
  async resolveForUser(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { universityId: true },
    });

    return this.prisma.university.findMany({
      where: user?.universityId ? { id: user.universityId } : { isLive: true },
      select: {
        id: true,
        shortName: true,
        fareBase: true,
        farePerKm: true,
        farePerMin: true,
        campuses: {
          select: { id: true, name: true, address: true, lat: true, lng: true },
        },
      },
    });
  }

  /**
   * The fare coefficients that price this user's trips.
   *
   * Per-university rather than global because the day a second city goes live
   * its base fare will not be Dhaka's. Falls back to the first live
   * university for accounts not yet resolved to one, and to a hard-coded set
   * if even that is missing — a ride must never fail to price because
   * reference data was not seeded.
   */
  async fareCoefficientsFor(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { universityId: true },
    });

    const university = await this.prisma.university.findFirst({
      where: user?.universityId ? { id: user.universityId } : { isLive: true },
      select: {
        fareBase: true,
        farePerKm: true,
        farePerMin: true,
        fareMinimum: true,
      },
    });

    return (
      university ?? {
        fareBase: 15,
        farePerKm: 7,
        farePerMin: 0,
        fareMinimum: 40,
      }
    );
  }

  /**
   * Loads a campus together with its university's fare coefficients.
   *
   * One query rather than two because every quote and every ride creation
   * needs exactly this pair, and splitting it invites a second round-trip on
   * the hottest path in the app.
   */
  findCampusWithFare(campusId: string) {
    return this.prisma.campus.findUnique({
      where: { id: campusId },
      select: {
        id: true,
        name: true,
        address: true,
        lat: true,
        lng: true,
        university: {
          select: {
            id: true,
            isLive: true,
            fareBase: true,
            farePerKm: true,
            farePerMin: true,
          },
        },
      },
    });
  }
}
