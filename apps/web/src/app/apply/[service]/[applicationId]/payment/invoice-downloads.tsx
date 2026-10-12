'use client';

import { useEffect, useState } from 'react';
import { formatDate, formatINR, type FileLinkResult, type InvoiceSummary } from '@biznexa/types';
import { ClientApiError } from '@biznexa/api-client/browser';
import { useApi } from '@biznexa/api-client/react';
import { Button } from '@biznexa/ui';
import { Icon } from '@/components/icons';

/** The invoice and its PDF follow the webhook by a few seconds (M3.23): check every 3 s for up to 90 s. */
const POLL_MS = 3_000;
const GIVE_UP_MS = 90_000;

/**
 * The invoices of this application's order (an advance and its balance each have one), each with a
 * "Download invoice" button that fetches a 5-minute signed link and opens it. `paidKey` changes when another
 * payment lands, so its invoice is looked for too.
 */
export function InvoiceDownloads({ applicationId, paidKey }: { applicationId: string; paidKey: number }) {
  const api = useApi();
  const [invoices, setInvoices] = useState<InvoiceSummary[] | null>(null);
  const [opening, setOpening] = useState<string | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const from = Date.now();
    async function tick() {
      try {
        const list = await api.call<InvoiceSummary[]>((c) => c.GET('/api/invoices', { params: { query: { applicationId } } }));
        if (!live) return;
        setInvoices(list);
        if (list.length && list.every((i) => i.pdfReady)) return;
      } catch {
        // A blip: try again on the next tick.
      }
      if (live && Date.now() - from < GIVE_UP_MS) timer = setTimeout(() => void tick(), POLL_MS);
    }
    void tick();
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [api, applicationId, paidKey]);

  async function download(id: string) {
    setOpening(id);
    setError('');
    try {
      const link = await api.call<FileLinkResult>((c) => c.POST('/api/invoices/{id}/link', { params: { path: { id }, query: { disposition: 'attachment' } } }));
      window.location.assign(link.url);
    } catch (e) {
      setError(e instanceof ClientApiError ? e.message : 'Could not download the invoice. Please try again.');
    } finally {
      setOpening(null);
    }
  }

  if (!invoices) return null;
  return (
    <div className="mt-6 rounded-lg border border-rule bg-white p-5 sm:p-6">
      <h2 className="text-sm font-semibold">{invoices.length > 1 ? 'Invoices' : 'Invoice'}</h2>
      {!invoices.length ? (
        <p className="mt-2 text-sm text-muted" role="status">
          Your invoice is being prepared. It will also be in your dashboard.
        </p>
      ) : (
        <ul className="mt-3 divide-y divide-rule">
          {invoices.map((inv) => (
            <li key={inv.id} className="flex flex-col gap-3 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between">
              <div className="num text-sm">
                <p className="font-semibold">{inv.number}</p>
                <p className="text-muted">
                  {formatDate(inv.issuedAt)} · {formatINR(inv.total, true)}
                </p>
              </div>
              {inv.pdfReady ? (
                <Button type="button" variant="outline" size="sm" onClick={() => void download(inv.id)} disabled={opening !== null} aria-busy={opening === inv.id}>
                  <Icon name="file" size={16} />
                  {opening === inv.id ? 'Opening…' : 'Download invoice'}
                </Button>
              ) : (
                <p className="text-sm text-muted" role="status">
                  Preparing PDF…
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
      {error && (
        <p className="mt-3 text-sm text-danger" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
