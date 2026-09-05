import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  InternalServerErrorException,
  UnauthorizedException,
} from '@nestjs/common';
import { setTimeout as delay } from 'node:timers/promises';
import type { AuthTokenPurpose, Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  AUTH_TOKEN_CREATION_ATTEMPTS,
  AUTH_TOKEN_ISSUANCE_COOLDOWN_MS,
  ENUMERATION_SAFE_MIN_RESPONSE_MS,
  SAFE_USER_SELECT,
} from './auth.constants.js';
import { hashAuthToken, isCanonicalAuthToken, AuthTokenService } from './auth-token.service.js';
import type { LoginDto } from './dto/login.dto.js';
import type { RegisterDto } from './dto/register.dto.js';
import { AuthEmailTokenCipher } from './email/auth-email-token-cipher.service.js';
import {
  AuthInputValidationError,
  normalizeEmail,
  normalizeNickname,
  validatePassword,
} from './normalization.js';
import { PasswordService } from './password.service.js';
import {
  isPrismaUniqueConstraintError,
  isPrismaUniqueConstraintErrorFor,
  SessionService,
} from './session.service.js';
import type { AuthenticatedResult, SafeUser } from './auth.types.js';

interface LockedUser {
  id: string;
  email: string;
  emailVerifiedAt: Date | null;
}

function validationException(error: AuthInputValidationError): BadRequestException {
  return new BadRequestException({
    statusCode: 400,
    code: 'VALIDATION_ERROR',
    message: 'Проверьте введённые данные',
    errors: [error.issue],
  });
}

function invalidCredentialsException(): UnauthorizedException {
  return new UnauthorizedException({
    statusCode: 401,
    code: 'INVALID_CREDENTIALS',
    message: 'Неверный email или пароль',
  });
}

function emailNotVerifiedException(): ForbiddenException {
  return new ForbiddenException({
    statusCode: 403,
    code: 'EMAIL_NOT_VERIFIED',
    message: 'Подтвердите email перед входом',
  });
}

function invalidAuthTokenException(purpose: AuthTokenPurpose): BadRequestException {
  const verification = purpose === 'EMAIL_VERIFICATION';
  return new BadRequestException({
    statusCode: 400,
    code: verification ? 'INVALID_OR_EXPIRED_VERIFICATION_TOKEN' : 'INVALID_OR_EXPIRED_RESET_TOKEN',
    message: verification
      ? 'Ссылка подтверждения недействительна или истекла'
      : 'Ссылка сброса пароля недействительна или истекла',
  });
}

function safeUserFromLogin(user: {
  id: string;
  email: string;
  nickname: string;
  role: 'USER' | 'ADMIN';
  isBanned: boolean;
  createdAt: Date;
}): SafeUser {
  return {
    id: user.id,
    email: user.email,
    nickname: user.nickname,
    role: user.role,
    isBanned: user.isBanned,
    createdAt: user.createdAt,
  };
}

async function waitForEnumerationSafeWindow(startedAt: number): Promise<void> {
  const remaining = ENUMERATION_SAFE_MIN_RESPONSE_MS - (Date.now() - startedAt);
  if (remaining > 0) {
    await delay(remaining);
  }
}

@Injectable()
export class AuthService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(PasswordService) private readonly passwordService: PasswordService,
    @Inject(SessionService) private readonly sessionService: SessionService,
    @Inject(AuthTokenService) private readonly authTokenService: AuthTokenService,
    @Inject(AuthEmailTokenCipher) private readonly emailTokenCipher: AuthEmailTokenCipher,
  ) {}

  async register(dto: RegisterDto): Promise<void> {
    let email: string;
    let nickname: string;
    let nicknameNormalized: string;
    let password: string;

    try {
      email = normalizeEmail(dto.email);
      ({ nickname, nicknameNormalized } = normalizeNickname(dto.nickname));
      password = validatePassword(dto.password);
    } catch (error: unknown) {
      if (error instanceof AuthInputValidationError) {
        throw validationException(error);
      }
      throw error;
    }

    const passwordHash = await this.passwordService.hashPassword(password);

    for (let attempt = 0; attempt < AUTH_TOKEN_CREATION_ATTEMPTS; attempt += 1) {
      const preparedToken = this.authTokenService.prepareToken('EMAIL_VERIFICATION');
      const encryptedToken = this.emailTokenCipher.encrypt(preparedToken.rawToken);

      try {
        await this.prisma.$transaction(async (transaction) => {
          const user = await transaction.user.create({
            data: {
              email,
              nickname,
              nicknameNormalized,
              passwordHash,
              emailVerifiedAt: null,
            },
            select: { id: true },
          });
          const token = await transaction.authToken.create({
            data: {
              userId: user.id,
              purpose: preparedToken.purpose,
              tokenHash: preparedToken.tokenHash,
              createdAt: preparedToken.createdAt,
              expiresAt: preparedToken.expiresAt,
            },
            select: { id: true },
          });
          await transaction.authEmailOutbox.create({
            data: {
              authTokenId: token.id,
              recipientEmail: email,
              encryptedToken,
              createdAt: preparedToken.createdAt,
              availableAt: preparedToken.createdAt,
            },
            select: { id: true },
          });
        });
        return;
      } catch (error: unknown) {
        if (isPrismaUniqueConstraintErrorFor(error, 'tokenHash')) {
          continue;
        }
        this.mapRegistrationConflict(error);
      }
    }

    throw new InternalServerErrorException({
      statusCode: 500,
      code: 'AUTH_TOKEN_CREATION_FAILED',
      message: 'Не удалось создать токен подтверждения',
    });
  }

  async verifyEmail(rawToken: string): Promise<void> {
    const purpose: AuthTokenPurpose = 'EMAIL_VERIFICATION';
    if (!isCanonicalAuthToken(rawToken)) {
      throw invalidAuthTokenException(purpose);
    }

    const tokenHash = hashAuthToken(rawToken);

    await this.prisma.$transaction(async (transaction) => {
      const token = await transaction.authToken.findUnique({
        where: { tokenHash },
        select: {
          id: true,
          userId: true,
          purpose: true,
          expiresAt: true,
          consumedAt: true,
          invalidatedAt: true,
        },
      });

      if (token !== null) {
        await transaction.$queryRaw`
          SELECT "id" FROM "User" WHERE "id" = ${token.userId}::uuid FOR UPDATE
        `;
      }
      const now = new Date();

      if (
        token === null ||
        token.purpose !== purpose ||
        token.consumedAt !== null ||
        token.invalidatedAt !== null ||
        token.expiresAt <= now
      ) {
        throw invalidAuthTokenException(purpose);
      }

      const consumed = await transaction.authToken.updateMany({
        where: {
          id: token.id,
          purpose,
          consumedAt: null,
          invalidatedAt: null,
          expiresAt: { gt: now },
        },
        data: { consumedAt: now },
      });

      if (consumed.count !== 1) {
        throw invalidAuthTokenException(purpose);
      }

      await transaction.user.update({
        where: { id: token.userId },
        data: { emailVerifiedAt: now },
        select: { id: true },
      });
      await this.invalidateSiblingTokens(transaction, token.userId, purpose, token.id, now);
    });
  }

  async resendVerification(emailInput: string): Promise<void> {
    await this.requestTokenByEmail(emailInput, 'EMAIL_VERIFICATION');
  }

  async forgotPassword(emailInput: string): Promise<void> {
    await this.requestTokenByEmail(emailInput, 'PASSWORD_RESET');
  }

  async login(dto: LoginDto): Promise<AuthenticatedResult> {
    let normalizedEmail: string | null = null;

    try {
      normalizedEmail = normalizeEmail(dto.email);
    } catch (error: unknown) {
      if (!(error instanceof AuthInputValidationError)) {
        throw error;
      }
    }

    const user =
      normalizedEmail === null
        ? null
        : await this.prisma.user.findUnique({
            where: { email: normalizedEmail },
            select: {
              ...SAFE_USER_SELECT,
              passwordHash: true,
              emailVerifiedAt: true,
            },
          });
    const passwordMatches = await this.passwordService.verifyPasswordOrDummy(
      dto.password,
      user?.passwordHash,
    );

    if (user === null || !passwordMatches) {
      throw invalidCredentialsException();
    }
    if (user.emailVerifiedAt === null) {
      throw emailNotVerifiedException();
    }

    const session = await this.sessionService.createSession(user.id, user.passwordHash);
    return { user: safeUserFromLogin(user), session };
  }

  async resetPassword(rawToken: string, passwordInput: string): Promise<void> {
    const purpose: AuthTokenPurpose = 'PASSWORD_RESET';
    let password: string;

    try {
      password = validatePassword(passwordInput);
    } catch (error: unknown) {
      if (error instanceof AuthInputValidationError) {
        throw validationException(error);
      }
      throw error;
    }

    if (!isCanonicalAuthToken(rawToken)) {
      throw invalidAuthTokenException(purpose);
    }

    const tokenHash = hashAuthToken(rawToken);
    const candidate = await this.prisma.authToken.findUnique({
      where: { tokenHash },
      select: { purpose: true, expiresAt: true, consumedAt: true, invalidatedAt: true },
    });
    const lookupTime = new Date();

    if (
      candidate === null ||
      candidate.purpose !== purpose ||
      candidate.consumedAt !== null ||
      candidate.invalidatedAt !== null ||
      candidate.expiresAt <= lookupTime
    ) {
      throw invalidAuthTokenException(purpose);
    }

    const passwordHash = await this.passwordService.hashPassword(password);

    await this.prisma.$transaction(async (transaction) => {
      const token = await transaction.authToken.findUnique({
        where: { tokenHash },
        select: { id: true, userId: true },
      });

      if (token === null) {
        throw invalidAuthTokenException(purpose);
      }

      await transaction.$queryRaw`
        SELECT "id" FROM "User" WHERE "id" = ${token.userId}::uuid FOR UPDATE
      `;
      const now = new Date();

      const consumed = await transaction.authToken.updateMany({
        where: {
          id: token.id,
          purpose,
          consumedAt: null,
          invalidatedAt: null,
          expiresAt: { gt: now },
          user: { emailVerifiedAt: { not: null } },
        },
        data: { consumedAt: now },
      });

      if (consumed.count !== 1) {
        throw invalidAuthTokenException(purpose);
      }

      await transaction.user.update({
        where: { id: token.userId },
        data: { passwordHash },
        select: { id: true },
      });
      await transaction.session.deleteMany({ where: { userId: token.userId } });
      await this.invalidateSiblingTokens(transaction, token.userId, purpose, token.id, now);
    });
  }

  async logout(rawToken: string | undefined): Promise<void> {
    await this.sessionService.deleteSession(rawToken);
  }

  private async requestTokenByEmail(emailInput: string, purpose: AuthTokenPurpose): Promise<void> {
    const startedAt = Date.now();

    try {
      let email: string;
      try {
        email = normalizeEmail(emailInput);
      } catch (error: unknown) {
        if (error instanceof AuthInputValidationError) {
          throw validationException(error);
        }
        throw error;
      }

      for (let attempt = 0; attempt < AUTH_TOKEN_CREATION_ATTEMPTS; attempt += 1) {
        const preparedToken = this.authTokenService.prepareToken(purpose);
        const encryptedToken = this.emailTokenCipher.encrypt(preparedToken.rawToken);

        try {
          await this.prisma.$transaction(async (transaction) => {
            const [user] = await transaction.$queryRaw<LockedUser[]>`
              SELECT "id", "email", "emailVerifiedAt"
              FROM "User"
              WHERE "email" = ${email}
              FOR UPDATE
            `;
            const eligible =
              user !== undefined &&
              (purpose === 'EMAIL_VERIFICATION'
                ? user.emailVerifiedAt === null
                : user.emailVerifiedAt !== null);

            if (!eligible || user === undefined) {
              return;
            }

            const latestActive = await transaction.authToken.findFirst({
              where: {
                userId: user.id,
                purpose,
                consumedAt: null,
                invalidatedAt: null,
              },
              orderBy: { createdAt: 'desc' },
              select: { createdAt: true },
            });

            if (
              latestActive !== null &&
              latestActive.createdAt.getTime() + AUTH_TOKEN_ISSUANCE_COOLDOWN_MS > Date.now()
            ) {
              return;
            }

            await this.invalidateActiveTokens(
              transaction,
              user.id,
              purpose,
              preparedToken.createdAt,
            );
            const token = await transaction.authToken.create({
              data: {
                userId: user.id,
                purpose,
                tokenHash: preparedToken.tokenHash,
                createdAt: preparedToken.createdAt,
                expiresAt: preparedToken.expiresAt,
              },
              select: { id: true },
            });
            await transaction.authEmailOutbox.create({
              data: {
                authTokenId: token.id,
                recipientEmail: user.email,
                encryptedToken,
                createdAt: preparedToken.createdAt,
                availableAt: preparedToken.createdAt,
              },
              select: { id: true },
            });
          });
          return;
        } catch (error: unknown) {
          if (isPrismaUniqueConstraintErrorFor(error, 'tokenHash')) {
            continue;
          }
          throw error;
        }
      }

      throw new InternalServerErrorException({
        statusCode: 500,
        code: 'AUTH_TOKEN_CREATION_FAILED',
        message: 'Не удалось создать токен',
      });
    } finally {
      await waitForEnumerationSafeWindow(startedAt);
    }
  }

  private async invalidateActiveTokens(
    transaction: Prisma.TransactionClient,
    userId: string,
    purpose: AuthTokenPurpose,
    invalidatedAt: Date,
  ): Promise<void> {
    const activeTokens = await transaction.authToken.findMany({
      where: { userId, purpose, consumedAt: null, invalidatedAt: null },
      select: { id: true },
    });
    const tokenIds = activeTokens.map(({ id }) => id);

    if (tokenIds.length === 0) {
      return;
    }

    await transaction.authToken.updateMany({
      where: { id: { in: tokenIds }, consumedAt: null, invalidatedAt: null },
      data: { invalidatedAt },
    });
    await transaction.authEmailOutbox.updateMany({
      where: { authTokenId: { in: tokenIds }, sentAt: null, cancelledAt: null },
      data: { cancelledAt: invalidatedAt, leaseUntil: null },
    });
  }

  private async invalidateSiblingTokens(
    transaction: Prisma.TransactionClient,
    userId: string,
    purpose: AuthTokenPurpose,
    consumedTokenId: string,
    invalidatedAt: Date,
  ): Promise<void> {
    const siblings = await transaction.authToken.findMany({
      where: {
        userId,
        purpose,
        id: { not: consumedTokenId },
        consumedAt: null,
        invalidatedAt: null,
      },
      select: { id: true },
    });
    const tokenIds = [consumedTokenId, ...siblings.map(({ id }) => id)];

    if (siblings.length > 0) {
      await transaction.authToken.updateMany({
        where: {
          id: { in: siblings.map(({ id }) => id) },
          consumedAt: null,
          invalidatedAt: null,
        },
        data: { invalidatedAt },
      });
    }
    await transaction.authEmailOutbox.updateMany({
      where: { authTokenId: { in: tokenIds }, sentAt: null, cancelledAt: null },
      data: { cancelledAt: invalidatedAt, leaseUntil: null },
    });
  }

  private mapRegistrationConflict(error: unknown): never {
    if (isPrismaUniqueConstraintErrorFor(error, 'email')) {
      throw new ConflictException({
        statusCode: 409,
        code: 'EMAIL_ALREADY_EXISTS',
        message: 'Пользователь с таким email уже существует',
      });
    }
    if (isPrismaUniqueConstraintErrorFor(error, 'nicknameNormalized')) {
      throw new ConflictException({
        statusCode: 409,
        code: 'NICKNAME_ALREADY_EXISTS',
        message: 'Такой никнейм уже занят',
      });
    }
    if (isPrismaUniqueConstraintError(error)) {
      throw new ConflictException({
        statusCode: 409,
        code: 'REGISTRATION_CONFLICT',
        message: 'Не удалось зарегистрировать пользователя из-за конфликта данных',
      });
    }
    throw error;
  }
}
