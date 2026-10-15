'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Icon } from '@/components/icons';
import { OtpStep, type OtpIssued } from '@/components/otp-step';
import { Button, EmptyState, LinkButton, Notice } from '@biznexa/ui';
import { useAuth, type SessionUser } from '@/lib/auth';
import { ClientApiError } from '@biznexa/api-client/browser';
import { useApi } from '@biznexa/api-client/react';

/** Customer portal sections (PRD 7.3). Each one comes alive in its milestone. */
const NAV = [
  { label: 'Dashboard', icon: 'clipboard', ready: true, href: '/dashboard' },
  { label: 'My Services', icon: 'file' },
  { label: 'Pending Actions', icon: 'alert' },
  { label: 'Documents', icon: 'upload' },
  { label: 'Payments', icon: 'rupee' },
  { label: 'Certificates', icon: 'badge', ready: true, href: '/dashboard/certificates' },
  { label: 'Consultations', icon: 'people' },
  { label: 'Notifications', icon: 'clock', ready: true, href: '/dashboard/notifications' },
  { label: 'Support', icon: 'phone' },
];

export function DashboardHome() {
  const { user, signIn, signOut } = useAuth();
  const api = useApi();
  const router = useRouter();
  const [verifying, setVerifying] = useState<OtpIssued | null>(null);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  if (!user) return null;

  async function startVerify() {
    setErr('');
    try {
      setVerifying(await api.call<OtpIssued>((c) => c.POST('/api/auth/otp/request', { body: { channel: 'MOBILE', target: user!.mobile ?? '', purpose: 'VERIFY_MOBILE' } })));
    } catch (e) {
      setErr((e as ClientApiError).message);
    }
  }

  async function logoutAll() {
    await api.call((c) => c.POST('/api/auth/logout-all')).catch(() => undefined);
    await signOut();
    router.replace('/login');
  }

  return (
    <div className="mx-auto grid max-w-[1180px] grid-cols-1 gap-8 px-4 py-10 sm:px-6 lg:grid-cols-[220px_1fr]">
      <nav aria-label="Account" className="min-w-0 lg:sticky lg:top-24 lg:self-start">
        <ul className="flex gap-1 overflow-x-auto lg:flex-col">
          {NAV.map((n) => (
            <li key={n.label} className="shrink-0">
              {n.href && n.ready ? (
                <Link
                  href={n.href}
                  className={`flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium ${
                    n.label === 'Dashboard' ? 'bg-ink text-white' : 'text-night hover:bg-paper'
                  }`}
                >
                  <Icon name={n.icon} size={18} />
                  {n.label}
                </Link>
              ) : (
                <span
                  aria-disabled={!n.ready}
                  className="flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium text-muted"
                >
                  <Icon name={n.icon} size={18} />
                  {n.label}
                  {!n.ready && (
                    <span className="ml-auto hidden rounded bg-paper px-1.5 text-[11px] text-muted ring-1 ring-rule lg:inline">
                      Soon
                    </span>
                  )}
                </span>
              )}
            </li>
          ))}
        </ul>
      </nav>

      <div className="min-w-0 space-y-8">
        <div>
          <h1 className="text-3xl font-bold tracking-[-0.025em]">Hello, {user.name.split(' ')[0]}</h1>
          <p className="mt-1 text-muted">Your applications, documents and certificates will appear here.</p>
        </div>

        {!user.mobileVerified && user.mobile && (
          <section className="rounded-lg border border-amber/40 bg-amber-050 p-5">
            {verifying ? (
              <div className="max-w-[420px]">
                <OtpStep<{ accessToken: string; user: SessionUser }>
                  channel="MOBILE"
                  target={user.mobile}
                  purpose="VERIFY_MOBILE"
                  issued={verifying}
                  onVerified={(s) => {
                    signIn(s);
                    setVerifying(null);
                    setMsg('Mobile number verified.');
                  }}
                />
              </div>
            ) : (
              <div className="flex flex-wrap items-center justify-between gap-4">
                <p>
                  <span className="font-semibold">Verify your mobile number</span>
                  <span className="block text-sm text-muted">We send application updates and reminders by SMS.</span>
                </p>
                <Button variant="ink" size="sm" onClick={startVerify}>
                  Send code
                </Button>
              </div>
            )}
            {err && <p className="mt-2 text-sm text-danger">{err}</p>}
          </section>
        )}
        {msg && <Notice tone="success">{msg}</Notice>}

        <section aria-labelledby="mysvc-h">
          <EmptyState
            className="p-10"
            icon={<Icon name="file" size={36} className="text-ink/40" />}
            titleAs="h2"
            titleId="mysvc-h"
            title="You haven’t started a service yet"
            description="Choose a service and package. Once you pay, its timeline and documents show up here."
            action={<LinkButton href="/services">Browse services</LinkButton>}
          />
        </section>

        <section aria-labelledby="acct-h" className="rounded-lg border border-rule bg-white p-6">
          <h2 id="acct-h" className="text-lg font-semibold">
            Account details
          </h2>
          <dl className="mt-4 grid gap-x-8 gap-y-3 text-sm sm:grid-cols-[140px_1fr]">
            <dt className="text-muted">Name</dt>
            <dd>{user.name}</dd>
            <dt className="text-muted">Email</dt>
            <dd>
              {user.email ?? '—'} {user.email && (user.emailVerified ? <span className="text-seal">· verified</span> : <span className="text-muted">· not verified</span>)}
            </dd>
            <dt className="text-muted">Mobile</dt>
            <dd className="num">
              {user.mobile ? `+91 ${user.mobile}` : '—'} {user.mobile && (user.mobileVerified ? <span className="text-seal">· verified</span> : <span className="text-amber">· not verified</span>)}
            </dd>
          </dl>
          <div className="mt-6 flex flex-wrap gap-2 border-t border-rule pt-5">
            <Button variant="outline" size="sm" onClick={() => signOut().then(() => router.replace('/'))}>
              Log out
            </Button>
            <Button variant="ghost" size="sm" onClick={logoutAll}>
              Log out of all devices
            </Button>
            <Link href="/forgot-password" className="ml-auto self-center text-sm text-ink hover:underline">
              Change password
            </Link>
          </div>
        </section>
      </div>
    </div>
  );
}
