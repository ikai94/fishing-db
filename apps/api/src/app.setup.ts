import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import { createApplicationValidationPipe } from './common/validation/validation-exception.factory.js';

export function configureApplication(app: INestApplication): void {
  const configService = app.get(ConfigService);
  const webOrigin = configService.getOrThrow<string>('WEB_ORIGIN');

  app.setGlobalPrefix('api/v1');
  (app as NestExpressApplication).useBodyParser('json', { limit: '5mb' });
  app.use(cookieParser());
  app.useGlobalPipes(createApplicationValidationPipe());
  app.enableCors({
    origin: [webOrigin],
    credentials: true,
    methods: ['GET', 'HEAD', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type'],
  });
  app.enableShutdownHooks();
}
