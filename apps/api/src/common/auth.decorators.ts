import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';

export const IS_PUBLIC = 'isPublic';
/** Route needs no login. */
export const Public = () => SetMetadata(IS_PUBLIC, true);

export const PERMISSIONS = 'permissions';
/** Caller must hold ALL listed permissions. */
export const RequirePermissions = (...perms: string[]) => SetMetadata(PERMISSIONS, perms);

export const ANY_PERMISSIONS = 'anyPermissions';
/** Caller must hold AT LEAST ONE of the listed permissions. */
export const RequireAnyPermission = (...perms: string[]) => SetMetadata(ANY_PERMISSIONS, perms);

export const ACCESS = 'access';
export type Access = 'signed-in' | 'customer';
/** Any signed-in user — customer, consultant or staff; the service decides what each may see (owner or permission). */
export const SignedIn = () => SetMetadata(ACCESS, 'signed-in' satisfies Access);
/** Signed-in user with the CUSTOMER role (consultants keep it); staff accounts get 403. */
export const CustomerOnly = () => SetMetadata(ACCESS, 'customer' satisfies Access);

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
