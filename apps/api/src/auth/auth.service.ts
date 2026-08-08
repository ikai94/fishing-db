import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  InternalServerErrorException,
  UnauthorizedException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { SAFE_USER_SELECT, SESSION_CREATION_ATTEMPTS } from './auth.constants.js';
import type { LoginDto } from './dto/login.dto.js';
import type { RegisterDto } from './dto/register.dto.js';
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

@Injectable()
export class AuthService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(PasswordService) private readonly passwordService: PasswordService,
    @Inject(SessionService) private readonly sessionService: SessionService,
  ) {}

  async register(dto: RegisterDto): Promise<AuthenticatedResult> {
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

    for (let attempt = 0; attempt < SESSION_CREATION_ATTEMPTS; attempt += 1) {
      const preparedSession = this.sessionService.prepareSession();

      try {
        const result = await this.prisma.$transaction(async (transaction) => {
          const user = await transaction.user.create({
            data: {
              email,
              nickname,
              nicknameNormalized,
              passwordHash,
            },
            select: SAFE_USER_SELECT,
          });
          const session = await transaction.session.create({
            data: {
              userId: user.id,
              tokenHash: preparedSession.tokenHash,
              createdAt: preparedSession.createdAt,
              expiresAt: preparedSession.expiresAt,
            },
            select: { id: true },
          });

          return { user, sessionId: session.id };
        });

        return {
          user: safeUserFromLogin(result.user),
          session: {
            sessionId: result.sessionId,
            rawToken: preparedSession.rawToken,
            expiresAt: preparedSession.expiresAt,
          },
        };
      } catch (error: unknown) {
        if (isPrismaUniqueConstraintErrorFor(error, 'tokenHash')) {
          continue;
        }

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

    throw new InternalServerErrorException({
      statusCode: 500,
      code: 'SESSION_CREATION_FAILED',
      message: 'Не удалось создать сессию',
    });
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
            },
          });
    const passwordMatches = await this.passwordService.verifyPasswordOrDummy(
      dto.password,
      user?.passwordHash,
    );

    if (user === null || !passwordMatches) {
      throw invalidCredentialsException();
    }

    const session = await this.sessionService.createSession(user.id);

    return {
      user: safeUserFromLogin(user),
      session,
    };
  }

  async logout(rawToken: string | undefined): Promise<void> {
    await this.sessionService.deleteSession(rawToken);
  }
}
