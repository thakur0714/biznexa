'use client';

import { useMemo, useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Button, Field, Notice, Select } from '@biznexa/ui';
import { useApi } from '@biznexa/api-client/react';
import { NotAllowed } from '@/components/portal-shell';
import { useAuth } from '@/lib/auth';
import { canSee, findNavItem } from '@/lib/nav';
import { APPLICATION_STATUS_LABEL, formatDate } from '@biznexa/types';

export function ApplicationsView() {
  const { user } = useAuth();
  const item = findNavItem('applications');
  if (!user || !item) return null;
  if (!canSee(item, user.permissions)) return <NotAllowed />;

  return <ApplicationsPage />;
}

function ApplicationsPage() {
  const api = useApi();
  const router = useRouter();
  const params = useSearchParams();

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const filter = useMemo(() => {
    return {
      status: params.get('status') ? params.get('status')?.split(',') : undefined,
      serviceId: params.get('serviceId') || undefined,
      assignee: params.get('assignee') || undefined,
      priority: params.get('priority') || undefined,
      sla: params.get('sla') || undefined,
      from: params.get('from') || undefined,
      to: params.get('to') || undefined,
      q: params.get('q') || undefined,
      sort: params.get('sort') || 'createdAt',
      dir: params.get('dir') || 'desc',
      page: Number(params.get('page')) || 1,
      limit: 25,
    };
  }, [params]);

  const [data, setData] = useState<import('@biznexa/types').AdminApplicationPage | null>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    let cancelled = false;
    api.call((c) => c.GET('/api/admin/applications', { params: { query: filter as unknown as Record<string, never> } }))
      .then((d) => {
        if (!cancelled) {
          setData(d as any);
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

  const downloadCSV = async () => {
    try {
      const blob = await api.call((c) => c.GET('/api/admin/applications/export', { params: { query: filter as unknown as Record<string, never> }, parseAs: 'blob' }));
      const url = URL.createObjectURL(blob as Blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `applications-${new Date().toLocaleDateString('en-GB', { timeZone: 'Asia/Kolkata' }).split('/').reverse().join('-')}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      alert(e.message);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center flex-wrap gap-4">
        <h1 className="text-2xl font-bold tracking-[-0.02em]">Applications</h1>
        <Button variant="outline" onClick={downloadCSV}>Export CSV</Button>
      </div>

      <form className="grid grid-cols-2 gap-4 sm:grid-cols-4" onSubmit={(e) => e.preventDefault()}>
        <Field id="filter-q" label="Search" value={filter.q || ''} onChange={(e) => updateFilter('q', e.target.value)} />
        <Select id="filter-status" label="Status" value={filter.status?.join(',') || ''} onChange={(e) => updateFilter('status', e.target.value)}>
          <option value="">All (except DRAFT)</option>
          {Object.entries(APPLICATION_STATUS_LABEL).map(([val, label]) => (
            <option key={val} value={val}>{label}</option>
          ))}
        </Select>
        <Select id="filter-priority" label="Priority" value={filter.priority || ''} onChange={(e) => updateFilter('priority', e.target.value)}>
          <option value="">All</option>
          <option value="LOW">Low</option>
          <option value="MEDIUM">Medium</option>
          <option value="HIGH">High</option>
          <option value="URGENT">Urgent</option>
        </Select>
        <Select id="filter-assignee" label="Assignee" value={filter.assignee || ''} onChange={(e) => updateFilter('assignee', e.target.value)}>
          <option value="">All</option>
          <option value="me">Me</option>
          <option value="unassigned">Unassigned</option>
        </Select>
      </form>

      {error && <Notice tone="error">{error}</Notice>}

      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm whitespace-nowrap">
          <thead>
            <tr className="border-b text-muted">
              <th className="py-2 pr-4 font-medium">Code</th>
              <th className="py-2 pr-4 font-medium">Status</th>
              <th className="py-2 pr-4 font-medium">Priority</th>
              <th className="py-2 pr-4 font-medium">Service</th>
              <th className="py-2 pr-4 font-medium">Customer</th>
              <th className="py-2 pr-4 font-medium">Assigned To</th>
              <th className="py-2 font-medium">Created</th>
            </tr>
          </thead>
          <tbody className="align-top">
            {loading ? (
              <tr><td colSpan={7} className="py-4 text-center text-muted">Loading...</td></tr>
            ) : !data?.items.length ? (
              <tr><td colSpan={7} className="py-4 text-center text-muted">No applications found.</td></tr>
            ) : (
              data.items.map((app: any) => (
                <tr key={app.id} className="border-b">
                  <td className="py-3 pr-4 font-medium text-night">
                    <a href={`/applications/${app.id}`} className="hover:underline">{app.code}</a>
                  </td>
                  <td className="py-3 pr-4">{APPLICATION_STATUS_LABEL[app.status as keyof typeof APPLICATION_STATUS_LABEL] || app.status}</td>
                  <td className="py-3 pr-4">{app.priority}</td>
                  <td className="py-3 pr-4">{app.service.name}</td>
                  <td className="py-3 pr-4">{app.customer?.name}</td>
                  <td className="py-3 pr-4">{app.assignedTo?.name || '-'}</td>
                  <td className="py-3">{formatDate(app.createdAt)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {data && data.total > data.limit && (
        <div className="flex gap-4">
          <Button disabled={data.page === 1} onClick={() => updateFilter('page', String(data.page - 1))}>Previous</Button>
          <span className="text-sm self-center">Page {data.page} of {Math.ceil(data.total / data.limit)}</span>
          <Button disabled={data.page * data.limit >= data.total} onClick={() => updateFilter('page', String(data.page + 1))}>Next</Button>
        </div>
      )}
    </div>
  );
}
