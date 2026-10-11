import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { TWO_FACTOR_REQUIRED } from '@biznexa/types';
import { AuthUser, IS_PUBLIC, PERMISSIONS } from './auth.decorators';

/**
 * Global guard: every route requires a valid access token unless marked @Public().
 * Permission checks use the permissions embedded in the (15-minute) access token. Staff tokens carry
 * none until the session passes 2FA; such calls get 403 with `code: TWO_FACTOR_REQUIRED` (D27).
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly reflector: Reflector, private readonly jwt: JwtService) {}

  canActivate(ctx: ExecutionContext): boolean {
    const targets = [ctx.getHandler(), ctx.getClass()];
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets);
    const req = ctx.switchToHttp().getRequest();

    const header: string | undefined = req.headers['authorization'];
    const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined;

    if (token) {
      try {
        const payload = this.jwt.verify(token);
        if (payload.typ !== 'access') throw new Error('wrong token type');
        req.user = {
          id: payload.sub,
          roles: payload.roles ?? [],
          permissions: payload.perms ?? [],
          twoFactorPending: payload.tfa === 'pending',
        } satisfies AuthUser;
      } catch {
        if (!isPublic) throw new UnauthorizedException('Session expired. Please log in again.');
      }
    }

    if (isPublic) return true;
    if (!req.user) throw new UnauthorizedException('Please log in');

    const required = this.reflector.getAllAndOverride<string[]>(PERMISSIONS, targets) ?? [];
    const user: AuthUser = req.user;
    const missing = required.filter((p) => !user.permissions.includes(p));
    if (missing.length && user.twoFactorPending) {
      throw new ForbiddenException({ statusCode: 403, code: TWO_FACTOR_REQUIRED, message: 'Enter the code from your authenticator app to continue' });
    }
    if (missing.length) throw new ForbiddenException('You do not have permission to do this');
    return true;
  }
}
