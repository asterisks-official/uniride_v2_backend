import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PlacesService } from './places.service';
import { SavePlaceDto } from './dto/save-place.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../shared/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';

@ApiTags('saved-places')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('saved-places')
export class PlacesController {
  constructor(private readonly places: PlacesService) {}

  @Get()
  @ApiOperation({ summary: 'Own saved places, most recently used first' })
  list(@CurrentUser() user: JwtPayload) {
    return this.places.list(user.sub);
  }

  @Post()
  @ApiOperation({ summary: 'Save a place' })
  create(@CurrentUser() user: JwtPayload, @Body() dto: SavePlaceDto) {
    return this.places.create(user.sub, dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Rename or move a saved place' })
  update(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SavePlaceDto,
  ) {
    return this.places.update(user.sub, id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a saved place' })
  remove(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.places.remove(user.sub, id);
  }
}
