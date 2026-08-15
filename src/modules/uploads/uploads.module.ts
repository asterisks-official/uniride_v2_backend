import { Module } from '@nestjs/common';
import { UploadsController } from './uploads.controller';
import { DevUploadsController } from './dev-uploads.controller';
import { UploadsService } from './uploads.service';

/// The dev object sink is registered by *not existing* in production rather
/// than by an in-handler check — an unauthenticated write endpoint should not
/// be one misread config value away from being live.
const controllers =
  process.env.NODE_ENV === 'production'
    ? [UploadsController]
    : [UploadsController, DevUploadsController];

@Module({
  controllers,
  providers: [UploadsService],
  exports: [UploadsService],
})
export class UploadsModule {}
