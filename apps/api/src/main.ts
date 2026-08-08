import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  const configService = app.get(ConfigService);
  const port = configService.getOrThrow<number>('PORT');
  const webOrigin = configService.getOrThrow<string>('WEB_ORIGIN');

  app.setGlobalPrefix('api/v1');
  app.enableCors({
    origin: [webOrigin],
    credentials: false,
    methods: ['GET', 'HEAD', 'OPTIONS'],
  });
  app.enableShutdownHooks();

  await app.listen(port);
}

void bootstrap();
