import { Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

export type HealthResponse = {
  status: 'ok' | 'error';
  application: 'up';
  database: 'up' | 'down';
  timestamp: string;
};

@Injectable()
export class HealthService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async check(): Promise<HealthResponse> {
    try {
      await this.prisma.$queryRawUnsafe('SELECT 1');

      return {
        status: 'ok',
        application: 'up',
        database: 'up',
        timestamp: new Date().toISOString(),
      };
    } catch {
      throw new ServiceUnavailableException({
        status: 'error',
        application: 'up',
        database: 'down',
        timestamp: new Date().toISOString(),
      } satisfies HealthResponse);
    }
  }
}
