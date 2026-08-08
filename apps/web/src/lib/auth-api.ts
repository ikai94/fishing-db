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

export async function register(input: RegisterInput): Promise<AuthUser> {
  const payload = await apiRequest<unknown>('/auth/register', {
    method: 'POST',
    body: JSON.stringify(input),
  });

  return readUserResponse(payload);
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

export async function logout(): Promise<void> {
  await apiRequest<void>('/auth/logout', { method: 'POST' });
}
