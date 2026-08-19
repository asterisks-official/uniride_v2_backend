import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { SavePlaceDto } from './dto/save-place.dto';

@Injectable()
export class PlacesService {
  /**
   * Soft cap. Past this the picker stops being a shortcut and becomes a list
   * to manage, which defeats the point of saved places.
   */
  private static readonly MAX_PLACES = 8;

  constructor(private readonly prisma: PrismaService) {}

  /** Most recently used first — the compose screen defaults to the top one. */
  list(userId: string) {
    return this.prisma.savedPlace.findMany({
      where: { userId },
      orderBy: [
        { lastUsedAt: { sort: 'desc', nulls: 'last' } },
        { createdAt: 'desc' },
      ],
      select: {
        id: true,
        label: true,
        lat: true,
        lng: true,
        areaLabel: true,
        lastUsedAt: true,
      },
    });
  }

  async create(userId: string, dto: SavePlaceDto) {
    const count = await this.prisma.savedPlace.count({ where: { userId } });
    if (count >= PlacesService.MAX_PLACES) {
      throw new BadRequestException(
        `You can save up to ${PlacesService.MAX_PLACES} places. Delete one to add another.`,
      );
    }

    return this.prisma.savedPlace.create({
      data: { userId, ...dto },
      select: {
        id: true,
        label: true,
        lat: true,
        lng: true,
        areaLabel: true,
        lastUsedAt: true,
      },
    });
  }

  async update(userId: string, id: string, dto: SavePlaceDto) {
    await this.assertOwned(userId, id);
    return this.prisma.savedPlace.update({
      where: { id },
      data: dto,
      select: {
        id: true,
        label: true,
        lat: true,
        lng: true,
        areaLabel: true,
        lastUsedAt: true,
      },
    });
  }

  async remove(userId: string, id: string): Promise<void> {
    await this.assertOwned(userId, id);
    // Safe to hard-delete: a ride copies the coordinates it was created with,
    // so no live ride can be orphaned by this.
    await this.prisma.savedPlace.delete({ where: { id } });
  }

  /** Fire-and-forget from the ride-creation path; never block a post on it. */
  async touch(userId: string, lat: number, lng: number): Promise<void> {
    await this.prisma.savedPlace.updateMany({
      where: { userId, lat, lng },
      data: { lastUsedAt: new Date() },
    });
  }

  private async assertOwned(userId: string, id: string): Promise<void> {
    const place = await this.prisma.savedPlace.findUnique({
      where: { id },
      select: { userId: true },
    });
    // Same 404 whether it is missing or someone else's — no probing for ids.
    if (!place || place.userId !== userId) {
      throw new NotFoundException('Saved place not found');
    }
  }
}
