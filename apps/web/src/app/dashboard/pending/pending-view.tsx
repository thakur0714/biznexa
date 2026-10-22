'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { type PendingActionsResponse } from '@biznexa/types';
import { ClientApiError } from '@biznexa/api-client/browser';
import { useApi } from '@biznexa/api-client/react';
import { EmptyState, LinkButton, Notice } from '@biznexa/ui';

const actionLabel: Record<PendingActionsResponse['items'][number]['kind'], string> = {
  upload_document: 'Upload document',
  reupload_document: 'Replace document',
  pay_balance: 'Pay balance',
  read_message: 'Read message',
};

export function PendingActionsView() {
  const api = useApi();
  const [result, setResult] = useState<PendingActionsResponse | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    api.call<PendingActionsResponse>((client) => client.GET('/api/pending-actions'))
      .then((response) => { if (!cancelled) setResult(response); })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setError(cause instanceof ClientApiError ? cause.message : 'We couldn’t load your pending actions.');
      });
    return () => { cancelled = true; };
  }, [api]);

  return (
    <div className="min-w-0 space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-[-0.025em]">Pending actions</h1>
        <p className="mt-1 text-muted">These are the next steps needed to keep your services moving.</p>
      </div>

      {error && <Notice tone="error">{error}</Notice>}
      {!result && !error && <output className="block text-sm text-muted">Loading your pending actions…</output>}
      {result?.items.length === 0 && (
        <EmptyState
          className="p-8"
          titleAs="h2"
          title="You’re all caught up"
          description="Documents, balances and new messages that need your attention will appear here."
          action={<LinkButton href="/dashboard/services">View my services</LinkButton>}
        />
      )}
      {result && result.items.length > 0 && (
        <ul className="space-y-3">
          {result.items.map((item) => (
            <li key={`${item.applicationId}-${item.kind}-${item.title}-${item.href}`} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-rule bg-white p-4 sm:p-5">
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted">{actionLabel[item.kind]}</p>
                <h2 className="mt-1 font-semibold">{item.title}</h2>
                <p className="mt-1 text-sm text-muted">{item.serviceName} · {item.applicationCode}</p>
              </div>
              <Link href={item.href} className="inline-flex min-h-10 shrink-0 items-center rounded-md px-3 text-sm font-semibold text-ink underline underline-offset-4 hover:bg-paper focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink">
                Take action
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
