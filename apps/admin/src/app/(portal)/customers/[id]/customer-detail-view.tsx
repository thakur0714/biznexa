'use client';

import { useEffect, useState, useMemo } from 'react';
import { useApi } from '@biznexa/api-client/react';
import { useAuth } from '@/lib/auth';
import { canSee, findNavItem } from '@/lib/nav';
import { NotAllowed } from '@/components/portal-shell';
import { type AdminCustomerDetail, formatDate, formatINR } from '@biznexa/types';
import { Badge, Button, Notice, Dialog, Field, useToast, type Tone } from '@biznexa/ui';
import { DataTable } from '@/components/data-table';
import { createColumnHelper } from '@tanstack/react-table';
import Link from 'next/link';

const USER_STATUS_BADGES: Record<string, { label: string; tone: Tone }> = {
  ACTIVE: { label: 'Active', tone: 'success' },
  BLOCKED: { label: 'Blocked', tone: 'danger' },
  DEACTIVATED: { label: 'Deactivated', tone: 'neutral' },
  PENDING_DELETION: { label: 'Pending Deletion', tone: 'warning' },
  DELETED: { label: 'Deleted', tone: 'neutral' },
};

const APPLICATION_STATUS_BADGES: Record<string, { label: string; tone: Tone }> = {
  DRAFT: { label: 'Draft', tone: 'neutral' },
  SUBMITTED: { label: 'Submitted', tone: 'info' },
  IN_REVIEW: { label: 'In Review', tone: 'warning' },
  APPROVED: { label: 'Approved', tone: 'success' },
  REJECTED: { label: 'Rejected', tone: 'danger' },
};

const ORDER_STATUS_BADGES: Record<string, { label: string; tone: Tone }> = {
  CREATED: { label: 'Created', tone: 'neutral' },
  PAYMENT_PENDING: { label: 'Payment Pending', tone: 'warning' },
  PARTIALLY_PAID: { label: 'Partially Paid', tone: 'info' },
  PAID: { label: 'Paid', tone: 'success' },
  CANCELLED: { label: 'Cancelled', tone: 'danger' },
  REFUNDED: { label: 'Refunded', tone: 'neutral' },
};

const PAYMENT_STATUS_BADGES: Record<string, { label: string; tone: Tone }> = {
  PENDING: { label: 'Pending', tone: 'warning' },
  SUCCESS: { label: 'Success', tone: 'success' },
  FAILED: { label: 'Failed', tone: 'danger' },
};

const appHelper = createColumnHelper<AdminCustomerDetail['applications'][number]>();
const appColumns = [
  appHelper.accessor('code', {
    header: 'App Code',
    cell: (info) => (
      <Link href={`/applications/${info.row.original.id}`} className="font-medium text-ink hover:underline">
        {info.getValue()}
      </Link>
    ),
  }),
  appHelper.accessor('serviceName', {
    header: 'Service',
  }),
  appHelper.accessor('status', {
    header: 'Status',
    cell: (info) => {
      const s = info.getValue();
      const badge = APPLICATION_STATUS_BADGES[s];
      return badge ? <Badge tone={badge.tone}>{badge.label}</Badge> : <Badge>{s}</Badge>;
    },
  }),
  appHelper.accessor('createdAt', {
    header: 'Date',
    cell: (info) => <span className="text-muted whitespace-nowrap">{formatDate(info.getValue())}</span>,
  }),
];

const entityHelper = createColumnHelper<AdminCustomerDetail['businessEntities'][number]>();
const entityColumns = [
  entityHelper.accessor('name', { header: 'Name' }),
  entityHelper.accessor('type', { header: 'Type' }),
];

const orderHelper = createColumnHelper<AdminCustomerDetail['orders'][number]>();
const orderColumns = [
  orderHelper.accessor('code', { header: 'Order Code' }),
  orderHelper.accessor('total', {
    header: 'Total',
    cell: (info) => formatINR(info.getValue()),
  }),
  orderHelper.accessor('amountPaid', {
    header: 'Paid',
    cell: (info) => formatINR(info.getValue()),
  }),
  orderHelper.accessor('status', {
    header: 'Status',
    cell: (info) => {
      const s = info.getValue();
      const badge = ORDER_STATUS_BADGES[s];
      return badge ? <Badge tone={badge.tone}>{badge.label}</Badge> : <Badge>{s}</Badge>;
    },
  }),
  orderHelper.accessor('createdAt', {
    header: 'Date',
    cell: (info) => <span className="text-muted whitespace-nowrap">{formatDate(info.getValue())}</span>,
  }),
];

const paymentHelper = createColumnHelper<AdminCustomerDetail['payments'][number]>();
const paymentColumns = [
  paymentHelper.accessor('amount', {
    header: 'Amount',
    cell: (info) => formatINR(info.getValue()),
  }),
  paymentHelper.accessor('status', {
    header: 'Status',
    cell: (info) => {
      const s = info.getValue();
      const badge = PAYMENT_STATUS_BADGES[s];
      return badge ? <Badge tone={badge.tone}>{badge.label}</Badge> : <Badge>{s}</Badge>;
    },
  }),
  paymentHelper.accessor('createdAt', {
    header: 'Date',
    cell: (info) => <span className="text-muted whitespace-nowrap">{formatDate(info.getValue())}</span>,
  }),
];

export function CustomerDetailView({ id }: Readonly<{ id: string }>) {
  const api = useApi();
  const { user } = useAuth();
  const toast = useToast();

  const [data, setData] = useState<AdminCustomerDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [targetStatus, setTargetStatus] = useState<'ACTIVE' | 'BLOCKED' | 'DEACTIVATED' | null>(null);
  const [reason, setReason] = useState('');
  const [statusUpdateError, setStatusUpdateError] = useState<string | null>(null);
  const [isUpdating, setIsUpdating] = useState(false);

  const canView = useMemo(() => {
    if (!user?.permissions) return false;
    const item = findNavItem('customers');
    return item ? canSee(item, user.permissions) : false;
  }, [user]);

  const canManage = user?.permissions?.includes('customers.manage') ?? false;

  useEffect(() => {
    if (!canView) return;
    let cancel = false;

    async function load() {
      try {
        setLoadError(null);
        const res = await api.call<AdminCustomerDetail>((c) =>
          c.GET('/api/admin/customers/{id}', { params: { path: { id } } })
        );
        if (cancel) return;
        setData(res);
      } catch (err: unknown) {
        if (!cancel) setLoadError((err as Error).message || 'Failed to load customer');
      }
    }
    void load();
    return () => {
      cancel = true;
    };
  }, [api, canView, id, reload]);

  const handleStatusChange = async (e: React.SubmitEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!targetStatus || reason.trim().length < 3) return;

    setIsUpdating(true);
    setStatusUpdateError(null);
    try {
      await api.call((c) =>
        c.PATCH('/api/admin/customers/{id}/status', {
          params: { path: { id } },
          body: { status: targetStatus, reason },
        })
      );
      setReload((r) => r + 1);
      setIsDialogOpen(false);
      setReason('');
      setTargetStatus(null);
      toast('Customer status updated successfully.', 'success');
    } catch (err: unknown) {
      setStatusUpdateError((err as Error).message || 'Failed to update status');
    } finally {
      setIsUpdating(false);
    }
  };

  if (user && !canView) {
    return <NotAllowed />;
  }

  if (loadError) {
    return (
      <div className="space-y-3">
        <Notice tone="error">{loadError}</Notice>
        <Button variant="outline" size="sm" onClick={() => setReload((n) => n + 1)}>
          Try again
        </Button>
      </div>
    );
  }

  if (!data) {
    return (
      <output className="block text-muted">
        Loading customer details…
      </output>
    );
  }

  const { profile, businessEntities, applications, orders, payments } = data;
  const statusBadge = USER_STATUS_BADGES[profile.status];

  return (
    <div className="max-w-[1200px] space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-[-0.02em]">{profile.name}</h1>
          <div className="mt-1 flex items-center gap-2">
            {statusBadge ? (
              <Badge tone={statusBadge.tone}>{statusBadge.label}</Badge>
            ) : (
              <Badge>{profile.status}</Badge>
            )}
            <span className="text-muted">ID: {profile.id}</span>
          </div>
        </div>

        {canManage && (
          <div className="flex gap-2">
            {profile.status !== 'ACTIVE' && (
              <Button
                variant="outline"
                onClick={() => {
                  setTargetStatus('ACTIVE');
                  setIsDialogOpen(true);
                }}
              >
                Reactivate
              </Button>
            )}
            {profile.status !== 'BLOCKED' && (
              <Button
                variant="outline"
                onClick={() => {
                  setTargetStatus('BLOCKED');
                  setIsDialogOpen(true);
                }}
              >
                Block
              </Button>
            )}
            {profile.status !== 'DEACTIVATED' && (
              <Button
                variant="outline"
                onClick={() => {
                  setTargetStatus('DEACTIVATED');
                  setIsDialogOpen(true);
                }}
              >
                Deactivate
              </Button>
            )}
          </div>
        )}
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <section className="rounded-lg border border-rule p-4">
          <h2 className="mb-4 text-lg font-semibold">Profile Details</h2>
          <dl className="space-y-2 text-sm">
            <div className="flex">
              <dt className="w-24 text-muted">Email:</dt>
              <dd>{profile.email || '—'}</dd>
            </div>
            <div className="flex">
              <dt className="w-24 text-muted">Mobile:</dt>
              <dd>{profile.mobile || '—'}</dd>
            </div>
            <div className="flex">
              <dt className="w-24 text-muted">Joined:</dt>
              <dd>{formatDate(profile.createdAt)}</dd>
            </div>
          </dl>
        </section>

        <section>
          <h2 className="mb-3 text-lg font-semibold">Business Entities</h2>
          <DataTable
            data={businessEntities}
            columns={entityColumns}
            getRowId={(r) => r.id}
            caption="Business Entities"
            empty={<p className="text-muted">No business entities.</p>}
          />
        </section>
      </div>

      <section>
        <h2 className="mb-3 text-lg font-semibold">Applications</h2>
        <DataTable
          data={applications}
          columns={appColumns}
          getRowId={(r) => r.id}
          caption="Applications"
          empty={<p className="text-muted">No applications.</p>}
        />
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold">Orders</h2>
        <DataTable
          data={orders}
          columns={orderColumns}
          getRowId={(r) => r.id}
          caption="Orders"
          empty={<p className="text-muted">No orders.</p>}
        />
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold">Payments</h2>
        <DataTable
          data={payments}
          columns={paymentColumns}
          getRowId={(r) => r.id}
          caption="Payments"
          empty={<p className="text-muted">No payments.</p>}
        />
      </section>

      {canManage && targetStatus && (
        <Dialog
          open={isDialogOpen}
          onClose={() => setIsDialogOpen(false)}
          title={`Change Status to ${targetStatus}`}
        >
          <form onSubmit={handleStatusChange} className="space-y-4">
            <p className="text-sm text-muted">
              Please provide a reason for changing the customer&apos;s status to <strong>{targetStatus}</strong>.
            </p>
            {statusUpdateError && <Notice tone="error">{statusUpdateError}</Notice>}
            <Field
              id="reason"
              label="Reason"
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              minLength={3}
              maxLength={500}
              required
              disabled={isUpdating}
            />
            <div className="flex justify-end gap-2 mt-4">
              <Button type="button" variant="outline" onClick={() => setIsDialogOpen(false)} disabled={isUpdating}>
                Cancel
              </Button>
              <Button type="submit" disabled={isUpdating || reason.trim().length < 3}>
                {isUpdating ? 'Saving...' : 'Save'}
              </Button>
            </div>
          </form>
        </Dialog>
      )}
    </div>
  );
}
