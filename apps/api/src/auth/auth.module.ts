import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaModule } from '../prisma/prisma.module.js';
import { AdminGuard } from './admin.guard.js';
import { AuthController } from './auth.controller.js';
import { AuthGuard } from './auth.guard.js';
import { AuthService } from './auth.service.js';
import { AuthTokenService } from './auth-token.service.js';
import { AuthEmailDispatcher } from './email/auth-email-dispatcher.service.js';
import { AUTH_EMAIL_TRANSPORT, type AuthEmailTransport } from './email/auth-email.transport.js';
import { AuthEmailTokenCipher } from './email/auth-email-token-cipher.service.js';
import { ConsoleAuthEmailTransport } from './email/console-auth-email.transport.js';
import { SmtpAuthEmailTransport } from './email/smtp-auth-email.transport.js';
import { NotBannedGuard } from './not-banned.guard.js';
import { PasswordService } from './password.service.js';
import { SessionService } from './session.service.js';

@Module({
  imports: [PrismaModule],
  controllers: [AuthController],
  providers: [
    AuthService,
    PasswordService,
    SessionService,
    AuthTokenService,
    AuthEmailTokenCipher,
    {
      provide: AUTH_EMAIL_TRANSPORT,
      inject: [ConfigService],
      useFactory: (configService: ConfigService): AuthEmailTransport =>
        configService.getOrThrow<string>('AUTH_EMAIL_DELIVERY_MODE') === 'smtp'
          ? new SmtpAuthEmailTransport(configService)
          : new ConsoleAuthEmailTransport(),
    },
    AuthEmailDispatcher,
    AuthGuard,
    AdminGuard,
    NotBannedGuard,
  ],
  exports: [AuthGuard, AdminGuard, NotBannedGuard, PasswordService, SessionService],
})
export class AuthModule {}
