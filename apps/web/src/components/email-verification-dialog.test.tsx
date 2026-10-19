import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ call: vi.fn(), refresh: vi.fn(), close: vi.fn() }));
vi.mock('@biznexa/api-client/react', () => ({ useApi: () => ({ call: mocks.call }) }));
vi.mock('@/lib/auth', () => ({ useAuth: () => ({ refresh: mocks.refresh }) }));
vi.mock('@biznexa/ui', () => ({
  Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props}>{children}</button>,
  Field: ({ label, ...props }: React.InputHTMLAttributes<HTMLInputElement> & { label: string }) => <label>{label}<input {...props} /></label>,
  Notice: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
  Dialog: ({ open, title, children, footer }: { open: boolean; title: string; children?: React.ReactNode; footer?: React.ReactNode }) => open ? <section><h2>{title}</h2>{children}{footer}</section> : null,
}));

import { EmailVerificationDialog } from './email-verification-dialog';

describe('EmailVerificationDialog', () => {
  beforeEach(() => { mocks.call.mockReset().mockResolvedValue({}); mocks.refresh.mockReset().mockResolvedValue(undefined); mocks.close.mockReset(); });

  it('requests and confirms a six-digit code, then refreshes the signed-in user', async () => {
    render(<EmailVerificationDialog open onClose={mocks.close} />);
    fireEvent.click(screen.getByRole('button', { name: 'Send code' }));
    expect(await screen.findByLabelText('Verification code')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Verification code'), { target: { value: '12a34567' } });
    expect((screen.getByLabelText('Verification code') as HTMLInputElement).value).toBe('123456');
    fireEvent.click(screen.getByRole('button', { name: 'Verify email' }));
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalledOnce());
    expect(mocks.call).toHaveBeenCalledTimes(2);
    expect(mocks.close).toHaveBeenCalledOnce();
  });
});
