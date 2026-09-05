import { apiRequest } from './api-client';

export type UserRole = 'USER' | 'ADMIN';

export type AuthUser = {
  id: string;
  email: string;
  nickname: string;
  role: UserRole;
  isBanned: boolean;
  createdAt: string;
};

type RegisterInput = {
  email: string;
  nickname: string;
  password: string;
};

type LoginInput = {
  email: string;
  password: string;
};

type AuthEmailInput = {
  email: string;
};

type ResetPasswordInput = {
  token: string;
  password: string;
};

export type RegistrationResult = {
  status: 'VERIFICATION_REQUIRED';
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isAuthUser(value: unknown): value is AuthUser {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.id === 'string' &&
    typeof value.email === 'string' &&
    typeof value.nickname === 'string' &&
    (value.role === 'USER' || value.role === 'ADMIN') &&
    typeof value.isBanned === 'boolean' &&
    typeof value.createdAt === 'string'
  );
}

function readUserResponse(payload: unknown): AuthUser {
  if (!isRecord(payload) || !isAuthUser(payload.user)) {
    throw new Error('Сервер вернул некорректный ответ');
  }

  return payload.user;
}

function readStatusResponse<TStatus extends string>(
  payload: unknown,
  status: TStatus,
): { status: TStatus } {
  if (!isRecord(payload) || payload.status !== status) {
    throw new Error('Сервер вернул некорректный ответ');
  }

  return { status };
}

export async function register(input: RegisterInput): Promise<RegistrationResult> {
  const payload = await apiRequest<unknown>('/auth/register', {
    method: 'POST',
    body: JSON.stringify(input),
  });

  return readStatusResponse(payload, 'VERIFICATION_REQUIRED');
}

export async function login(input: LoginInput): Promise<AuthUser> {
  const payload = await apiRequest<unknown>('/auth/login', {
    method: 'POST',
    body: JSON.stringify(input),
  });

  return readUserResponse(payload);
}

export async function getCurrentUser(signal?: AbortSignal): Promise<AuthUser> {
  const payload = await apiRequest<unknown>('/auth/me', { signal });

  return readUserResponse(payload);
}

export async function verifyEmail(token: string): Promise<void> {
  await apiRequest<void>('/auth/verify-email', {
    method: 'POST',
    body: JSON.stringify({ token }),
  });
}

export async function resendVerification(input: AuthEmailInput): Promise<void> {
  const payload = await apiRequest<unknown>('/auth/resend-verification', {
    method: 'POST',
    body: JSON.stringify(input),
  });

  readStatusResponse(payload, 'ACCEPTED');
}

export async function forgotPassword(input: AuthEmailInput): Promise<void> {
  const payload = await apiRequest<unknown>('/auth/forgot-password', {
    method: 'POST',
    body: JSON.stringify(input),
  });

  readStatusResponse(payload, 'ACCEPTED');
}

export async function resetPassword(input: ResetPasswordInput): Promise<void> {
  await apiRequest<void>('/auth/reset-password', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function logout(): Promise<void> {
  await apiRequest<void>('/auth/logout', { method: 'POST' });
}
