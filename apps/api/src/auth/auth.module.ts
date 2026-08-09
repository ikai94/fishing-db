import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module.js';
import { AdminGuard } from './admin.guard.js';
import { AuthController } from './auth.controller.js';
import { AuthGuard } from './auth.guard.js';
import { AuthService } from './auth.service.js';
import { PasswordService } from './password.service.js';
import { SessionService } from './session.service.js';

@Module({
  imports: [PrismaModule],
  controllers: [AuthController],
  providers: [AuthService, PasswordService, SessionService, AuthGuard, AdminGuard],
  exports: [AuthGuard, AdminGuard, PasswordService, SessionService],
})
export class AuthModule {}
