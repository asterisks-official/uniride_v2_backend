import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';
import { v4 as uuidv4 } from 'uuid';

/// Catches every exception. HttpExceptions keep the standard envelope; any
/// other (non-HTTP) error is logged with its stack and its real message is
/// surfaced in the response so failures aren't hidden behind a generic 500.
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Exception');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const requestId = uuidv4();

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const exceptionResponse = exception.getResponse();
      const message =
        typeof exceptionResponse === 'string'
          ? exceptionResponse
          : typeof exceptionResponse === 'object' &&
              'message' in exceptionResponse
            ? (exceptionResponse as { message: string | string[] }).message
            : exception.message;

      response.status(status).json({
        statusCode: status,
        error: HttpStatus[status] ?? 'Error',
        message: Array.isArray(message) ? message : [message],
        timestamp: new Date().toISOString(),
        requestId,
      });
      return;
    }

    const err =
      exception instanceof Error ? exception : new Error(String(exception));
    this.logger.error(
      `Unhandled exception [${requestId}] ${err.name}: ${err.message}`,
      err.stack,
    );

    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      error: 'INTERNAL_SERVER_ERROR',
      name: err.name,
      message: [err.message],
      timestamp: new Date().toISOString(),
      requestId,
    });
  }
}
