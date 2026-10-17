import { CaptchaVerifier } from './captcha-verifier';

/** Dev/test only: the token `pass` is valid, anything else is not. */
export class MockCaptchaVerifier extends CaptchaVerifier {
  readonly name = 'mock' as const;

  async verify(token: string): Promise<boolean> {
    return token === 'pass';
  }
}
