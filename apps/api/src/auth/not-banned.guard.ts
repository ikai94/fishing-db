import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { AuthenticatedRequest } from './auth.types.js';

function authRequiredException(): UnauthorizedException {
  return new UnauthorizedException({
    statusCode: 401,
    code: 'AUTH_REQUIRED',
    message: 'Требуется авторизация',
  });
}

function accountBannedException(): ForbiddenException {
  return new ForbiddenException({
    statusCode: 403,
    code: 'ACCOUNT_BANNED',
    message: 'Аккаунт заблокирован',
  });
}

@Injectable()
export class NotBannedGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const user = request.auth?.user;

    if (user === undefined) {
      throw authRequiredException();
    }

    if (user.isBanned) {
      throw accountBannedException();
    }

    return true;
  }
}
