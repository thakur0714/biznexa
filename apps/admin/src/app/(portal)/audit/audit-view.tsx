'use client';

import { useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Button, Field, Notice, Pagination } from '@biznexa/ui';
import { useApi } from '@biznexa/api-client/react';
import { NotAllowed } from '@/components/portal-shell';
import { useAuth } from '@/lib/auth';
import { canSee, findNavItem } from '@/lib/nav';
import { formatDate } from '@biznexa/types';

export function AuditLogView() {
  const { user } = useAuth();
  const item = findNavItem('audit');
  if (!user || !item) return null;
  if (!canSee(item, user.permissions)) return <NotAllowed />;

  return <AuditLogPage />;
}

function AuditLogPage() {
  const api = useApi();
  const router = useRouter();
  const params = useSearchParams();

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const filter = useMemo(() => {
    return {
      actorId: params.get('actorId') || undefined,
      entityType: params.get('entityType') || undefined,
      entityId: params.get('entityId') || undefined,
      action: params.get('action') || undefined,
      from: params.get('from') || undefined,
      to: params.get('to') || undefined,
      page: Number(params.get('page')) || 1,
      limit: 50,
    };
  }, [params]);

  const [data, setData] = useState<any | null>(null);

  useMemo(() => {
    setLoading(true);
    let cancelled = false;
    api.call((c) => c.GET('/api/admin/audit', { params: { query: filter as any } }))
      .then((d) => {
        if (!cancelled) {
          setData(d);
          setLoading(false);
          setError(null);
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setError(e.message);
          setLoading(false);
        }
      });
    return () => { cancelled = true; };
  }, [api, filter]);

  const updateFilter = (key: string, value: string) => {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    if (key !== 'page') next.set('page', '1');
    router.push('?' + next.toString());
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold tracking-[-0.02em]">Audit Log</h1>
      <form
        className="grid grid-cols-2 gap-4 sm:grid-cols-4"
        onSubmit={(e) => e.preventDefault()}
      >
        <Field label="Actor ID" value={filter.actorId || ''} onChange={(e) => updateFilter('actorId', e.target.value)} />
        <Field label="Entity Type" value={filter.entityType || ''} onChange={(e) => updateFilter('entityType', e.target.value)} />
        <Field label="Entity ID" value={filter.entityId || ''} onChange={(e) => updateFilter('entityId', e.target.value)} />
        <Field label="Action" value={filter.action || ''} onChange={(e) => updateFilter('action', e.target.value)} />
        <Field label="From (IST)" type="date" value={filter.from?.split('T')[0] || ''} onChange={(e) => updateFilter('from', e.target.value ? new Date(e.target.value + 'T00:00:00+05:30').toISOString() : '')} />
        <Field label="To (IST)" type="date" value={filter.to?.split('T')[0] || ''} onChange={(e) => updateFilter('to', e.target.value ? new Date(e.target.value + 'T23:59:59+05:30').toISOString() : '')} />
      </form>

      {error && <Notice tone="error">{error}</Notice>}

      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm whitespace-nowrap">
          <thead>
            <tr className="border-b text-muted">
              <th className="py-2 pr-4 font-medium">Time</th>
              <th className="py-2 pr-4 font-medium">Actor</th>
              <th className="py-2 pr-4 font-medium">Action</th>
              <th className="py-2 pr-4 font-medium">Entity</th>
              <th className="py-2 pr-4 font-medium">Before</th>
              <th className="py-2 font-medium">After</th>
            </tr>
          </thead>
          <tbody className="align-top">
            {loading ? (
              <tr>
                <td colSpan={6} className="py-4 text-center text-muted">Loading...</td>
              </tr>
            ) : !data?.items.length ? (
              <tr>
                <td colSpan={6} className="py-4 text-center text-muted">No records found.</td>
              </tr>
            ) : (
              data.items.map((log: any) => (
                <tr key={log.id} className="border-b">
                  <td className="py-3 pr-4">{formatDate(log.createdAt)}</td>
                  <td className="py-3 pr-4">
                    {log.actorName ? \`\${log.actorName} (\${log.actorEmail})\` : log.actorId || 'System'}
                  </td>
                  <td className="py-3 pr-4">{log.action}</td>
                  <td className="py-3 pr-4">{log.entityType} {log.entityId}</td>
                  <td className="py-3 pr-4">
                    <pre className="text-xs overflow-auto max-w-xs">{JSON.stringify(log.before, null, 2)}</pre>
                  </td>
                  <td className="py-3">
                    <pre className="text-xs overflow-auto max-w-xs">{JSON.stringify(log.after, null, 2)}</pre>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {data && data.pages > 1 && (
        <Pagination
          page={data.page}
          pages={data.pages}
          onPage={(p) => updateFilter('page', String(p))}
        />
      )}
    </div>
  );
}
