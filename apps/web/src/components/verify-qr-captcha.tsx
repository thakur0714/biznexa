'use client';

import { useRouter } from 'next/navigation';
import { Button } from '@biznexa/ui';
import { Turnstile } from '@marsidev/react-turnstile';

export function VerifyQrCaptcha({
  id,
  t,
  captchaRequired = false,
  turnstileSiteKey,
}: {
  id: string;
  t?: string;
  captchaRequired?: boolean;
  turnstileSiteKey?: string;
}) {
  const router = useRouter();

  if (!captchaRequired) {
    return null;
  }

  function retryWith(token: string) {
    const params = new URLSearchParams();
    if (t) params.set('t', t);
    params.set('captchaToken', token);
    router.push(`/verify/${encodeURIComponent(id)}?${params.toString()}`);
  }

  return (
    <div className="mt-4" data-testid="verify-captcha">
      {turnstileSiteKey ? (
        <Turnstile siteKey={turnstileSiteKey} onSuccess={retryWith} options={{ size: 'flexible' }} />
      ) : process.env.NODE_ENV !== 'production' ? (
        // Development without a Turnstile key: the API's mock verifier accepts the token "pass".
        <Button type="button" variant="outline" onClick={() => retryWith('pass')}>
          I am not a robot (development)
        </Button>
      ) : (
        <p className="text-sm text-muted">Verification is busy right now. Please wait a few minutes and try again.</p>
      )}
    </div>
  );
}
