import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaClient } from '../generated/prisma/client.js';
import { createPrismaAdapter } from './prisma-adapter.js';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  constructor(@Inject(ConfigService) configService: ConfigService) {
    super({ adapter: createPrismaAdapter(configService.getOrThrow<string>('DATABASE_URL')) });
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
