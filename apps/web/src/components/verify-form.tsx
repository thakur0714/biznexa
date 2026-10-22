'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@biznexa/ui';
import { Turnstile } from '@marsidev/react-turnstile';

const MODES = [
  { key: 'number', label: 'Certificate number', placeholder: 'e.g. BNC-2026-000123', hint: 'Printed at the top of the certificate.' },
  { key: 'id', label: 'Verification ID', placeholder: 'e.g. K7M2QX9P4TRW', hint: '12 characters, printed next to the QR code.' },
  { key: 'organization', label: 'Organisation name', placeholder: 'e.g. Demo Industries', hint: 'Lists certificates issued to organisations with this name.' },
] as const;

type Mode = (typeof MODES)[number]['key'];

export function VerifyForm({
  initialMode = 'number',
  initialValue = '',
  captchaRequired = false,
  turnstileSiteKey,
}: Readonly<{
  initialMode?: Mode;
  initialValue?: string;
  /** The API asked for a captcha (M12.3): show the challenge; solving it repeats the lookup with the token. */
  captchaRequired?: boolean;
  turnstileSiteKey?: string;
}>) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>(initialMode);
  const [value, setValue] = useState(initialValue);
  const [error, setError] = useState('');
  const m = MODES.find((x) => x.key === mode)!;

  function submit(e: React.SubmitEvent<HTMLFormElement>) {
    e.preventDefault();
    const v = value.trim();
    if (!v) return setError(`Enter the ${m.label.toLowerCase()}.`);
    if (mode === 'organization' && v.length < 3) return setError('Enter at least 3 characters of the organisation name.');
    setError('');
    router.push(`/verify?${mode}=${encodeURIComponent(v)}`);
  }

  function retryWith(token: string) {
    const v = value.trim();
    if (!v) return;
    router.push(`/verify?${new URLSearchParams({ [mode]: v, captchaToken: token })}`);
  }

  let captchaContent: React.ReactNode = (
    <p className="text-sm text-muted">Verification is busy right now. Please wait a few minutes and try again.</p>
  );
  if (turnstileSiteKey) {
    captchaContent = <Turnstile siteKey={turnstileSiteKey} onSuccess={retryWith} options={{ size: 'flexible' }} />;
  } else if (process.env.NODE_ENV !== 'production') {
    // Development without a Turnstile key: the API's mock verifier accepts the token "pass".
    captchaContent = (
      <Button type="button" variant="outline" onClick={() => retryWith('pass')}>
        I am not a robot (development)
      </Button>
    );
  }

  return (
    <form onSubmit={submit} noValidate action="/verify" method="get">
      <div role="radiogroup" aria-label="Search by" className="inline-flex flex-wrap rounded-md border border-rule bg-paper p-1 text-sm">
        {MODES.map((x) => (
          <button // NOSONAR: segmented control of buttons in an ARIA radiogroup; native radios would change its look and keys
            key={x.key}
            type="button"
            role="radio"
            aria-checked={mode === x.key}
            onClick={() => {
              setMode(x.key);
              setError('');
            }}
            className={`rounded px-3 py-1.5 font-medium ${mode === x.key ? 'bg-white text-ink shadow-sm ring-1 ring-rule' : 'text-muted hover:text-night'}`}
          >
            {x.label}
          </button>
        ))}
      </div>
      <label htmlFor="verify-input" className="sr-only">
        {m.label}
      </label>
      <div className="mt-4 flex flex-col gap-3 sm:flex-row">
        <input
          id="verify-input"
          name={mode}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={m.placeholder}
          autoComplete="off"
          spellCheck={false}
          aria-invalid={!!error}
          aria-describedby="verify-hint"
          className={`num h-13 w-full rounded-md border-2 sm:flex-1 bg-white px-4 text-lg outline-none focus:border-ink ${error ? 'border-danger' : 'border-night'}`}
        />
        <Button type="submit" variant="ink" size="lg">
          Verify
        </Button>
      </div>
      <p id="verify-hint" className={`mt-2 text-sm ${error ? 'text-danger' : 'text-muted'}`}>
        {error || m.hint}
      </p>
      {captchaRequired && (
        <div className="mt-4" data-testid="verify-captcha">
          {captchaContent}
        </div>
      )}
    </form>
  );
}
