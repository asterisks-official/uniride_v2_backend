import { NestFactory } from '@nestjs/core';
import { ValidationPipe, VersioningType } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  const configService = app.get(ConfigService);
  const port = configService.get<number>('port', 3000);
  const nodeEnv = configService.get<string>('nodeEnv', 'development');

  app.setGlobalPrefix('api');
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  // The console and the public site are both served from uniridebd.com, so
  // both are allowed. The apex is listed because the landing page shares the
  // Next app with the console and may call the API from there.
  //
  // An explicit list rather than a wildcard: `credentials: true` with a
  // reflected origin would let any site a signed-in admin visits make
  // authenticated requests on their behalf.
  app.enableCors({
    origin:
      nodeEnv === 'production'
        ? ['https://admin.uniridebd.com', 'https://uniridebd.com', 'https://www.uniridebd.com']
        : true,
    credentials: true,
  });

  if (nodeEnv !== 'production') {
    const config = new DocumentBuilder()
      .setTitle('UniRide API')
      .setDescription('UniRide ride-sharing platform API')
      .setVersion('1.0')
      .addBearerAuth()
      .build();
    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('api/docs', app, document);
  }

  await app.listen(port);
}
void bootstrap();
