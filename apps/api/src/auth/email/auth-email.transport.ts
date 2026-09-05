import type { AuthTokenPurpose } from '../../generated/prisma/client.js';

export const AUTH_EMAIL_TRANSPORT = Symbol('AUTH_EMAIL_TRANSPORT');

export interface AuthEmailMessage {
  recipientEmail: string;
  purpose: AuthTokenPurpose;
  actionUrl: string;
  expiresAt: Date;
}

export interface AuthEmailTransport {
  send(message: AuthEmailMessage): Promise<void>;
}
