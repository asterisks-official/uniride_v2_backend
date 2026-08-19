import {
  BadRequestException,
  Controller,
  Get,
  NotFoundException,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { GeocodingService } from './geocoding.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@ApiTags('places')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('places')
export class GeocodingController {
  constructor(private readonly geocoding: GeocodingService) {}

  @Get('search')
  @ApiOperation({
    summary: 'Place suggestions for a typed query',
    description:
      'Proxies Google Places so the key never ships in the app. Falls back ' +
      'to a static list of Dhaka areas when no key is configured.',
  })
  search(@Query('q') q?: string) {
    return this.geocoding.search(q ?? '');
  }

  @Get('resolve')
  @ApiOperation({ summary: 'Coordinates for a suggestion' })
  async resolve(@Query('id') id?: string) {
    if (!id) throw new BadRequestException('id is required');
    const place = await this.geocoding.resolve(id);
    if (!place) throw new NotFoundException('Place not found');
    return place;
  }

  @Get('reverse')
  @ApiOperation({
    summary: 'What is at a coordinate',
    description:
      'The most specific thing OSM knows about the point — a building, a ' +
      'business, a road — rather than the neighbourhood around it. ' +
      '`areaLabel` carries the same string and exists only so the wire shape ' +
      'and `RideStop.areaLabel` did not need a migration.',
  })
  async reverse(@Query('lat') lat?: string, @Query('lng') lng?: string) {
    const latitude = Number(lat);
    const longitude = Number(lng);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      throw new BadRequestException('lat and lng must be numbers');
    }
    return this.geocoding.reverse(latitude, longitude);
  }
}
