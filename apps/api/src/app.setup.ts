import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import { createApplicationValidationPipe } from './common/validation/validation-exception.factory.js';

/** Общие HTTP-границы сохраняют cookie-авторизацию и разрешают запросы только с настроенного web-origin. */
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
    // Блокнот сохраняет заметку через PUT: без него браузер останавливает запрос на preflight.
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type'],
  });
  app.enableShutdownHooks();
}
