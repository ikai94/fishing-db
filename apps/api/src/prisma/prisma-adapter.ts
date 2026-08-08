import { PrismaPg } from '@prisma/adapter-pg';

export function createPrismaAdapter(connectionString: string): PrismaPg {
  return new PrismaPg({
    connectionString,
    connectionTimeoutMillis: 5_000,
  });
}
