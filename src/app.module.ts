import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_INTERCEPTOR, APP_GUARD } from '@nestjs/core';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { BullModule } from '@nestjs/bullmq';
import { ScheduleModule } from '@nestjs/schedule';
import configuration from './config/configuration';
import { envValidationSchema } from './config/env.validation';
import { PrismaModule } from './database/prisma.module';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { RidesModule } from './modules/rides/rides.module';
import { UniversitiesModule } from './modules/universities/universities.module';
import { PlacesModule } from './modules/places/places.module';
import { DriversModule } from './modules/drivers/drivers.module';
import { FareModule } from './modules/fare/fare.module';
import { MatchingModule } from './modules/matching/matching.module';
import { ChatModule } from './modules/chat/chat.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { RatingsModule } from './modules/ratings/ratings.module';
import { ReportsModule } from './modules/reports/reports.module';
import { UploadsModule } from './modules/uploads/uploads.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { AdminModule } from './modules/admin/admin.module';
import { FirebaseModule } from './modules/firebase/firebase.module';
import { HealthModule } from './modules/health/health.module';
import { AllExceptionsFilter } from './shared/filters/all-exceptions.filter';
import { TransformInterceptor } from './shared/interceptors/transform.interceptor';
import { LoggingInterceptor } from './shared/interceptors/logging.interceptor';
import { RideGateway } from './gateways/ride.gateway';
import { NotificationProcessor } from './jobs/processors/notification.processor';
import { RideExpiryProcessor } from './jobs/processors/ride-expiry.processor';
import { RideCompletionProcessor } from './jobs/processors/ride-completion.processor';
import { TrustScoreProcessor } from './jobs/processors/trust-score.processor';
import { CleanupService } from './jobs/cleanup.service';
import {
  QUEUE_NOTIFICATIONS,
  QUEUE_RIDE_EXPIRY,
  QUEUE_TRUST_SCORE,
  QUEUE_RIDE_COMPLETION,
  QUEUE_ANONYMIZATION,
} from './jobs/queue.constants';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      validationSchema: envValidationSchema,
    }),
    ScheduleModule.forRoot(),
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        throttlers: [
          {
            ttl: config.get<number>('throttle.ttl', 60000),
            limit: config.get<number>('throttle.limit', 100),
          },
        ],
      }),
    }),
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const redisUrl = config.get<string>('redis.url');
        if (redisUrl) {
          const url = new URL(redisUrl);
          const tls = url.protocol === 'rediss:';
          return {
            connection: {
              host: url.hostname,
              port: parseInt(url.port || '6379', 10),
              ...(url.password && {
                password: decodeURIComponent(url.password),
              }),
              ...(url.username &&
                url.username !== 'default' && {
                  username: decodeURIComponent(url.username),
                }),
              ...(tls && { tls: {} }),
            },
          };
        }
        return {
          connection: {
            host: config.get<string>('redis.host', 'localhost'),
            port: config.get<number>('redis.port', 6379),
            password: config.get<string>('redis.password'),
          },
        };
      },
    }),
    BullModule.registerQueue(
      { name: QUEUE_NOTIFICATIONS },
      { name: QUEUE_RIDE_EXPIRY },
      { name: QUEUE_TRUST_SCORE },
      { name: QUEUE_RIDE_COMPLETION },
      { name: QUEUE_ANONYMIZATION },
    ),
    PrismaModule,
    AuthModule,
    UsersModule,
    RidesModule,
    UniversitiesModule,
    PlacesModule,
    DriversModule,
    FareModule,
    MatchingModule,
    ChatModule,
    NotificationsModule,
    RatingsModule,
    ReportsModule,
    UploadsModule,
    PaymentsModule,
    AdminModule,
    FirebaseModule,
    HealthModule,
  ],
  providers: [
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_INTERCEPTOR, useClass: LoggingInterceptor },
    { provide: APP_INTERCEPTOR, useClass: TransformInterceptor },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    RideGateway,
    NotificationProcessor,
    RideExpiryProcessor,
    RideCompletionProcessor,
    TrustScoreProcessor,
    CleanupService,
  ],
})
export class AppModule {}
