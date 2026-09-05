import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const CIPHER_NAME = 'aes-256-gcm';
const ENVELOPE_PREFIX = 'aes-256-gcm.v1';
const IV_BYTES = 12;

function canonicalBase64Url(value: string): Buffer | null {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    return null;
  }

  const decoded = Buffer.from(value, 'base64url');
  return decoded.toString('base64url') === value ? decoded : null;
}

@Injectable()
export class AuthEmailTokenCipher {
  private readonly key: Buffer;

  constructor(@Inject(ConfigService) configService: ConfigService) {
    this.key = Buffer.from(
      configService.getOrThrow<string>('AUTH_EMAIL_TOKEN_ENCRYPTION_KEY'),
      'base64url',
    );
  }

  encrypt(rawToken: string): string {
    const initializationVector = randomBytes(IV_BYTES);
    const cipher = createCipheriv(CIPHER_NAME, this.key, initializationVector);
    const ciphertext = Buffer.concat([cipher.update(rawToken, 'utf8'), cipher.final()]);
    const authenticationTag = cipher.getAuthTag();

    return [
      ENVELOPE_PREFIX,
      initializationVector.toString('base64url'),
      authenticationTag.toString('base64url'),
      ciphertext.toString('base64url'),
    ].join('.');
  }

  decrypt(envelope: string): string {
    const parts = envelope.split('.');

    if (parts.length !== 5 || `${parts[0]}.${parts[1]}` !== ENVELOPE_PREFIX) {
      throw new Error('Invalid auth email token envelope');
    }

    const initializationVector = canonicalBase64Url(parts[2] ?? '');
    const authenticationTag = canonicalBase64Url(parts[3] ?? '');
    const ciphertext = canonicalBase64Url(parts[4] ?? '');

    if (
      initializationVector === null ||
      initializationVector.length !== IV_BYTES ||
      authenticationTag === null ||
      authenticationTag.length !== 16 ||
      ciphertext === null
    ) {
      throw new Error('Invalid auth email token envelope');
    }

    try {
      const decipher = createDecipheriv(CIPHER_NAME, this.key, initializationVector);
      decipher.setAuthTag(authenticationTag);
      return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
    } catch {
      throw new Error('Invalid auth email token envelope');
    }
  }
}
