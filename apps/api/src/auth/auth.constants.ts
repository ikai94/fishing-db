import type { CookieOptions } from 'express';

export const SESSION_COOKIE_NAME = 'fishing_session';
export const SESSION_LIFETIME_MS = 30 * 24 * 60 * 60 * 1_000;
export const SESSION_TOKEN_BYTES = 32;
export const SESSION_CREATION_ATTEMPTS = 3;

export const SAFE_USER_SELECT = {
  id: true,
  email: true,
  nickname: true,
  role: true,
  isBanned: true,
  createdAt: true,
} as const;

function baseCookieOptions(nodeEnv: string): CookieOptions {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: nodeEnv === 'production',
    path: '/',
  };
}

export function sessionCookieOptions(nodeEnv: string, expiresAt: Date): CookieOptions {
  return {
    ...baseCookieOptions(nodeEnv),
    maxAge: SESSION_LIFETIME_MS,
    expires: expiresAt,
  };
}

export function expiredSessionCookieOptions(nodeEnv: string): CookieOptions {
  return {
    ...baseCookieOptions(nodeEnv),
    maxAge: 0,
    expires: new Date(0),
  };
}
