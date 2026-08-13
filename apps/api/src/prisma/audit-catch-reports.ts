import 'dotenv/config';
import { pathToFileURL } from 'node:url';
import { PrismaClient } from '../generated/prisma/client.js';
import { createPrismaAdapter } from './prisma-adapter.js';

export interface LegacyCatchReportAuditItem {
  id: string;
  fishingMethod: 'BAIT_FISHING' | 'SPINNING';
  missingFields: Array<'holeDepthCm' | 'spinningSize' | 'spinningSpeed'>;
  incompatibleFields: Array<'spinningSize' | 'spinningSpeed'>;
}

export interface LegacyCatchReportAuditResult {
  compatibleCount: number;
  incompatibleCount: number;
  items: LegacyCatchReportAuditItem[];
}

export async function auditLegacyCatchReports(
  prisma: Pick<PrismaClient, 'catchReport'>,
): Promise<LegacyCatchReportAuditResult> {
  const rows = await prisma.catchReport.findMany({
    orderBy: { id: 'asc' },
    select: {
      id: true,
      fishingMethod: true,
      holeDepthCm: true,
      spinningSize: true,
      spinningSpeed: true,
    },
  });
  const items: LegacyCatchReportAuditItem[] = [];

  for (const row of rows) {
    const missingFields: LegacyCatchReportAuditItem['missingFields'] = [];
    const incompatibleFields: LegacyCatchReportAuditItem['incompatibleFields'] = [];

    if (row.fishingMethod === 'BAIT_FISHING') {
      if (row.holeDepthCm === null) missingFields.push('holeDepthCm');
      if (row.spinningSize !== null) incompatibleFields.push('spinningSize');
      if (row.spinningSpeed !== null) incompatibleFields.push('spinningSpeed');
    } else {
      if (row.spinningSize === null) missingFields.push('spinningSize');
      if (row.spinningSpeed === null) missingFields.push('spinningSpeed');
    }

    if (missingFields.length > 0 || incompatibleFields.length > 0) {
      items.push({
        id: row.id,
        fishingMethod: row.fishingMethod,
        missingFields,
        incompatibleFields,
      });
    }
  }

  return {
    compatibleCount: rows.length - items.length,
    incompatibleCount: items.length,
    items,
  };
}

async function runAudit(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;

  if (databaseUrl === undefined || databaseUrl.trim() === '') {
    throw new Error('DATABASE_URL is required');
  }

  const prisma = new PrismaClient({ adapter: createPrismaAdapter(databaseUrl) });

  try {
    const result = await auditLegacyCatchReports(prisma);
    console.info(JSON.stringify(result, null, 2));
    if (result.incompatibleCount > 0) process.exitCode = 2;
  } finally {
    await prisma.$disconnect();
  }
}

const entryPoint = process.argv[1];

if (entryPoint !== undefined && import.meta.url === pathToFileURL(entryPoint).href) {
  void runAudit().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : 'Unknown audit error';
    console.error(`CatchReport legacy audit failed: ${message}`);
    process.exitCode = 1;
  });
}
