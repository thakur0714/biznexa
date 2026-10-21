import { CanActivate, ExecutionContext, ForbiddenException, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { TWO_FACTOR_REQUIRED } from '@biznexa/types';
import { ACCESS, Access, AuthUser, IS_PUBLIC, PERMISSIONS, ANY_PERMISSIONS } from './auth.decorators';

/**
 * Global guard: every route requires a valid access token unless marked @Public(), and must declare who may call
 * it — @Public(), @SignedIn(), @CustomerOnly(), @RequirePermissions() or @RequireAnyPermission(). A route that
 * declares none is refused for everyone (fail closed, D63); the route × role matrix test also fails on it.
 * Permission checks use the permissions embedded in the (15-minute) access token. Staff tokens carry
 * none until the session passes 2FA; such calls get 403 with `code: TWO_FACTOR_REQUIRED` (D27).
 */
@Injectable()
export class AuthGuard implements CanActivate {
  private readonly logger = new Logger(AuthGuard.name);
  constructor(private readonly reflector: Reflector, private readonly jwt: JwtService) {}

  canActivate(ctx: ExecutionContext): boolean {
    const targets = [ctx.getHandler(), ctx.getClass()];
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets);
    const req = ctx.switchToHttp().getRequest();
    this.attachUser(req, isPublic);

    if (isPublic) return true;
    if (!req.user) throw new UnauthorizedException('Please log in');

    const access = this.reflector.getAllAndOverride<Access | undefined>(ACCESS, targets);
    const required = this.reflector.getAllAndOverride<string[]>(PERMISSIONS, targets) ?? [];
    const anyRequired = this.reflector.getAllAndOverride<string[]>(ANY_PERMISSIONS, targets) ?? [];
    const user: AuthUser = req.user;
    if (!access && !required.length && !anyRequired.length) {
      this.logger.error(`${req.method} ${req.originalUrl ?? req.url}: route has no access decorator — refused`);
      throw new ForbiddenException('This route has no access rule');
    }
    if (access === 'customer' && !user.roles.includes('CUSTOMER')) throw new ForbiddenException('This is only available to customer accounts');
    const missing = required.filter((p) => !user.permissions.includes(p));
    const missingAny = anyRequired.length > 0 && !anyRequired.some((p) => user.permissions.includes(p));
    if (missing.length || missingAny) {
      if (user.twoFactorPending) {
        throw new ForbiddenException({ statusCode: 403, code: TWO_FACTOR_REQUIRED, message: 'Enter the code from your authenticator app to continue' });
      }
      throw new ForbiddenException('You do not have permission to do this');
    }
    return true;
  }

  /** Sets req.user from a valid access token. A bad token fails the request unless the route is public. */
  private attachUser(req: { headers: Record<string, string | undefined>; user?: AuthUser }, isPublic: boolean) {
    const header = req.headers['authorization'];
    const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
    if (!token) return;
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
}
