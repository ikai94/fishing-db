import type { Request } from 'express';

export type SafeUserRole = 'USER' | 'ADMIN';

export interface SafeUser {
  id: string;
  email: string;
  nickname: string;
  role: SafeUserRole;
  isBanned: boolean;
  createdAt: Date;
}

export interface AuthResponse {
  user: SafeUser;
}

export interface PreparedSession {
  rawToken: string;
  tokenHash: string;
  createdAt: Date;
  expiresAt: Date;
}

export interface IssuedSession {
  sessionId: string;
  rawToken: string;
  expiresAt: Date;
}

export interface AuthenticatedContext {
  sessionId: string;
  user: SafeUser;
}

export interface AuthenticatedRequest extends Request {
  cookies: Record<string, string | undefined>;
  auth?: AuthenticatedContext;
}

export interface AuthenticatedResult {
  user: SafeUser;
  session: IssuedSession;
}

export interface PendingVerificationResponse {
  status: 'VERIFICATION_REQUIRED';
}

export interface AcceptedAuthRequestResponse {
  status: 'ACCEPTED';
}
