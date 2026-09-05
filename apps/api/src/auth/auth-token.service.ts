import { Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import type { AuthTokenPurpose } from '../generated/prisma/client.js';
import {
  AUTH_TOKEN_BYTES,
  EMAIL_VERIFICATION_LIFETIME_MS,
  PASSWORD_RESET_LIFETIME_MS,
} from './auth.constants.js';

export interface PreparedAuthToken {
  rawToken: string;
  tokenHash: string;
  purpose: AuthTokenPurpose;
  createdAt: Date;
  expiresAt: Date;
}

export function isCanonicalAuthToken(rawToken: string): boolean {
  if (!/^[A-Za-z0-9_-]{43}$/.test(rawToken)) {
    return false;
  }

  const decoded = Buffer.from(rawToken, 'base64url');
  return decoded.length === AUTH_TOKEN_BYTES && decoded.toString('base64url') === rawToken;
}

export function hashAuthToken(rawToken: string): string {
  return createHash('sha256').update(rawToken, 'utf8').digest('hex');
}

function tokenLifetime(purpose: AuthTokenPurpose): number {
  return purpose === 'EMAIL_VERIFICATION'
    ? EMAIL_VERIFICATION_LIFETIME_MS
    : PASSWORD_RESET_LIFETIME_MS;
}

@Injectable()
export class AuthTokenService {
  prepareToken(purpose: AuthTokenPurpose, now = new Date()): PreparedAuthToken {
    const rawToken = randomBytes(AUTH_TOKEN_BYTES).toString('base64url');

    return {
      rawToken,
      tokenHash: hashAuthToken(rawToken),
      purpose,
      createdAt: now,
      expiresAt: new Date(now.getTime() + tokenLifetime(purpose)),
    };
  }
}
