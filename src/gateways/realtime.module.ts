import { Global, Module } from '@nestjs/common';
import { RideGateway } from './ride.gateway';
import { AuthModule } from '../modules/auth/auth.module';
import { ChatModule } from '../modules/chat/chat.module';

/**
 * The socket gateway, as an injectable rather than a loose provider.
 *
 * It was registered directly in `AppModule.providers`, which stood it up and
 * accepted connections but left it reachable from nowhere — no service could
 * inject it, so nothing was ever emitted. The rooms worked and the server was
 * silent, which is why every feed needed a manual pull.
 *
 * Global because the things worth broadcasting (a ride posted, a request
 * answered) happen across modules, and threading an import through each one
 * would be noise.
 */
@Global()
@Module({
  imports: [AuthModule, ChatModule],
  providers: [RideGateway],
  exports: [RideGateway],
})
export class RealtimeModule {}
