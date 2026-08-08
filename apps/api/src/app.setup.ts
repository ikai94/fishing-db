import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import cookieParser from 'cookie-parser';
import { createApplicationValidationPipe } from './common/validation/validation-exception.factory.js';

export function configureApplication(app: INestApplication): void {
  const configService = app.get(ConfigService);
  const webOrigin = configService.getOrThrow<string>('WEB_ORIGIN');

  app.setGlobalPrefix('api/v1');
  app.use(cookieParser());
  app.useGlobalPipes(createApplicationValidationPipe());
  app.enableCors({
    origin: [webOrigin],
    credentials: true,
    methods: ['GET', 'HEAD', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type'],
  });
  app.enableShutdownHooks();
}
