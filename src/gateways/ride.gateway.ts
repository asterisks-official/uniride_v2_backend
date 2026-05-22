import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  ConnectedSocket,
  MessageBody,
} from '@nestjs/websockets';
import { Logger, UseGuards } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';

@WebSocketGateway({
  cors: { origin: '*' },
  namespace: '/rides',
})
export class RideGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(RideGateway.name);
  private readonly connectedUsers = new Map<string, string>(); // socketId → userId

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  async handleConnection(client: Socket): Promise<void> {
    try {
      const token =
        client.handshake.auth?.token ||
        client.handshake.headers?.authorization?.replace('Bearer ', '');

      if (!token) {
        client.disconnect();
        return;
      }

      const payload = this.jwtService.verify(token, {
        algorithms: ['RS256'],
        publicKey: this.configService.get<string>('jwt.publicKey'),
      });

      this.connectedUsers.set(client.id, payload.sub);
      client.join(`user:${payload.sub}`);
      this.logger.log(`Client connected: ${client.id} (user ${payload.sub})`);
    } catch {
      client.disconnect();
    }
  }

  handleDisconnect(client: Socket): void {
    const userId = this.connectedUsers.get(client.id);
    this.connectedUsers.delete(client.id);
    this.logger.log(`Client disconnected: ${client.id} (user ${userId ?? 'unknown'})`);
  }

  @SubscribeMessage('join:ride')
  handleJoinRide(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { rideId: string },
  ): void {
    client.join(`ride:${data.rideId}`);
    this.logger.log(`Socket ${client.id} joined ride room ${data.rideId}`);
  }

  @SubscribeMessage('leave:ride')
  handleLeaveRide(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { rideId: string },
  ): void {
    client.leave(`ride:${data.rideId}`);
  }

  emitToUser(userId: string, event: string, data: unknown): void {
    this.server.to(`user:${userId}`).emit(event, data);
  }

  emitToRide(rideId: string, event: string, data: unknown): void {
    this.server.to(`ride:${rideId}`).emit(event, data);
  }
}
