import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import { createApplicationValidationPipe } from '../common/validation/validation-exception.factory.js';
import {
  expiredSessionCookieOptions,
  SESSION_COOKIE_NAME,
  sessionCookieOptions,
} from './auth.constants.js';
import { AuthGuard } from './auth.guard.js';
import { AuthService } from './auth.service.js';
import type {
  AcceptedAuthRequestResponse,
  AuthResponse,
  AuthenticatedRequest,
  IssuedSession,
  PendingVerificationResponse,
  SafeUser,
} from './auth.types.js';
import { CurrentUser } from './current-user.decorator.js';
import { AuthEmailRequestDto } from './dto/auth-email-request.dto.js';
import { LoginDto } from './dto/login.dto.js';
import { RegisterDto } from './dto/register.dto.js';
import { ResetPasswordDto } from './dto/reset-password.dto.js';
import { VerifyEmailDto } from './dto/verify-email.dto.js';

@Controller('auth')
export class AuthController {
  private readonly nodeEnv: string;

  constructor(
    @Inject(AuthService) private readonly authService: AuthService,
    @Inject(ConfigService) configService: ConfigService,
  ) {
    this.nodeEnv = configService.getOrThrow<string>('NODE_ENV');
  }

  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  @Header('Cache-Control', 'no-store')
  async register(
    @Body(createApplicationValidationPipe(RegisterDto)) dto: RegisterDto,
  ): Promise<PendingVerificationResponse> {
    await this.authService.register(dto);
    return { status: 'VERIFICATION_REQUIRED' };
  }

  @Post('verify-email')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Header('Cache-Control', 'no-store')
  async verifyEmail(
    @Body(createApplicationValidationPipe(VerifyEmailDto)) dto: VerifyEmailDto,
  ): Promise<void> {
    await this.authService.verifyEmail(dto.token);
  }

  @Post('resend-verification')
  @HttpCode(HttpStatus.ACCEPTED)
  @Header('Cache-Control', 'no-store')
  async resendVerification(
    @Body(createApplicationValidationPipe(AuthEmailRequestDto)) dto: AuthEmailRequestDto,
  ): Promise<AcceptedAuthRequestResponse> {
    await this.authService.resendVerification(dto.email);
    return { status: 'ACCEPTED' };
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  async login(
    @Body(createApplicationValidationPipe(LoginDto)) dto: LoginDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuthResponse> {
    const result = await this.authService.login(dto);
    this.setSessionCookie(response, result.session);
    return { user: result.user };
  }

  @Post('forgot-password')
  @HttpCode(HttpStatus.ACCEPTED)
  @Header('Cache-Control', 'no-store')
  async forgotPassword(
    @Body(createApplicationValidationPipe(AuthEmailRequestDto)) dto: AuthEmailRequestDto,
  ): Promise<AcceptedAuthRequestResponse> {
    await this.authService.forgotPassword(dto.email);
    return { status: 'ACCEPTED' };
  }

  @Post('reset-password')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Header('Cache-Control', 'no-store')
  async resetPassword(
    @Body(createApplicationValidationPipe(ResetPasswordDto)) dto: ResetPasswordDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    await this.authService.resetPassword(dto.token, dto.password);
    response.cookie(SESSION_COOKIE_NAME, '', expiredSessionCookieOptions(this.nodeEnv));
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Header('Cache-Control', 'no-store')
  async logout(
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    try {
      await this.authService.logout(request.cookies?.[SESSION_COOKIE_NAME]);
    } finally {
      response.cookie(SESSION_COOKIE_NAME, '', expiredSessionCookieOptions(this.nodeEnv));
    }
  }

  @Get('me')
  @UseGuards(AuthGuard)
  @Header('Cache-Control', 'no-store')
  me(@CurrentUser() user: SafeUser): AuthResponse {
    return { user };
  }

  private setSessionCookie(response: Response, session: IssuedSession): void {
    response.cookie(
      SESSION_COOKIE_NAME,
      session.rawToken,
      sessionCookieOptions(this.nodeEnv, session.expiresAt),
    );
  }
}
