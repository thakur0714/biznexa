import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { VerifyQrCaptcha } from './verify-qr-captcha';

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));
vi.mock('@marsidev/react-turnstile', () => ({
  Turnstile: ({ onSuccess }: { onSuccess: (token: string) => void }) => (
    <button type="button" onClick={() => onSuccess('turnstile-token')}>
      Turnstile widget
    </button>
  ),
}));

describe('VerifyQrCaptcha (M12.3)', () => {
  beforeEach(() => push.mockReset());

  it('shows no captcha until the API asks for one', () => {
    const { container } = render(<VerifyQrCaptcha id="TESTID12345" turnstileSiteKey="site-key" />);
    expect(screen.queryByTestId('verify-captcha')).not.toBeInTheDocument();
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the Turnstile widget and repeats the lookup with its token (without t)', () => {
    render(<VerifyQrCaptcha id="TESTID12345" captchaRequired turnstileSiteKey="site-key" />);
    fireEvent.click(screen.getByRole('button', { name: 'Turnstile widget' }));
    expect(push).toHaveBeenCalledWith('/verify/TESTID12345?captchaToken=turnstile-token');
  });

  it('shows the Turnstile widget and repeats the lookup with its token (with t)', () => {
    render(<VerifyQrCaptcha id="TESTID12345" t="signature-123" captchaRequired turnstileSiteKey="site-key" />);
    fireEvent.click(screen.getByRole('button', { name: 'Turnstile widget' }));
    expect(push).toHaveBeenCalledWith('/verify/TESTID12345?t=signature-123&captchaToken=turnstile-token');
  });

  it('offers the development shortcut when no site key is configured', () => {
    render(<VerifyQrCaptcha id="K7M2QX9P4TRW" t="sig" captchaRequired />);
    fireEvent.click(screen.getByRole('button', { name: /not a robot/i }));
    expect(push).toHaveBeenCalledWith('/verify/K7M2QX9P4TRW?t=sig&captchaToken=pass');
  });
});
