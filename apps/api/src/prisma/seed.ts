import 'dotenv/config';
import { pathToFileURL } from 'node:url';
import { PrismaClient, UserRole } from '../generated/prisma/client.js';
import { normalizeEmail, normalizeNickname } from '../auth/normalization.js';
import { PasswordService } from '../auth/password.service.js';
import { createPrismaAdapter } from './prisma-adapter.js';

export interface AdminSeedInput {
  email: string;
  nickname?: string;
  password?: string;
}

export type AdminSeedResult = 'created' | 'promoted' | 'unchanged';

interface PrismaErrorLike {
  code?: unknown;
  meta?: unknown;
}

function uniqueConstraintMetadata(error: unknown): string {
  if (typeof error !== 'object' || error === null) {
    return '';
  }

  const prismaError = error as PrismaErrorLike;

  if (prismaError.code !== 'P2002') {
    return '';
  }

  try {
    return JSON.stringify(prismaError.meta ?? '').toLowerCase();
  } catch {
    return '';
  }
}

function isUniqueConstraintError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as PrismaErrorLike).code === 'P2002';
}

function adminNicknameConflictError(): Error {
  return new Error(
    'ADMIN_NICKNAME_ALREADY_EXISTS: the configured admin nickname is already in use',
  );
}

async function promoteExistingAdmin(
  prisma: PrismaClient,
  user: { id: string; role: UserRole; emailVerifiedAt: Date | null },
): Promise<Exclude<AdminSeedResult, 'created'>> {
  if (user.role === UserRole.ADMIN && user.emailVerifiedAt !== null) {
    return 'unchanged';
  }

  const verifiedAt = new Date();
  await prisma.$transaction(async (transaction) => {
    await transaction.user.update({
      where: { id: user.id },
      data: {
        role: UserRole.ADMIN,
        ...(user.emailVerifiedAt === null ? { emailVerifiedAt: verifiedAt } : {}),
      },
      select: { id: true },
    });

    if (user.emailVerifiedAt !== null) {
      return;
    }

    const verificationTokens = await transaction.authToken.findMany({
      where: {
        userId: user.id,
        purpose: 'EMAIL_VERIFICATION',
        consumedAt: null,
        invalidatedAt: null,
      },
      select: { id: true },
    });
    const tokenIds = verificationTokens.map(({ id }) => id);

    if (tokenIds.length === 0) {
      return;
    }

    await transaction.authToken.updateMany({
      where: { id: { in: tokenIds }, consumedAt: null, invalidatedAt: null },
      data: { invalidatedAt: verifiedAt },
    });
    await transaction.authEmailOutbox.updateMany({
      where: { authTokenId: { in: tokenIds }, sentAt: null, cancelledAt: null },
      data: { cancelledAt: verifiedAt, leaseUntil: null },
    });
  });

  return 'promoted';
}

function requiredAdminValue(
  name: 'ADMIN_NICKNAME' | 'ADMIN_PASSWORD',
  value: string | undefined,
): string {
  if (value === undefined || value.length === 0) {
    throw new Error(`${name} is required when the configured admin user does not exist`);
  }

  return value;
}

export async function seedAdmin(
  prisma: PrismaClient,
  input: AdminSeedInput,
): Promise<AdminSeedResult> {
  const email = normalizeEmail(input.email);
  const existingUser = await prisma.user.findUnique({
    where: { email },
    select: { id: true, role: true, emailVerifiedAt: true },
  });

  if (existingUser !== null) {
    return promoteExistingAdmin(prisma, existingUser);
  }

  const { nickname, nicknameNormalized } = normalizeNickname(
    requiredAdminValue('ADMIN_NICKNAME', input.nickname),
  );
  const password = requiredAdminValue('ADMIN_PASSWORD', input.password);
  const nicknameOwner = await prisma.user.findUnique({
    where: { nicknameNormalized },
    select: { id: true },
  });

  if (nicknameOwner !== null) {
    throw adminNicknameConflictError();
  }

  const passwordHash = await new PasswordService().hashPassword(password);

  try {
    await prisma.user.create({
      data: {
        email,
        nickname,
        nicknameNormalized,
        passwordHash,
        role: UserRole.ADMIN,
        emailVerifiedAt: new Date(),
      },
      select: { id: true },
    });

    return 'created';
  } catch (error: unknown) {
    if (!isUniqueConstraintError(error)) {
      throw error;
    }

    // A registration or another seed may have created this email after our initial lookup.
    // Promote only the role so that credentials, profile, ban state, and sessions are preserved.
    const concurrentUser = await prisma.user.findUnique({
      where: { email },
      select: { id: true, role: true, emailVerifiedAt: true },
    });

    if (concurrentUser !== null) {
      return promoteExistingAdmin(prisma, concurrentUser);
    }

    if (uniqueConstraintMetadata(error).includes('nicknamenormalized')) {
      throw adminNicknameConflictError();
    }

    const concurrentNicknameOwner = await prisma.user.findUnique({
      where: { nicknameNormalized },
      select: { id: true },
    });

    if (concurrentNicknameOwner !== null) {
      throw adminNicknameConflictError();
    }

    throw error;
  }
}

async function runSeed(): Promise<void> {
  const adminEmail = process.env.ADMIN_EMAIL;

  if (adminEmail === undefined || adminEmail.trim() === '') {
    throw new Error('ADMIN_EMAIL is required');
  }

  const databaseUrl = process.env.DATABASE_URL;

  if (databaseUrl === undefined || databaseUrl.trim() === '') {
    throw new Error('DATABASE_URL is required');
  }

  const prisma = new PrismaClient({ adapter: createPrismaAdapter(databaseUrl) });

  try {
    const result = await seedAdmin(prisma, {
      email: adminEmail,
      nickname: process.env.ADMIN_NICKNAME,
      password: process.env.ADMIN_PASSWORD,
    });

    console.info(`ADMIN seed completed: ${result}`);
  } finally {
    await prisma.$disconnect();
  }
}

const entryPoint = process.argv[1];

if (entryPoint !== undefined && import.meta.url === pathToFileURL(entryPoint).href) {
  void runSeed().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : 'Unknown seed error';
    console.error(`ADMIN seed failed: ${message}`);
    process.exitCode = 1;
  });
}
