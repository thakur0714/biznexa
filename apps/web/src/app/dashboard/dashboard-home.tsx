'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Icon } from '@/components/icons';
import { OtpStep, type OtpIssued } from '@/components/otp-step';
import { Button, EmptyState, LinkButton, Notice } from '@biznexa/ui';
import { useAuth, type SessionUser } from '@/lib/auth';
import { ClientApiError } from '@biznexa/api-client/browser';
import { useApi } from '@biznexa/api-client/react';
import { formatDate, formatINR, type DashboardSummary } from '@biznexa/types';
import { UpcomingDueDates } from './upcoming-due-dates';

export function DashboardHome() {
  const { user, signIn, signOut } = useAuth();
  const api = useApi();
  const router = useRouter();
  const [verifying, setVerifying] = useState<OtpIssued | null>(null);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [summaryError, setSummaryError] = useState('');
  const [summaryLoading, setSummaryLoading] = useState(true);
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    api.call<DashboardSummary>((c) => c.GET('/api/dashboard/summary'))
      .then((result) => { if (!cancelled) setSummary(result); })
      .catch(() => { if (!cancelled) setSummaryError('We couldn’t load your dashboard. Please try again.'); })
      .finally(() => { if (!cancelled) setSummaryLoading(false); });
    return () => { cancelled = true; };
  }, [api, user]);

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
    <div className="min-w-0 space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-[-0.025em]">Hello, {user.name.split(' ')[0]}</h1>
        <p className="mt-1 text-muted">Your applications, documents and certificates will appear here.</p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          ['Active applications', summary?.activeApplications.toString()],
          ['Pending actions', summary?.pendingActions.toString()],
          ['Upcoming due dates', summary?.upcomingDueDates.length.toString()],
          ['Unpaid balance', summary ? formatINR(summary.unpaidBalance) : undefined],
        ].map(([label, value]) => {
          const card = (
            <section key={label} className="min-w-0 rounded-lg border border-rule bg-white p-4 sm:p-5">
              <p className="text-xs font-medium text-muted sm:text-sm">{label}</p>
              <p className="mt-2 truncate text-xl font-bold text-night sm:text-2xl" aria-live="polite">
                {summaryLoading ? '—' : value ?? '—'}
              </p>
            </section>
          );
          return label === 'Pending actions' ? (
            <Link key={label} href="/dashboard/pending" className="rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink" aria-label="View pending actions">
              {card}
            </Link>
          ) : card;
        })}
      </div>
      {summaryError && <Notice tone="error">{summaryError}</Notice>}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-semibold">Recent activity</h2>
        <LinkButton href="/services">Buy a new service</LinkButton>
      </div>
      {!summaryLoading && summary && summary.activeApplications === 0 && summary.recentActivity.length === 0 ? (
        <EmptyState
          className="p-8"
          icon={<Icon name="file" size={32} className="text-ink/40" />}
          titleAs="h3"
          title="You haven’t started a service yet"
          description="Choose a service and package to get started. Your applications and updates will appear here."
          action={<LinkButton href="/services">Browse services</LinkButton>}
        />
      ) : (
        <section aria-label="Recent activity" className="overflow-hidden rounded-lg border border-rule bg-white">
          {summary?.recentActivity.length ? (
            <ul className="divide-y divide-rule">
              {summary.recentActivity.map((row) => (
                <li key={`${row.applicationId}-${row.changedAt}`}>
                  <Link href={`/dashboard/applications/${row.applicationId}`} className="flex flex-wrap items-center justify-between gap-2 p-4 hover:bg-paper">
                    <span className="min-w-0">
                      <span className="block truncate font-semibold">{row.serviceName}</span>
                      <span className="text-sm text-muted">{row.applicationCode} · {row.statusLabel}</span>
                    </span>
                    <time className="text-sm text-muted" dateTime={row.changedAt}>{formatDate(row.changedAt)}</time>
                  </Link>
                </li>
              ))}
            </ul>
          ) : <p className="p-5 text-sm text-muted">No recent activity yet.</p>}
        </section>
      )}

      {summary?.upcomingDueDates.length ? (
        <section className="space-y-3">
          <h2 className="text-xl font-semibold">Upcoming compliance due dates</h2>
          <ul className="grid gap-3 sm:grid-cols-2">
            {summary.upcomingDueDates.map((certificate) => (
              <li key={certificate.id} className="rounded-lg border border-rule bg-white p-4">
                <p className="font-semibold">{certificate.type}</p>
                <p className="text-sm text-muted">{certificate.number} · Valid until {formatDate(certificate.validUntil)}</p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <UpcomingDueDates />

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
  );
}
