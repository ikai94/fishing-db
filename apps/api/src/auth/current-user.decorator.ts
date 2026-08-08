import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { AuthenticatedRequest, SafeUser } from './auth.types.js';

export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): SafeUser | undefined => {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    return request.auth?.user;
  },
);
