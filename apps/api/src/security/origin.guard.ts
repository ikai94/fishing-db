import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

@Injectable()
export class OriginGuard implements CanActivate {
  constructor(@Inject(ConfigService) private readonly configService: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    if (context.getType() !== 'http') {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();

    if (SAFE_METHODS.has(request.method.toUpperCase())) {
      return true;
    }

    const allowedOrigin = this.configService.getOrThrow<string>('WEB_ORIGIN');
    const origin = request.header('origin');

    if (origin !== undefined) {
      if (origin === allowedOrigin) {
        return true;
      }

      throw this.invalidOriginException();
    }

    const referer = request.header('referer');

    if (referer !== undefined) {
      try {
        if (new URL(referer).origin === allowedOrigin) {
          return true;
        }
      } catch {
        // Invalid Referer values are rejected below.
      }
    }

    throw this.invalidOriginException();
  }

  private invalidOriginException(): ForbiddenException {
    return new ForbiddenException({
      statusCode: 403,
      code: 'INVALID_REQUEST_ORIGIN',
      message: 'Недопустимый источник запроса',
    });
  }
}
