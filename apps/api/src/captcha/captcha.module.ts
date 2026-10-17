import { Module } from '@nestjs/common';
import { env } from '../config/env';
import { CaptchaVerifier } from './captcha-verifier';
import { MockCaptchaVerifier } from './mock-captcha-verifier';
import { TurnstileCaptchaVerifier } from './turnstile-captcha-verifier';

export function captchaVerifierFactory(): CaptchaVerifier {
  const e = env();
  return e.CAPTCHA_PROVIDER === 'turnstile' ? new TurnstileCaptchaVerifier(e.TURNSTILE_SECRET_KEY) : new MockCaptchaVerifier();
}

@Module({
  providers: [{ provide: CaptchaVerifier, useFactory: captchaVerifierFactory }],
  exports: [CaptchaVerifier],
})
export class CaptchaModule {}
