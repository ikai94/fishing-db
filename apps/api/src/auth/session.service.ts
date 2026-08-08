import { Inject, Injectable, InternalServerErrorException } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  SAFE_USER_SELECT,
  SESSION_CREATION_ATTEMPTS,
  SESSION_LIFETIME_MS,
  SESSION_TOKEN_BYTES,
} from './auth.constants.js';
import type { AuthenticatedContext, IssuedSession, PreparedSession } from './auth.types.js';

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

export function isPrismaUniqueConstraintError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as PrismaErrorLike).code === 'P2002';
}

export function isPrismaUniqueConstraintErrorFor(error: unknown, field: string): boolean {
  return uniqueConstraintMetadata(error).includes(field.toLowerCase());
}

export function isCanonicalSessionToken(rawToken: string): boolean {
  if (!/^[A-Za-z0-9_-]{43}$/.test(rawToken)) {
    return false;
  }

  const decoded = Buffer.from(rawToken, 'base64url');
  return decoded.length === SESSION_TOKEN_BYTES && decoded.toString('base64url') === rawToken;
}

export function hashSessionToken(rawToken: string): string {
  return createHash('sha256').update(rawToken, 'utf8').digest('hex');
}

@Injectable()
export class SessionService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  prepareSession(now = new Date()): PreparedSession {
    const rawToken = randomBytes(SESSION_TOKEN_BYTES).toString('base64url');

    return {
      rawToken,
      tokenHash: hashSessionToken(rawToken),
      createdAt: now,
      expiresAt: new Date(now.getTime() + SESSION_LIFETIME_MS),
    };
  }

  async createSession(userId: string): Promise<IssuedSession> {
    for (let attempt = 0; attempt < SESSION_CREATION_ATTEMPTS; attempt += 1) {
      const prepared = this.prepareSession();

      try {
        const session = await this.prisma.session.create({
          data: {
            userId,
            tokenHash: prepared.tokenHash,
            createdAt: prepared.createdAt,
            expiresAt: prepared.expiresAt,
          },
          select: { id: true },
        });

        return {
          sessionId: session.id,
          rawToken: prepared.rawToken,
          expiresAt: prepared.expiresAt,
        };
      } catch (error: unknown) {
        if (isPrismaUniqueConstraintErrorFor(error, 'tokenHash')) {
          continue;
        }

        throw error;
      }
    }

    throw new InternalServerErrorException({
      statusCode: 500,
      code: 'SESSION_CREATION_FAILED',
      message: 'Не удалось создать сессию',
    });
  }

  async findAuthenticatedSession(rawToken: string): Promise<AuthenticatedContext | null> {
    if (!isCanonicalSessionToken(rawToken)) {
      return null;
    }

    const session = await this.prisma.session.findFirst({
      where: {
        tokenHash: hashSessionToken(rawToken),
        expiresAt: { gt: new Date() },
      },
      select: {
        id: true,
        user: { select: SAFE_USER_SELECT },
      },
    });

    if (session === null) {
      return null;
    }

    return {
      sessionId: session.id,
      user: {
        id: session.user.id,
        email: session.user.email,
        nickname: session.user.nickname,
        role: session.user.role,
        isBanned: session.user.isBanned,
        createdAt: session.user.createdAt,
      },
    };
  }

  async deleteSession(rawToken: string | undefined): Promise<void> {
    if (rawToken === undefined || !isCanonicalSessionToken(rawToken)) {
      return;
    }

    await this.prisma.session.deleteMany({
      where: { tokenHash: hashSessionToken(rawToken) },
    });
  }
}
