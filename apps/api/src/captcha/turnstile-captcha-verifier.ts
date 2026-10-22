import { Logger } from '@nestjs/common';
import { CaptchaVerifier } from './captcha-verifier';

const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

/** Cloudflare Turnstile, checked server-side with the secret key. */
export class TurnstileCaptchaVerifier extends CaptchaVerifier {
  readonly name = 'turnstile' as const;
  private readonly log = new Logger('Captcha');

  constructor(private readonly secretKey: string) {
    super();
  }

  async verify(token: string, ip?: string): Promise<boolean> {
    const form = new URLSearchParams({ secret: this.secretKey, response: token });
    if (ip) form.set('remoteip', ip);
    try {
      const res = await fetch(SITEVERIFY_URL, { method: 'POST', body: form, signal: AbortSignal.timeout(5000) });
      if (!res.ok) {
        this.log.error(`Turnstile siteverify answered ${res.status}`);
        return false;
      }
      const data = (await res.json()) as { success?: boolean };
      return data.success === true;
    } catch (e) {
      this.log.error(`Turnstile siteverify failed: ${(e as Error).message}`);
      return false;
    }
  }
}
