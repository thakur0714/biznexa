/**
 * Checks a CAPTCHA token from the browser (M12.3). Injected by Nest like `PaymentGateway`: `turnstile` in
 * production, `mock` for dev/test (refused in production by the env check).
 */
export abstract class CaptchaVerifier {
  abstract readonly name: 'mock' | 'turnstile';
  /** True only for a token the provider confirms; any provider error counts as not verified. */
  abstract verify(token: string, ip?: string): Promise<boolean>;
}
