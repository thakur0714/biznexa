/** Staff two-factor authentication (TOTP authenticator apps) — request/response contracts (D27). */
import { z } from 'zod';
import { canUseAdmin } from './permissions';

export const totpCodeSchema = z.object({
  code: z
    .string()
    .transform((v) => v.replaceAll(/\s/g, ''))
    .pipe(z.string().regex(/^\d{6}$/, 'Enter the 6-digit code from your authenticator app')),
});
export type TotpCodeInput = z.infer<typeof totpCodeSchema>;

export const twoFactorSetupSchema = z.object({
  /** Base32 secret for typing into the app by hand. */
  secret: z.string(),
  /** `otpauth://` link (what the QR code contains). */
  otpauthUrl: z.string(),
  /** PNG data URL of the QR code. */
  qrDataUrl: z.string(),
});
export type TwoFactorSetup = z.infer<typeof twoFactorSetupSchema>;

/** Returned on every session's `user`. */
export const twoFactorStateSchema = z.object({
  /** The account must use 2FA (staff with `admin.access`). */
  required: z.boolean(),
  /** An authenticator app has been set up. */
  enabled: z.boolean(),
  /** This session passed the 2FA check. */
  verified: z.boolean(),
});
export type TwoFactorState = z.infer<typeof twoFactorStateSchema>;

/** Staff accounts must use 2FA; customers do not. */
export const requiresTwoFactor = (permissions: readonly string[]) => canUseAdmin(permissions);

/** The session still has to set up or enter a 2FA code before staff permissions apply. */
export const needsTwoFactor = (s: TwoFactorState | undefined) => !!s && s.required && !s.verified;

/** Error `code` the API sends (403) when a staff route is called before 2FA is done. */
export const TWO_FACTOR_REQUIRED = 'TWO_FACTOR_REQUIRED';
