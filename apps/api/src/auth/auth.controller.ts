import { Body, Controller, Get, HttpCode, Patch, Post, Req, Res, UnauthorizedException } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOkResponse, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { z } from 'zod';
import {
  authMeResponseSchema,
  changePasswordSchema,
  loginSchema,
  otpRequestSchema,
  otpVerifySchema,
  passwordSchema,
  registerSchema,
  totpCodeSchema,
  twoFactorSetupSchema,
  updateProfileSchema,
  type ChangePasswordInput,
  type UpdateProfileInput,
} from '@biznexa/types';

import { AuthService } from './auth.service';
import { TokenService } from './token.service';
import { TwoFactorService } from './two-factor.service';
import { AuthUser, CurrentUser, Public, SignedIn } from '../common/auth.decorators';
import { ApiZodResponse, ZodBody } from '../common/openapi';
import { env } from '../config/env';
import { AUTH_LIMIT, OTP_LIMIT, REFRESH_LIMIT } from '../common/rate-limits';

export const REFRESH_COOKIE = 'bn_rt';

const meta = (req: Request) => ({ ip: req.ip, userAgent: req.headers['user-agent'] });
/** Mobile apps send X-Client: mobile and keep the refresh token in secure storage instead of a cookie. */
const isMobile = (req: Request) => req.headers['x-client'] === 'mobile';
const MOBILE_TOKEN_BODY = {
  required: false,
  description: 'Mobile apps only (with `X-Client: mobile`). Browsers send the httpOnly refresh cookie instead.',
  schema: { type: 'object', properties: { refreshToken: { type: 'string' } } },
} as const;
const twoFactorBody = totpCodeSchema.extend({
  refreshToken: z.string().optional().describe('Mobile apps only (with `X-Client: mobile`): the current refresh token, which is replaced.'),
});

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService, private readonly tokens: TokenService, private readonly twoFactor: TwoFactorService) {}

  private respond<T extends { refreshToken: string }>(req: Request, res: Response, session: T) {
    if (isMobile(req)) return session;
    res.cookie(REFRESH_COOKIE, session.refreshToken, {
      httpOnly: true,
      secure: env().NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/api/auth',
      maxAge: env().REFRESH_TTL_DAYS * 86_400_000,
    });
    const { refreshToken: _omit, ...rest } = session;
    return rest;
  }

  @Public()
  @Throttle(AUTH_LIMIT)
  @Post('register')
  async register(@ZodBody(registerSchema) body: z.infer<typeof registerSchema>, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    return this.respond(req, res, await this.auth.register(body, meta(req)));
  }

  @Public()
  @Throttle(AUTH_LIMIT)
  @HttpCode(200)
  @Post('login')
  async login(@ZodBody(loginSchema) body: z.infer<typeof loginSchema>, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    return this.respond(req, res, await this.auth.login(body.email, body.password, meta(req)));
  }

  @Public()
  @Throttle(OTP_LIMIT)
  @HttpCode(200)
  @Post('otp/request')
  requestOtp(@ZodBody(otpRequestSchema) body: z.infer<typeof otpRequestSchema>, @Req() req: Request) {
    return this.auth.requestOtp(body.channel, body.target, body.purpose, req.ip);
  }

  @Public()
  @Throttle(AUTH_LIMIT)
  @HttpCode(200)
  @Post('otp/verify')
  async verifyOtp(@ZodBody(otpVerifySchema) body: z.infer<typeof otpVerifySchema>, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const result = await this.auth.verifyOtp(body.channel, body.target, body.purpose, body.code, meta(req));
    return 'refreshToken' in result ? this.respond(req, res, result) : result;
  }

  @Public()
  @Throttle(AUTH_LIMIT)
  @HttpCode(200)
  @Post('password/reset')
  resetPassword(@ZodBody(z.object({ resetToken: z.string().min(10), password: passwordSchema })) body: { resetToken: string; password: string }) {
    return this.auth.resetPassword(body.resetToken, body.password);
  }

  @Public()
  @Throttle(AUTH_LIMIT)
  @HttpCode(200)
  @Post('google')
  async google(@ZodBody(z.object({ idToken: z.string().min(20) })) body: { idToken: string }, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    return this.respond(req, res, await this.auth.google(body.idToken, meta(req)));
  }

  @Public()
  @Throttle(REFRESH_LIMIT)
  @HttpCode(200)
  @ApiBody(MOBILE_TOKEN_BODY)
  @Post('refresh')
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response, @Body() body: { refreshToken?: string }) {
    const raw = isMobile(req) ? body?.refreshToken : req.cookies?.[REFRESH_COOKIE];
    if (!raw) throw new UnauthorizedException('Please log in');
    return this.respond(req, res, await this.auth.refresh(raw, meta(req)));
  }

  @Public()
  @HttpCode(200)
  @ApiBody(MOBILE_TOKEN_BODY)
  @Post('logout')
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response, @Body() body: { refreshToken?: string }) {
    const raw = isMobile(req) ? body?.refreshToken : req.cookies?.[REFRESH_COOKIE];
    if (raw) await this.tokens.revoke(raw);
    res.clearCookie(REFRESH_COOKIE, { path: '/api/auth' });
    return { message: 'Logged out' };
  }

  @ApiBearerAuth()
  @HttpCode(200)
  @Post('logout-all')
  @SignedIn()
  async logoutAll(@CurrentUser() user: AuthUser, @Res({ passthrough: true }) res: Response) {
    await this.tokens.revokeAll(user.id);
    res.clearCookie(REFRESH_COOKIE, { path: '/api/auth' });
    return { message: 'Logged out from all devices' };
  }

  @ApiBearerAuth()
  @ApiZodResponse('AuthMeResponse', authMeResponseSchema)
  @Get('me')
  @SignedIn()
  me(@CurrentUser() user: AuthUser) {
    return this.auth.me(user.id, user.twoFactorPending);
  }

  @ApiBearerAuth()
  @ApiZodResponse('AuthMeResponse', authMeResponseSchema)
  @ApiResponse({ status: 409, description: 'Email already in use' })
  @Patch('me')
  @SignedIn()
  updateMe(
    @ZodBody(updateProfileSchema) body: UpdateProfileInput,
    @CurrentUser() user: AuthUser,
  ) {
    return this.auth.updateProfile(user.id, body, user.twoFactorPending);
  }

  @ApiBearerAuth()
  @ApiOkResponse({ schema: { type: 'object', properties: { expiresIn: { type: 'number' }, resendAfter: { type: 'number' }, devCode: { type: 'string' } }, required: ['expiresIn', 'resendAfter'] } })
  @Throttle(OTP_LIMIT)
  @HttpCode(200)
  @Post('email/verify/request')
  @SignedIn()
  requestEmailVerification(@CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.auth.requestEmailVerification(user.id, req.ip);
  }

  @ApiBearerAuth()
  @ApiOkResponse({ schema: { type: 'object', properties: { emailVerified: { type: 'boolean' } }, required: ['emailVerified'] } })
  @Throttle(OTP_LIMIT)
  @HttpCode(200)
  @Post('email/verify/confirm')
  @SignedIn()
  confirmEmailVerification(@ZodBody(z.object({ code: z.string().regex(/^\d{6}$/) })) body: { code: string }, @CurrentUser() user: AuthUser) {
    return this.auth.confirmEmailVerification(user.id, body.code);
  }

  @ApiBearerAuth()
  @Throttle(AUTH_LIMIT)
  @HttpCode(200)
  @ApiResponse({ status: 400, description: 'Incorrect current password or invalid new password' })
  @Post('password/change')
  @SignedIn()
  async changePassword(
    @ZodBody(changePasswordSchema) body: ChangePasswordInput,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    const rawRefresh = isMobile(req) ? (req.body as { refreshToken?: string })?.refreshToken : req.cookies?.[REFRESH_COOKIE];
    return this.auth.changePassword(user.id, body, rawRefresh);
  }


  /** Staff only: authenticator-app secret + QR code. Repeating it before confirming returns the same secret. */
  @ApiBearerAuth()
  @Throttle(AUTH_LIMIT)
  @HttpCode(200)
  @ApiZodResponse('TwoFactorSetup', twoFactorSetupSchema)
  @Post('2fa/setup')
  @SignedIn()
  setupTwoFactor(@CurrentUser() user: AuthUser) {
    return this.twoFactor.setup(user.id);
  }

  /** Confirms setup with the first code; returns a new, 2FA-verified session (replaces the current one). */
  @ApiBearerAuth()
  @Throttle(AUTH_LIMIT)
  @HttpCode(200)
  @Post('2fa/enable')
  @SignedIn()
  async enableTwoFactor(@ZodBody(twoFactorBody) body: z.infer<typeof twoFactorBody>, @CurrentUser() user: AuthUser, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.twoFactor.enable(user.id, body.code, req.ip);
    return this.respond(req, res, await this.auth.twoFactorSession(user.id, this.currentRefresh(req, body), meta(req)));
  }

  /** Login step two for staff with 2FA on; returns a new, 2FA-verified session (replaces the current one). */
  @ApiBearerAuth()
  @Throttle(AUTH_LIMIT)
  @HttpCode(200)
  @Post('2fa/verify')
  @SignedIn()
  async verifyTwoFactor(@ZodBody(twoFactorBody) body: z.infer<typeof twoFactorBody>, @CurrentUser() user: AuthUser, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.twoFactor.verify(user.id, body.code);
    return this.respond(req, res, await this.auth.twoFactorSession(user.id, this.currentRefresh(req, body), meta(req)));
  }

  private currentRefresh(req: Request, body: { refreshToken?: string }): string | undefined {
    return isMobile(req) ? body?.refreshToken : req.cookies?.[REFRESH_COOKIE];
  }
}
