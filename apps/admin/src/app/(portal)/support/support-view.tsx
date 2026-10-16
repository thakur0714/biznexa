'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  formatDate,
  formatDateTime,
  TICKET_TRANSITIONS,
  type AdminTicketDetail,
  type AdminTicketSummary,
  type EligibleStaff,
  type TicketPriority,
  type TicketStatus,
} from '@biznexa/types';
import { Badge, Button, EmptyState, Field, Notice, Select, TextArea, type Tone } from '@biznexa/ui';
import { useApi } from '@biznexa/api-client/react';
import { NotAllowed } from '@/components/portal-shell';
import { useAuth } from '@/lib/auth';
import { canSee, findNavItem } from '@/lib/nav';

const STATUS_CONFIG: Record<TicketStatus, { label: string; tone: Tone }> = {
  OPEN: { label: 'Open', tone: 'info' },
  IN_PROGRESS: { label: 'In Progress', tone: 'warning' },
  WAITING_FOR_CUSTOMER: { label: 'Waiting for Customer', tone: 'danger' },
  RESOLVED: { label: 'Resolved', tone: 'success' },
  CLOSED: { label: 'Closed', tone: 'neutral' },
};

const PRIORITY_CONFIG: Record<TicketPriority, { label: string; tone: Tone }> = {
  LOW: { label: 'Low', tone: 'neutral' },
  MEDIUM: { label: 'Medium', tone: 'info' },
  HIGH: { label: 'High', tone: 'warning' },
  URGENT: { label: 'Urgent', tone: 'danger' },
};

export function formatDuration(from: Date | string, to: Date | string): string {
  const ms = Math.max(0, new Date(to).getTime() - new Date(from).getTime());
  const mins = Math.floor(ms / (1000 * 60));
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(ms / (1000 * 60 * 60));
  const remMins = mins % 60;
  if (hours < 24) return remMins > 0 ? `${hours}h ${remMins}m` : `${hours}h`;
  const days = Math.floor(hours / 24);
  const remHours = hours % 24;
  return remHours > 0 ? `${days}d ${remHours}h` : `${days}d`;
}

export function getSlaInfo(
  createdAt: string,
  firstResponseAt: string | null | undefined,
  status: TicketStatus,
): { label: string; tone: Tone } {
  if (firstResponseAt) {
    const elapsed = formatDuration(createdAt, firstResponseAt);
    return {
      label: `First reply: ${elapsed}`,
      tone: 'success',
    };
  }
  if (status === 'RESOLVED' || status === 'CLOSED') {
    return {
      label: 'Closed without staff response',
      tone: 'neutral',
    };
  }
  const elapsed = formatDuration(createdAt, new Date());
  const ms = Math.max(0, Date.now() - new Date(createdAt).getTime());
  const hours = ms / (1000 * 60 * 60);
  const tone: Tone = hours >= 24 ? 'danger' : hours >= 4 ? 'warning' : 'info';
  return {
    label: `Awaiting response: ${elapsed}`,
    tone,
  };
}

export function SupportView() {
  const { user } = useAuth();
  const item = findNavItem('support');

  if (!user || !item) return null;
  if (!canSee(item, user.permissions)) return <NotAllowed />;

  return <SupportQueue />;
}

function SupportQueue() {
  const api = useApi();

  // Queue state
  const [tickets, setTickets] = useState<AdminTicketSummary[] | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const limit = 25;
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Filters
  const [statusFilter, setStatusFilter] = useState<TicketStatus | ''>('');
  const [priorityFilter, setPriorityFilter] = useState<TicketPriority | ''>('');
  const [assigneeFilter, setAssigneeFilter] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState('');

  // Eligible staff list
  const [staffList, setStaffList] = useState<EligibleStaff[]>([]);

  // Selected ticket detail state
  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(null);
  const [ticketDetail, setTicketDetail] = useState<AdminTicketDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  // Detail actions state
  const [updatingStatus, setUpdatingStatus] = useState(false);
  const [selectedNextStatus, setSelectedNextStatus] = useState<TicketStatus | ''>('');
  const [statusActionError, setStatusActionError] = useState<string | null>(null);

  const [updatingPriority, setUpdatingPriority] = useState(false);
  const [priorityActionError, setPriorityActionError] = useState<string | null>(null);

  const [updatingAssignee, setUpdatingAssignee] = useState(false);
  const [assigneeActionError, setAssigneeActionError] = useState<string | null>(null);

  // Reply state
  const [replyBody, setReplyBody] = useState('');
  const [internalNote, setInternalNote] = useState('');
  const [sendingReply, setSendingReply] = useState(false);
  const [replyError, setReplyError] = useState<string | null>(null);

  // Initial load of staff and tickets
  useEffect(() => {
    let cancelled = false;

    api
      .call((c) => c.GET('/api/admin/tickets/staff'))
      .then(
        (staff) => {
          if (!cancelled) setStaffList(staff);
        },
        () => {},
      );

    return () => {
      cancelled = true;
    };
  }, [api]);

  useEffect(() => {
    let cancelled = false;

    api
      .call((c) =>
        c.GET('/api/admin/tickets', {
          params: {
            query: {
              status: statusFilter || undefined,
              priority: priorityFilter || undefined,
              assignee: assigneeFilter || undefined,
              q: searchQuery.trim() || undefined,
              page,
              limit,
            },
          },
        }),
      )
      .then(
        (res) => {
          if (!cancelled) {
            setTickets(res.items);
            setTotal(res.total);
            setLoadError(null);
            setLoading(false);
          }
        },
        (err: unknown) => {
          if (!cancelled) {
            setLoadError(err instanceof Error ? err.message : 'Failed to load support queue');
            setLoading(false);
          }
        },
      );

    return () => {
      cancelled = true;
    };
  }, [api, statusFilter, priorityFilter, assigneeFilter, searchQuery, page]);

  const refreshQueue = async () => {
    try {
      const res = await api.call((c) =>
        c.GET('/api/admin/tickets', {
          params: {
            query: {
              status: statusFilter || undefined,
              priority: priorityFilter || undefined,
              assignee: assigneeFilter || undefined,
              q: searchQuery.trim() || undefined,
              page,
              limit,
            },
          },
        }),
      );
      setTickets(res.items);
      setTotal(res.total);
    } catch {
      // non-critical
    }
  };

  const openTicketDetail = async (id: string) => {
    setSelectedTicketId(id);
    setDetailLoading(true);
    setDetailError(null);
    setStatusActionError(null);
    setPriorityActionError(null);
    setAssigneeActionError(null);
    setReplyError(null);
    setSelectedNextStatus('');
    try {
      const detail = await api.call((c) =>
        c.GET('/api/admin/tickets/{id}', {
          params: { path: { id } },
        }),
      );
      setTicketDetail(detail);
    } catch (err: unknown) {
      setDetailError(err instanceof Error ? err.message : 'Failed to load ticket details');
    } finally {
      setDetailLoading(false);
    }
  };

  const closeTicketDetail = () => {
    setSelectedTicketId(null);
    setTicketDetail(null);
    setDetailError(null);
  };

  const handleUpdateStatus = async (nextStatus: TicketStatus) => {
    if (!ticketDetail) return;
    setUpdatingStatus(true);
    setStatusActionError(null);
    try {
      await api.call((c) =>
        c.PATCH('/api/admin/tickets/{id}/status', {
          params: { path: { id: ticketDetail.id } },
          body: { status: nextStatus },
        }),
      );
      await openTicketDetail(ticketDetail.id);
      await refreshQueue();
    } catch (err: unknown) {
      setStatusActionError(err instanceof Error ? err.message : 'Failed to update status');
    } finally {
      setUpdatingStatus(false);
    }
  };

  const handleUpdatePriority = async (newPriority: TicketPriority) => {
    if (!ticketDetail) return;
    setUpdatingPriority(true);
    setPriorityActionError(null);
    try {
      await api.call((c) =>
        c.PATCH('/api/admin/tickets/{id}/priority', {
          params: { path: { id: ticketDetail.id } },
          body: { priority: newPriority },
        }),
      );
      await openTicketDetail(ticketDetail.id);
      await refreshQueue();
    } catch (err: unknown) {
      setPriorityActionError(err instanceof Error ? err.message : 'Failed to update priority');
    } finally {
      setUpdatingPriority(false);
    }
  };

  const handleUpdateAssignee = async (newAssigneeId: string) => {
    if (!ticketDetail) return;
    setUpdatingAssignee(true);
    setAssigneeActionError(null);
    try {
      await api.call((c) =>
        c.PATCH('/api/admin/tickets/{id}/assignee', {
          params: { path: { id: ticketDetail.id } },
          body: { assignedToId: newAssigneeId || null },
        }),
      );
      await openTicketDetail(ticketDetail.id);
      await refreshQueue();
    } catch (err: unknown) {
      setAssigneeActionError(err instanceof Error ? err.message : 'Failed to update assignee');
    } finally {
      setUpdatingAssignee(false);
    }
  };

  const handleSendReply = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ticketDetail || !replyBody.trim()) return;

    setSendingReply(true);
    setReplyError(null);

    try {
      await api.call((c) =>
        c.POST('/api/admin/tickets/{id}/reply', {
          params: { path: { id: ticketDetail.id } },
          body: {
            body: replyBody.trim(),
            internalNote: internalNote.trim() || undefined,
          },
        }),
      );

      setReplyBody('');
      setInternalNote('');
      await openTicketDetail(ticketDetail.id);
      await refreshQueue();
    } catch (err: unknown) {
      setReplyError(err instanceof Error ? err.message : 'Failed to send reply');
    } finally {
      setSendingReply(false);
    }
  };

  const allowedTransitions = useMemo(() => {
    if (!ticketDetail) return [];
    return TICKET_TRANSITIONS[ticketDetail.status] || [];
  }, [ticketDetail]);

  // If viewing ticket detail
  if (selectedTicketId) {
    return (
      <div className="mx-auto max-w-5xl space-y-6">
        <div>
          <button
            type="button"
            onClick={closeTicketDetail}
            className="inline-flex items-center gap-1.5 text-sm font-medium text-ink hover:underline"
          >
            ← Back to support queue
          </button>
        </div>

        {detailLoading && !ticketDetail && (
          <div className="rounded-xl border border-rule bg-white p-8 text-center text-sm text-muted">
            Loading ticket details...
          </div>
        )}

        {detailError && (
          <Notice tone="error">
            <p className="font-medium">{detailError}</p>
          </Notice>
        )}

        {ticketDetail && (
          <div className="space-y-6">
            {/* Header info */}
            <div className="rounded-xl border border-rule bg-white p-6 shadow-xs">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-sm font-semibold text-muted">{ticketDetail.code}</span>
                    <Badge tone={STATUS_CONFIG[ticketDetail.status]?.tone ?? 'neutral'}>
                      {STATUS_CONFIG[ticketDetail.status]?.label ?? ticketDetail.status}
                    </Badge>
                    <Badge tone={PRIORITY_CONFIG[ticketDetail.priority]?.tone ?? 'neutral'}>
                      {PRIORITY_CONFIG[ticketDetail.priority]?.label ?? ticketDetail.priority}
                    </Badge>
                    <Badge tone={getSlaInfo(ticketDetail.createdAt, ticketDetail.firstResponseAt, ticketDetail.status).tone}>
                      {getSlaInfo(ticketDetail.createdAt, ticketDetail.firstResponseAt, ticketDetail.status).label}
                    </Badge>
                  </div>
                  <h1 className="mt-2 text-xl font-bold text-night sm:text-2xl">{ticketDetail.subject}</h1>
                </div>

                <div className="text-xs text-muted sm:text-right">
                  <div>Created: {formatDateTime(ticketDetail.createdAt)}</div>
                  {ticketDetail.firstResponseAt && (
                    <div className="mt-0.5 text-emerald-700">
                      First Response: {formatDateTime(ticketDetail.firstResponseAt)}
                    </div>
                  )}
                  {ticketDetail.resolvedAt && (
                    <div className="mt-0.5 text-stone-600">
                      Resolved: {formatDateTime(ticketDetail.resolvedAt)}
                    </div>
                  )}
                </div>
              </div>

              {/* Customer and Application Details Cards */}
              <div className="mt-4 grid grid-cols-1 gap-4 border-t border-rule/60 pt-4 sm:grid-cols-2">
                <div className="rounded-lg bg-stone-50 p-3 text-xs leading-relaxed text-stone-700">
                  <div className="font-semibold text-night">Customer Details</div>
                  <div className="mt-1 font-medium">{ticketDetail.customer.name}</div>
                  {ticketDetail.customer.email && (
                    <div className="text-muted">{ticketDetail.customer.email}</div>
                  )}
                  {ticketDetail.customer.mobile && (
                    <div className="text-muted">{ticketDetail.customer.mobile}</div>
                  )}
                </div>

                <div className="rounded-lg bg-stone-50 p-3 text-xs leading-relaxed text-stone-700">
                  <div className="font-semibold text-night">Related Application</div>
                  {ticketDetail.applicationCode ? (
                    <div className="mt-1">
                      {ticketDetail.applicationId ? (
                        <Link
                          href={`/applications/${ticketDetail.applicationId}`}
                          className="font-mono font-semibold text-ink underline"
                        >
                          {ticketDetail.applicationCode}
                        </Link>
                      ) : (
                        <span className="font-mono font-semibold">{ticketDetail.applicationCode}</span>
                      )}
                      {ticketDetail.applicationService && (
                        <div>{ticketDetail.applicationService}</div>
                      )}
                    </div>
                  ) : (
                    <div className="mt-1 text-muted">None / General customer inquiry</div>
                  )}
                </div>
              </div>
            </div>

            {/* Management Bar: Status, Priority, Assignee */}
            <div className="rounded-xl border border-rule bg-white p-5 shadow-xs">
              <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted">Ticket Management</h2>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                {/* Status Transition Control */}
                <div>
                  <label htmlFor="ticket-status-select" className="mb-1 block text-xs font-medium text-night">
                    Status (Current: {STATUS_CONFIG[ticketDetail.status]?.label})
                  </label>
                  <div className="flex gap-2">
                    <select
                      id="ticket-status-select"
                      disabled={updatingStatus || allowedTransitions.length === 0}
                      value={selectedNextStatus}
                      onChange={(e) => setSelectedNextStatus(e.target.value as TicketStatus)}
                      className="h-10 w-full rounded-md border border-rule bg-white px-2.5 text-xs text-night outline-none focus:border-ink"
                    >
                      <option value="">
                        {allowedTransitions.length === 0 ? 'No further transitions' : 'Select next status...'}
                      </option>
                      {allowedTransitions.map((st) => (
                        <option key={st} value={st}>
                          → {STATUS_CONFIG[st]?.label ?? st}
                        </option>
                      ))}
                    </select>
                    <Button
                      type="button"
                      size="sm"
                      disabled={updatingStatus || !selectedNextStatus}
                      onClick={() => selectedNextStatus && handleUpdateStatus(selectedNextStatus)}
                    >
                      {updatingStatus ? '...' : 'Apply'}
                    </Button>
                  </div>
                  {statusActionError && (
                    <p className="mt-1 text-xs text-danger">{statusActionError}</p>
                  )}
                </div>

                {/* Priority Control */}
                <div>
                  <label htmlFor="ticket-priority-select" className="mb-1 block text-xs font-medium text-night">
                    Priority
                  </label>
                  <select
                    id="ticket-priority-select"
                    disabled={updatingPriority}
                    value={ticketDetail.priority}
                    onChange={(e) => handleUpdatePriority(e.target.value as TicketPriority)}
                    className="h-10 w-full rounded-md border border-rule bg-white px-2.5 text-xs text-night outline-none focus:border-ink"
                  >
                    <option value="LOW">Low</option>
                    <option value="MEDIUM">Medium</option>
                    <option value="HIGH">High</option>
                    <option value="URGENT">Urgent</option>
                  </select>
                  {priorityActionError && (
                    <p className="mt-1 text-xs text-danger">{priorityActionError}</p>
                  )}
                </div>

                {/* Assignee Control */}
                <div>
                  <label htmlFor="ticket-assignee-select" className="mb-1 block text-xs font-medium text-night">
                    Assigned Staff
                  </label>
                  <select
                    id="ticket-assignee-select"
                    disabled={updatingAssignee}
                    value={ticketDetail.assignedToId || ''}
                    onChange={(e) => handleUpdateAssignee(e.target.value)}
                    className="h-10 w-full rounded-md border border-rule bg-white px-2.5 text-xs text-night outline-none focus:border-ink"
                  >
                    <option value="">Unassigned</option>
                    {staffList.map((staff) => (
                      <option key={staff.id} value={staff.id}>
                        {staff.name} ({staff.role})
                      </option>
                    ))}
                  </select>
                  {assigneeActionError && (
                    <p className="mt-1 text-xs text-danger">{assigneeActionError}</p>
                  )}
                </div>
              </div>
            </div>

            {/* Description Card */}
            <div className="rounded-xl border border-rule bg-white p-6 shadow-xs">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-muted">Customer Description</h2>
              <div className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-night">
                {ticketDetail.description}
              </div>
            </div>

            {/* Message Thread */}
            <div className="space-y-4">
              <h2 className="text-base font-semibold text-night">Conversation Thread</h2>

              {(!ticketDetail.messages || ticketDetail.messages.length === 0) ? (
                <div className="rounded-xl border border-dashed border-rule bg-stone-50/50 p-6 text-center text-sm text-muted">
                  No replies in this thread yet.
                </div>
              ) : (
                <div className="space-y-3">
                  {ticketDetail.messages.map((msg) => (
                    <div
                      key={msg.id}
                      className={`rounded-xl border p-4 text-sm leading-relaxed ${
                        msg.sender.isStaff
                          ? 'border-sky-200 bg-sky-50/40 text-stone-900'
                          : 'border-rule bg-white text-stone-900'
                      }`}
                    >
                      <div className="mb-2 flex flex-wrap items-center justify-between gap-2 border-b border-rule/50 pb-2 text-xs">
                        <div className="flex items-center gap-1.5 font-medium">
                          {msg.sender.isStaff ? (
                            <>
                              <Badge tone="info">Staff</Badge>
                              <span className="font-semibold text-sky-950">{msg.sender.name || 'Staff Member'}</span>
                            </>
                          ) : (
                            <>
                              <Badge tone="neutral">Customer</Badge>
                              <span className="font-semibold text-night">{msg.sender.name || ticketDetail.customer.name}</span>
                            </>
                          )}
                        </div>
                        <span className="text-muted">{formatDateTime(msg.createdAt)}</span>
                      </div>
                      <div className="whitespace-pre-wrap">{msg.body}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Staff Reply Box */}
            <div className="rounded-xl border border-rule bg-white p-6 shadow-xs">
              <h2 className="text-base font-semibold text-night">Send Staff Reply</h2>
              <p className="mt-0.5 text-xs text-muted">
                Replying will set status to <strong>Waiting for Customer</strong> and mark the First Response SLA timer if not yet responded.
              </p>

              {replyError && (
                <div className="mt-3">
                  <Notice tone="error">
                    <p className="text-sm font-medium">{replyError}</p>
                  </Notice>
                </div>
              )}

              <form onSubmit={handleSendReply} className="mt-4 space-y-4">
                <TextArea
                  id="staff-reply-body"
                  label="Message to Customer"
                  rows={4}
                  required
                  placeholder="Type your response to the customer..."
                  value={replyBody}
                  onChange={(e) => setReplyBody(e.target.value)}
                />

                <Field
                  id="staff-internal-note"
                  label="Internal Audit Note (Optional)"
                  placeholder="e.g. Verified GSTIN on MCA portal; awaiting customer's updated electricity bill"
                  value={internalNote}
                  onChange={(e) => setInternalNote(e.target.value)}
                />

                <div className="flex justify-end">
                  <Button type="submit" disabled={sendingReply || !replyBody.trim()}>
                    {sendingReply ? 'Sending...' : 'Send Reply to Customer'}
                  </Button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    );
  }

  // Queue List view
  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-night">Support Tickets Queue</h1>
          <p className="mt-1 text-sm text-muted">
            Track, respond to, and resolve customer support queries within SLA targets.
          </p>
        </div>
        <div className="text-sm font-medium text-muted">
          Total Tickets: <span className="font-semibold text-night">{total}</span>
        </div>
      </div>

      {loadError && (
        <Notice tone="error">
          <p className="font-medium">{loadError}</p>
        </Notice>
      )}

      {/* Filter and Search Bar */}
      <div className="flex flex-col gap-3 rounded-xl border border-rule bg-white p-4 shadow-xs sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          {/* Status filter */}
          <select
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value as TicketStatus | '');
              setPage(1);
            }}
            className="h-9 rounded-md border border-rule bg-white px-2.5 text-xs font-medium text-night outline-none focus:border-ink"
          >
            <option value="">All Statuses</option>
            <option value="OPEN">Open</option>
            <option value="IN_PROGRESS">In Progress</option>
            <option value="WAITING_FOR_CUSTOMER">Waiting for Customer</option>
            <option value="RESOLVED">Resolved</option>
            <option value="CLOSED">Closed</option>
          </select>

          {/* Priority filter */}
          <select
            value={priorityFilter}
            onChange={(e) => {
              setPriorityFilter(e.target.value as TicketPriority | '');
              setPage(1);
            }}
            className="h-9 rounded-md border border-rule bg-white px-2.5 text-xs font-medium text-night outline-none focus:border-ink"
          >
            <option value="">All Priorities</option>
            <option value="LOW">Low</option>
            <option value="MEDIUM">Medium</option>
            <option value="HIGH">High</option>
            <option value="URGENT">Urgent</option>
          </select>

          {/* Assignee filter */}
          <select
            value={assigneeFilter}
            onChange={(e) => {
              setAssigneeFilter(e.target.value);
              setPage(1);
            }}
            className="h-9 rounded-md border border-rule bg-white px-2.5 text-xs font-medium text-night outline-none focus:border-ink"
          >
            <option value="">All Assignees</option>
            <option value="unassigned">Unassigned</option>
            {staffList.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>

        {/* Search Input */}
        <div className="w-full sm:w-72">
          <input
            type="text"
            placeholder="Search code, subject, customer..."
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              setPage(1);
            }}
            className="h-9 w-full rounded-md border border-rule bg-white px-3 text-xs text-night placeholder:text-muted/70 outline-none focus:border-ink"
          />
        </div>
      </div>

      {/* Tickets Table / List */}
      {loading ? (
        <div className="rounded-xl border border-rule bg-white p-12 text-center text-sm text-muted">
          Loading support queue...
        </div>
      ) : !tickets || tickets.length === 0 ? (
        <EmptyState
          title="No support tickets found"
          description="No tickets match your active filter criteria."
        />
      ) : (
        <div className="space-y-2">
          {tickets.map((ticket) => {
            const sla = getSlaInfo(ticket.createdAt, ticket.firstResponseAt, ticket.status);
            return (
              <div
                key={ticket.id}
                onClick={() => openTicketDetail(ticket.id)}
                className="group cursor-pointer rounded-xl border border-rule bg-white p-4 shadow-xs transition-all hover:border-ink/50 hover:shadow-sm"
              >
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs font-semibold text-muted">{ticket.code}</span>
                    <Badge tone={STATUS_CONFIG[ticket.status]?.tone ?? 'neutral'}>
                      {STATUS_CONFIG[ticket.status]?.label ?? ticket.status}
                    </Badge>
                    <Badge tone={PRIORITY_CONFIG[ticket.priority]?.tone ?? 'neutral'}>
                      {PRIORITY_CONFIG[ticket.priority]?.label ?? ticket.priority}
                    </Badge>
                    <Badge tone={sla.tone}>{sla.label}</Badge>
                  </div>

                  <div className="text-xs text-muted">
                    Raised {formatDate(ticket.createdAt)}
                  </div>
                </div>

                <div className="mt-2.5 flex flex-col justify-between gap-1 sm:flex-row sm:items-center">
                  <h3 className="text-base font-semibold text-night group-hover:text-ink">
                    {ticket.subject}
                  </h3>
                  <div className="text-xs text-muted">
                    Assignee:{' '}
                    <span className="font-medium text-night">
                      {ticket.assignedTo?.name || 'Unassigned'}
                    </span>
                  </div>
                </div>

                <div className="mt-2 flex flex-wrap items-center justify-between gap-2 border-t border-rule/50 pt-2 text-xs text-muted">
                  <div>
                    Customer: <span className="font-medium text-stone-800">{ticket.customer.name}</span>
                    {ticket.customer.email && <span> ({ticket.customer.email})</span>}
                  </div>
                  {ticket.applicationCode && (
                    <div className="font-mono text-stone-700">
                      App: {ticket.applicationCode}
                    </div>
                  )}
                </div>
              </div>
            );
          })}

          {/* Pagination Controls */}
          {total > limit && (
            <div className="flex items-center justify-between pt-4 text-xs text-muted">
              <div>
                Showing {(page - 1) * limit + 1}–{Math.min(page * limit, total)} of {total} tickets
              </div>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  Previous
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={page * limit >= total}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
