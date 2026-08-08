import {
  type CanActivate,
  type ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { SESSION_COOKIE_NAME } from './auth.constants.js';
import type { AuthenticatedRequest } from './auth.types.js';
import { SessionService } from './session.service.js';

function authRequiredException(): UnauthorizedException {
  return new UnauthorizedException({
    statusCode: 401,
    code: 'AUTH_REQUIRED',
    message: 'Требуется авторизация',
  });
}

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(@Inject(SessionService) private readonly sessionService: SessionService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const rawToken = request.cookies?.[SESSION_COOKIE_NAME];

    if (rawToken === undefined) {
      throw authRequiredException();
    }

    const authenticatedContext = await this.sessionService.findAuthenticatedSession(rawToken);

    if (authenticatedContext === null) {
      throw authRequiredException();
    }

    request.auth = authenticatedContext;
    return true;
  }
}
