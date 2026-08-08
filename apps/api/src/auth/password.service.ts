import { Injectable } from '@nestjs/common';
import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { validatePassword } from './normalization.js';

const SCRYPT_N = 65_536;
const SCRYPT_R = 8;
const SCRYPT_P = 2;
const SCRYPT_KEY_LENGTH = 64;
const SCRYPT_SALT_BYTES = 16;
const SCRYPT_MAX_MEMORY_BYTES = 128 * 1_024 * 1_024;

const MIN_SAFE_N = 16_384;
const MAX_SAFE_N = SCRYPT_N;
const MIN_SAFE_KEY_LENGTH = 32;
const MAX_SAFE_KEY_LENGTH = SCRYPT_KEY_LENGTH;
const MIN_SAFE_SALT_BYTES = 16;
const MAX_SAFE_SALT_BYTES = 64;

interface ParsedPasswordHash {
  n: number;
  r: number;
  p: number;
  keyLength: number;
  salt: Buffer;
  expectedHash: Buffer;
}

const DUMMY_PASSWORD_HASH = [
  '',
  'scrypt',
  'v=1',
  `N=${SCRYPT_N},r=${SCRYPT_R},p=${SCRYPT_P},dk=${SCRYPT_KEY_LENGTH}`,
  Buffer.alloc(SCRYPT_SALT_BYTES).toString('base64url'),
  Buffer.alloc(SCRYPT_KEY_LENGTH).toString('base64url'),
].join('$');

function decodeCanonicalBase64Url(value: string): Buffer | null {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    return null;
  }

  const decoded = Buffer.from(value, 'base64url');
  return decoded.toString('base64url') === value ? decoded : null;
}

function isPowerOfTwo(value: number): boolean {
  return value > 0 && (value & (value - 1)) === 0;
}

function parsePasswordHash(encodedHash: string): ParsedPasswordHash | null {
  const parts = encodedHash.split('$');

  if (parts.length !== 6 || parts[0] !== '' || parts[1] !== 'scrypt' || parts[2] !== 'v=1') {
    return null;
  }

  const parameters = /^N=(\d+),r=(\d+),p=(\d+),dk=(\d+)$/.exec(parts[3] ?? '');

  if (parameters === null) {
    return null;
  }

  const n = Number(parameters[1]);
  const r = Number(parameters[2]);
  const p = Number(parameters[3]);
  const keyLength = Number(parameters[4]);

  if (
    !Number.isSafeInteger(n) ||
    !isPowerOfTwo(n) ||
    n < MIN_SAFE_N ||
    n > MAX_SAFE_N ||
    r !== SCRYPT_R ||
    !Number.isSafeInteger(p) ||
    p < 1 ||
    p > SCRYPT_P ||
    !Number.isSafeInteger(keyLength) ||
    keyLength < MIN_SAFE_KEY_LENGTH ||
    keyLength > MAX_SAFE_KEY_LENGTH
  ) {
    return null;
  }

  const salt = decodeCanonicalBase64Url(parts[4] ?? '');
  const expectedHash = decodeCanonicalBase64Url(parts[5] ?? '');

  if (
    salt === null ||
    salt.length < MIN_SAFE_SALT_BYTES ||
    salt.length > MAX_SAFE_SALT_BYTES ||
    expectedHash === null ||
    expectedHash.length !== keyLength
  ) {
    return null;
  }

  return { n, r, p, keyLength, salt, expectedHash };
}

function derivePassword(password: string, parsed: ParsedPasswordHash): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(
      password,
      parsed.salt,
      parsed.keyLength,
      {
        N: parsed.n,
        r: parsed.r,
        p: parsed.p,
        maxmem: SCRYPT_MAX_MEMORY_BYTES,
      },
      (error, derivedKey) => {
        if (error !== null) {
          reject(error);
          return;
        }

        resolve(derivedKey);
      },
    );
  });
}

async function verifyParsedPassword(
  password: string,
  parsed: ParsedPasswordHash,
): Promise<boolean> {
  const actualHash = await derivePassword(password, parsed);
  return timingSafeEqual(actualHash, parsed.expectedHash);
}

@Injectable()
export class PasswordService {
  async hashPassword(password: string): Promise<string> {
    validatePassword(password);

    const salt = randomBytes(SCRYPT_SALT_BYTES);
    const parsed: ParsedPasswordHash = {
      n: SCRYPT_N,
      r: SCRYPT_R,
      p: SCRYPT_P,
      keyLength: SCRYPT_KEY_LENGTH,
      salt,
      expectedHash: Buffer.alloc(SCRYPT_KEY_LENGTH),
    };
    const passwordHash = await derivePassword(password, parsed);

    return [
      '',
      'scrypt',
      'v=1',
      `N=${SCRYPT_N},r=${SCRYPT_R},p=${SCRYPT_P},dk=${SCRYPT_KEY_LENGTH}`,
      salt.toString('base64url'),
      passwordHash.toString('base64url'),
    ].join('$');
  }

  async verifyPassword(password: string, encodedHash: string): Promise<boolean> {
    const parsed = parsePasswordHash(encodedHash);

    if (parsed === null) {
      return false;
    }

    return verifyParsedPassword(password, parsed);
  }

  async verifyPasswordOrDummy(password: string, encodedHash?: string): Promise<boolean> {
    const storedHash = encodedHash === undefined ? null : parsePasswordHash(encodedHash);
    const dummyHash = parsePasswordHash(DUMMY_PASSWORD_HASH);

    if (dummyHash === null) {
      throw new Error('Internal dummy password hash is invalid');
    }

    const matches = await verifyParsedPassword(password, storedHash ?? dummyHash);
    return storedHash !== null && matches;
  }
}
