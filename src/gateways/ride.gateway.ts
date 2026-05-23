import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  ConnectedSocket,
  MessageBody,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { ChatService } from '../modules/chat/chat.service';

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
    private readonly chatService: ChatService,
  ) {}

  handleConnection(client: Socket): void {
    try {
      const auth = client.handshake.auth as Record<string, string | undefined>;
      const token =
        auth['token'] ??
        client.handshake.headers?.authorization?.replace('Bearer ', '');

      if (!token) {
        client.disconnect();
        return;
      }

      const payload: { sub: string } = this.jwtService.verify(token, {
        algorithms: ['RS256'],
        publicKey: this.configService.get<string>('jwt.publicKey'),
      });

      this.connectedUsers.set(client.id, payload.sub);
      void client.join(`user:${payload.sub}`);
      this.logger.log(`Client connected: ${client.id} (user ${payload.sub})`);
    } catch {
      client.disconnect();
    }
  }

  handleDisconnect(client: Socket): void {
    const userId = this.connectedUsers.get(client.id);
    this.connectedUsers.delete(client.id);
    this.logger.log(
      `Client disconnected: ${client.id} (user ${userId ?? 'unknown'})`,
    );
  }

  @SubscribeMessage('join:ride')
  handleJoinRide(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { rideId: string },
  ): void {
    void client.join(`ride:${data.rideId}`);
    this.logger.log(`Socket ${client.id} joined ride room ${data.rideId}`);
  }

  @SubscribeMessage('leave:ride')
  handleLeaveRide(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { rideId: string },
  ): void {
    void client.leave(`ride:${data.rideId}`);
  }

  @SubscribeMessage('send:message')
  async handleSendMessage(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { rideId: string; content: string },
  ): Promise<void> {
    const senderId = this.connectedUsers.get(client.id);
    if (!senderId) {
      client.emit('error', { message: 'Unauthorized' });
      return;
    }

    try {
      const message = await this.chatService.sendMessage(
        data.rideId,
        senderId,
        data.content,
      );
      this.server.to(`ride:${data.rideId}`).emit('new:message', message);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to send message';
      client.emit('error', { message: msg });
    }
  }

  emitToUser(userId: string, event: string, data: unknown): void {
    this.server.to(`user:${userId}`).emit(event, data);
  }

  emitToRide(rideId: string, event: string, data: unknown): void {
    this.server.to(`ride:${rideId}`).emit(event, data);
  }
}
