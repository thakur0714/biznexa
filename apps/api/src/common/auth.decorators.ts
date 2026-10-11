import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';

export const IS_PUBLIC = 'isPublic';
/** Route needs no login. */
export const Public = () => SetMetadata(IS_PUBLIC, true);

export const PERMISSIONS = 'permissions';
/** Caller must hold ALL listed permissions. */
export const RequirePermissions = (...perms: string[]) => SetMetadata(PERMISSIONS, perms);

export interface AuthUser {
  id: string;
  roles: string[];
  /** Staff session that has not passed 2FA yet — `permissions` is empty until it does (D27). */
  twoFactorPending: boolean;
  permissions: string[];
}

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthUser => {
  return ctx.switchToHttp().getRequest().user;
});

/** Permission keys live in @biznexa/types so the admin app uses the same list. */
export { PERMS } from '@biznexa/types';
