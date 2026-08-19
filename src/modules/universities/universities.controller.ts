import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UniversitiesService } from './universities.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../shared/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';

@ApiTags('universities')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('universities')
export class UniversitiesController {
  constructor(private readonly universities: UniversitiesService) {}

  @Get()
  @ApiOperation({ summary: 'Universities the app is live at, with campuses' })
  list() {
    return this.universities.listLive();
  }

  @Get('mine')
  @ApiOperation({
    summary: "The caller's university and campuses",
    description:
      'Falls back to every live university for accounts with no university ' +
      'resolved yet, so pre-existing users are never left with no campus to pick.',
  })
  mine(@CurrentUser() user: JwtPayload) {
    return this.universities.resolveForUser(user.sub);
  }

  @Get(':universityId/campuses')
  @ApiOperation({ summary: 'Campuses for one university' })
  campuses(@Param('universityId', ParseUUIDPipe) universityId: string) {
    return this.universities.listCampuses(universityId);
  }
}
