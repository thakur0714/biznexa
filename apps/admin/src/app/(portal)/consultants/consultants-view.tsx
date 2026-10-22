'use client';

import { useEffect, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react';
import Link from 'next/link';
import { useApi } from '@biznexa/api-client/react';
import { consultantVerificationStatuses, type AdminConsultantList, type ConsultantVerificationStatus } from '@biznexa/types';
import { Button, EmptyState, Notice, Select } from '@biznexa/ui';
import { NotAllowed } from '@/components/portal-shell';
import { useAuth } from '@/lib/auth';
import { canSee, findNavItem } from '@/lib/nav';

const statusLabel: Record<ConsultantVerificationStatus, string> = {
  PENDING: 'Pending', APPROVED: 'Approved', REJECTED: 'Rejected', SUSPENDED: 'Suspended',
};

export function ConsultantsView() {
  const api = useApi();
  const { user } = useAuth();
  const item = findNavItem('consultants');
  const [status, setStatus] = useState<ConsultantVerificationStatus | ''>('PENDING');
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<AdminConsultantList | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    api.call((client) => client.GET('/api/admin/consultants', {
      params: { query: { status: status || undefined, page, limit: 25 } },
    })).then((value) => {
      if (!cancelled) { setResult(value); setError(''); }
    }).catch((cause: unknown) => {
      if (!cancelled) setError(cause instanceof Error ? cause.message : 'Could not load consultants.');
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [api, status, page]);

  if (!user || !item) return null;
  if (!canSee(item, user.permissions)) return <NotAllowed />;

  let applicationsContent: ReactNode;
  if (loading) applicationsContent = <output className="block">Loading consultant applications…</output>;
  else if (result?.items.length) applicationsContent = <ConsultantApplicationTable result={result} page={page} setLoading={setLoading} setPage={setPage} />;
  else applicationsContent = <EmptyState title="No consultant applications" description="Applications matching this status will appear here." />;

  return (
    <main className="space-y-5 p-4 sm:p-6" aria-labelledby="consultants-heading">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div><h1 id="consultants-heading" className="text-2xl font-semibold">Consultant applications</h1><p className="mt-1 text-sm text-muted">Review profiles and verification documents.</p></div>
        <Select id="consultant-status-filter" label="Status" className="w-full max-w-xs" value={status} onChange={(event) => { setLoading(true); setStatus(event.target.value as ConsultantVerificationStatus | ''); setPage(1); }}>
            <option value="">All statuses</option>
            {consultantVerificationStatuses.map((entry) => <option key={entry} value={entry}>{statusLabel[entry]}</option>)}
        </Select>
      </header>
      {error && <Notice tone="error">{error}</Notice>}
      {applicationsContent}
    </main>
  );
}

function ConsultantApplicationTable({ result, page, setLoading, setPage }: Readonly<{ result: AdminConsultantList; page: number; setLoading: Dispatch<SetStateAction<boolean>>; setPage: Dispatch<SetStateAction<number>> }>) {
  return <>
          <div className="overflow-x-auto rounded-lg border border-rule bg-white">
            <table className="w-full min-w-[680px] text-left text-sm">
              <thead className="bg-paper text-xs uppercase text-muted"><tr><th className="p-3">Applicant</th><th className="p-3">Category</th><th className="p-3">Location</th><th className="p-3">Experience</th><th className="p-3">Status</th><th className="p-3">Review</th></tr></thead>
              <tbody>{result.items.map((consultant) => <tr key={consultant.id} className="border-t border-rule">
                <td className="p-3"><div className="font-medium">{consultant.name}</div><div className="text-muted">{consultant.email}</div></td>
                <td className="p-3">{consultant.category.replaceAll('_', ' ')}</td>
                <td className="p-3">{consultant.city}, {consultant.state}</td>
                <td className="p-3">{consultant.experienceYears} years</td>
                <td className="p-3">{statusLabel[consultant.verificationStatus]}</td>
                <td className="p-3"><Link className="font-semibold text-link underline" href={`/consultants/${consultant.id}`}>Open review</Link></td>
              </tr>)}</tbody>
            </table>
          </div>
          <div className="flex items-center justify-between gap-3 text-sm"><span>{result.total} applications · page {result.page}</span><div className="flex gap-2"><Button variant="outline" disabled={page <= 1} onClick={() => { setLoading(true); setPage((current) => current - 1); }}>Previous</Button><Button variant="outline" disabled={page * result.limit >= result.total} onClick={() => { setLoading(true); setPage((current) => current + 1); }}>Next</Button></div></div>
        </>;
}
