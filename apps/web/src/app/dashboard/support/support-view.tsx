'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import {
  formatDate,
  formatDateTime,
  type CustomerApplicationRow,
  type TicketDetail,
  type TicketPriority,
  type TicketStatus,
  type TicketSummary,
} from '@biznexa/types';
import { Badge, Button, Dialog, EmptyState, Field, Notice, Select, TextArea, type Tone } from '@biznexa/ui';
import { useApi } from '@biznexa/api-client/react';

const STATUS_CONFIG: Record<TicketStatus, { label: string; tone: Tone }> = {
  OPEN: { label: 'Open', tone: 'info' },
  IN_PROGRESS: { label: 'In Progress', tone: 'warning' },
  WAITING_FOR_CUSTOMER: { label: 'Action Required', tone: 'danger' },
  RESOLVED: { label: 'Resolved', tone: 'success' },
  CLOSED: { label: 'Closed', tone: 'neutral' },
};

const PRIORITY_CONFIG: Record<TicketPriority, { label: string; tone: Tone }> = {
  LOW: { label: 'Low', tone: 'neutral' },
  MEDIUM: { label: 'Medium', tone: 'info' },
  HIGH: { label: 'High', tone: 'warning' },
  URGENT: { label: 'Urgent', tone: 'danger' },
};

interface CreateFormState {
  subject: string;
  description: string;
  priority: TicketPriority;
  applicationId: string;
}

const INITIAL_FORM: CreateFormState = {
  subject: '',
  description: '',
  priority: 'MEDIUM',
  applicationId: '',
};

export function CustomerSupportView() {
  const api = useApi();
  const [tickets, setTickets] = useState<TicketSummary[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Selected ticket detail state
  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(null);
  const [ticketDetail, setTicketDetail] = useState<TicketDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  // Applications for dropdown
  const [applications, setApplications] = useState<CustomerApplicationRow[]>([]);

  // Filter tab: 'ALL' | 'ACTIVE' | 'RESOLVED' | 'CLOSED'
  const [statusTab, setStatusTab] = useState<'ALL' | 'ACTIVE' | 'RESOLVED' | 'CLOSED'>('ALL');
  const [searchQuery, setSearchQuery] = useState('');

  // Create ticket dialog
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [createForm, setCreateForm] = useState<CreateFormState>(INITIAL_FORM);
  const [createErrors, setCreateErrors] = useState<{ subject?: string; description?: string }>({});
  const [creating, setCreating] = useState(false);
  const [createApiError, setCreateApiError] = useState<string | null>(null);

  // Reply state
  const [replyText, setReplyText] = useState('');
  const [sendingReply, setSendingReply] = useState(false);
  const [replyError, setReplyError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .call((c) =>
        c.GET('/api/tickets', {
          params: { query: { page: 1, limit: 100 } },
        }),
      )
      .then(
        (res) => {
          if (!cancelled) {
            setTickets(res.items);
            setError(null);
            setLoading(false);
          }
        },
        (err: unknown) => {
          if (!cancelled) {
            setError(err instanceof Error ? err.message : 'Failed to load tickets');
            setLoading(false);
          }
        },
      );

    api
      .call((c) =>
        c.GET('/api/applications', {
          params: { query: { limit: 100 } },
        }),
      )
      .then(
        (res) => {
          if (!cancelled) {
            setApplications(res.items);
          }
        },
        () => {},
      );

    return () => {
      cancelled = true;
    };
  }, [api]);

  const refreshTickets = async () => {
    try {
      const res = await api.call((c) =>
        c.GET('/api/tickets', {
          params: { query: { page: 1, limit: 100 } },
        }),
      );
      setTickets(res.items);
    } catch {
      // non-critical
    }
  };

  const openTicketDetail = async (id: string) => {
    setSelectedTicketId(id);
    setDetailLoading(true);
    setDetailError(null);
    try {
      const detail = await api.call((c) =>
        c.GET('/api/tickets/{id}', {
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

  const filteredTickets = useMemo(() => {
    if (!tickets) return [];
    return tickets.filter((t) => {
      if (statusTab === 'ACTIVE') {
        if (t.status === 'RESOLVED' || t.status === 'CLOSED') return false;
      } else if (statusTab === 'RESOLVED') {
        if (t.status !== 'RESOLVED') return false;
      } else if (statusTab === 'CLOSED') {
        if (t.status !== 'CLOSED') return false;
      }

      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchesCode = t.code.toLowerCase().includes(q);
        const matchesSubject = t.subject.toLowerCase().includes(q);
        const matchesApp = t.applicationCode?.toLowerCase().includes(q);
        return matchesCode || matchesSubject || !!matchesApp;
      }
      return true;
    });
  }, [tickets, statusTab, searchQuery]);

  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const errors: { subject?: string; description?: string } = {};
    if (!createForm.subject.trim() || createForm.subject.trim().length < 3) {
      errors.subject = 'Subject must be at least 3 characters';
    }
    if (!createForm.description.trim() || createForm.description.trim().length < 5) {
      errors.description = 'Description must be at least 5 characters';
    }

    if (Object.keys(errors).length > 0) {
      setCreateErrors(errors);
      return;
    }

    setCreateErrors({});
    setCreating(true);
    setCreateApiError(null);

    try {
      const created = await api.call((c) =>
        c.POST('/api/tickets', {
          body: {
            subject: createForm.subject.trim(),
            description: createForm.description.trim(),
            priority: createForm.priority,
            applicationId: createForm.applicationId || undefined,
          },
        }),
      );

      setCreateDialogOpen(false);
      setCreateForm(INITIAL_FORM);
      await refreshTickets();
      await openTicketDetail(created.id);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unable to create ticket';
      setCreateApiError(msg);
    } finally {
      setCreating(false);
    }
  };

  const handleSendReply = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTicketId || !replyText.trim()) return;

    setSendingReply(true);
    setReplyError(null);

    try {
      await api.call((c) =>
        c.POST('/api/tickets/{id}/messages', {
          params: { path: { id: selectedTicketId } },
          body: { body: replyText.trim() },
        }),
      );

      setReplyText('');
      await openTicketDetail(selectedTicketId);
      await refreshTickets();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to send reply';
      setReplyError(msg);
    } finally {
      setSendingReply(false);
    }
  };

  // If viewing ticket detail
  if (selectedTicketId) {
    return (
      <div className="mx-auto max-w-4xl space-y-6">
        <div>
          <button
            type="button"
            onClick={closeTicketDetail}
            className="inline-flex items-center gap-1.5 text-sm font-medium text-ink hover:underline"
          >
            ← Back to all tickets
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
            {/* Header Card */}
            <div className="rounded-xl border border-rule bg-white p-6 shadow-xs">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-sm font-semibold text-muted">{ticketDetail.code}</span>
                  <Badge tone={STATUS_CONFIG[ticketDetail.status]?.tone ?? 'neutral'}>
                    {STATUS_CONFIG[ticketDetail.status]?.label ?? ticketDetail.status}
                  </Badge>
                  <Badge tone={PRIORITY_CONFIG[ticketDetail.priority]?.tone ?? 'neutral'}>
                    {PRIORITY_CONFIG[ticketDetail.priority]?.label ?? ticketDetail.priority}
                  </Badge>
                </div>
                <div className="text-xs text-muted">
                  Raised on {formatDate(ticketDetail.createdAt)}
                </div>
              </div>

              <h1 className="mt-3 text-xl font-bold text-night sm:text-2xl">{ticketDetail.subject}</h1>

              {ticketDetail.applicationCode && (
                <div className="mt-3 inline-flex items-center gap-1.5 rounded-md bg-stone-50 px-2.5 py-1 text-xs text-stone-700">
                  <span className="font-medium">Related Application:</span>
                  {ticketDetail.applicationId ? (
                    <Link
                      href={`/dashboard/applications/${ticketDetail.applicationId}/timeline`}
                      className="font-mono text-ink underline hover:text-ink/80"
                    >
                      {ticketDetail.applicationCode}
                    </Link>
                  ) : (
                    <span className="font-mono">{ticketDetail.applicationCode}</span>
                  )}
                  {ticketDetail.applicationService && <span>— {ticketDetail.applicationService}</span>}
                </div>
              )}
            </div>

            {/* Original Problem Description Card */}
            <div className="rounded-xl border border-rule bg-white p-6 shadow-xs">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-muted">Initial Description</h2>
              <div className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-night">
                {ticketDetail.description}
              </div>
            </div>

            {/* Conversation Thread */}
            <div className="space-y-4">
              <h2 className="text-base font-semibold text-night">Conversation Thread</h2>

              {(!ticketDetail.messages || ticketDetail.messages.length === 0) ? (
                <div className="rounded-xl border border-dashed border-rule bg-stone-50/50 p-6 text-center text-sm text-muted">
                  No replies yet. Our support team will respond shortly.
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
                              <Badge tone="info">BizNexa Support</Badge>
                              <span className="text-sky-950 font-semibold">{msg.sender.name || 'Support Agent'}</span>
                            </>
                          ) : (
                            <span className="font-semibold text-night">You</span>
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

            {/* Reply Section */}
            <div className="rounded-xl border border-rule bg-white p-6 shadow-xs">
              {ticketDetail.status === 'CLOSED' ? (
                <Notice tone="info">
                  <p className="text-sm">
                    This ticket is <strong>Closed</strong>. If you need assistance with a new or related issue, please raise a new ticket.
                  </p>
                </Notice>
              ) : (
                <form onSubmit={handleSendReply} className="space-y-4">
                  {ticketDetail.status === 'RESOLVED' && (
                    <Notice tone="info">
                      <p className="text-sm">
                        This ticket is currently marked as <strong>Resolved</strong>. Sending a reply will reopen it to <strong>Open</strong>.
                      </p>
                    </Notice>
                  )}

                  {replyError && (
                    <Notice tone="error">
                      <p className="text-sm font-medium">{replyError}</p>
                    </Notice>
                  )}

                  <TextArea
                    id="ticket-reply-input"
                    label="Reply to Support"
                    rows={4}
                    placeholder="Type your message or clarification here..."
                    value={replyText}
                    onChange={(e) => setReplyText(e.target.value)}
                  />

                  <div className="flex justify-end">
                    <Button type="submit" disabled={sendingReply || !replyText.trim()}>
                      {sendingReply ? 'Sending...' : 'Send Reply'}
                    </Button>
                  </div>
                </form>
              )}
            </div>
          </div>
        )}
      </div>
    );
  }

  // List view
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      {/* Top Banner & Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-night sm:text-3xl">Support Tickets</h1>
          <p className="mt-1 text-sm text-muted">
            Have questions about your applications or compliance? Our expert team is here to assist you.
          </p>
        </div>
        <Button type="button" onClick={() => setCreateDialogOpen(true)}>
          <span className="mr-1.5">+</span> Raise New Ticket
        </Button>
      </div>

      {error && (
        <Notice tone="error">
          <p className="font-medium">{error}</p>
        </Notice>
      )}

      {/* Filter and Search Bar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-1 rounded-lg border border-rule bg-stone-50 p-1 text-xs font-medium">
          <button
            type="button"
            onClick={() => setStatusTab('ALL')}
            className={`rounded-md px-3 py-1.5 transition-colors ${
              statusTab === 'ALL' ? 'bg-white font-semibold text-night shadow-xs' : 'text-muted hover:text-night'
            }`}
          >
            All
          </button>
          <button
            type="button"
            onClick={() => setStatusTab('ACTIVE')}
            className={`rounded-md px-3 py-1.5 transition-colors ${
              statusTab === 'ACTIVE' ? 'bg-white font-semibold text-night shadow-xs' : 'text-muted hover:text-night'
            }`}
          >
            Active
          </button>
          <button
            type="button"
            onClick={() => setStatusTab('RESOLVED')}
            className={`rounded-md px-3 py-1.5 transition-colors ${
              statusTab === 'RESOLVED' ? 'bg-white font-semibold text-night shadow-xs' : 'text-muted hover:text-night'
            }`}
          >
            Resolved
          </button>
          <button
            type="button"
            onClick={() => setStatusTab('CLOSED')}
            className={`rounded-md px-3 py-1.5 transition-colors ${
              statusTab === 'CLOSED' ? 'bg-white font-semibold text-night shadow-xs' : 'text-muted hover:text-night'
            }`}
          >
            Closed
          </button>
        </div>

        <div className="relative w-full sm:w-64">
          <input
            type="text"
            placeholder="Search tickets by code or subject..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="h-10 w-full rounded-md border border-rule bg-white px-3 text-sm text-night placeholder:text-muted/70 outline-none focus:border-ink"
          />
        </div>
      </div>

      {/* Tickets List */}
      {loading ? (
        <div className="rounded-xl border border-rule bg-white p-12 text-center text-sm text-muted">
          Loading your tickets...
        </div>
      ) : filteredTickets.length === 0 ? (
        <EmptyState
          title="No support tickets found"
          description={
            searchQuery.trim() || statusTab !== 'ALL'
              ? 'No tickets match your active filter.'
              : 'You have not raised any support tickets yet. Need help? Raise a ticket and our team will get back to you promptly.'
          }
          action={
            <Button type="button" onClick={() => setCreateDialogOpen(true)}>
              Raise Support Ticket
            </Button>
          }
        />
      ) : (
        <div className="space-y-3">
          {filteredTickets.map((ticket) => (
            <div
              key={ticket.id}
              onClick={() => openTicketDetail(ticket.id)}
              className="group cursor-pointer rounded-xl border border-rule bg-white p-4 shadow-xs transition-all hover:border-ink/50 hover:shadow-sm sm:p-5"
            >
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs font-semibold text-muted">{ticket.code}</span>
                  <Badge tone={STATUS_CONFIG[ticket.status]?.tone ?? 'neutral'}>
                    {STATUS_CONFIG[ticket.status]?.label ?? ticket.status}
                  </Badge>
                  <Badge tone={PRIORITY_CONFIG[ticket.priority]?.tone ?? 'neutral'}>
                    {PRIORITY_CONFIG[ticket.priority]?.label ?? ticket.priority}
                  </Badge>
                </div>
                <div className="text-xs text-muted">
                  Created {formatDate(ticket.createdAt)}
                </div>
              </div>

              <div className="mt-2.5">
                <h3 className="text-base font-semibold text-night group-hover:text-ink">
                  {ticket.subject}
                </h3>
              </div>

              {ticket.applicationCode && (
                <div className="mt-2 text-xs text-muted">
                  Related application:{' '}
                  <span className="font-mono font-medium text-stone-700">
                    {ticket.applicationCode}
                  </span>{' '}
                  {ticket.applicationService && <span>({ticket.applicationService})</span>}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Create Ticket Modal */}
      <Dialog
        open={createDialogOpen}
        onClose={() => !creating && setCreateDialogOpen(false)}
        title="Raise Support Ticket"
        description="Submit your query or request and our compliance team will assist you."
      >
        <form onSubmit={handleCreateSubmit} className="space-y-4">
          {createApiError && (
            <Notice tone="error">
              <p className="text-sm font-medium">{createApiError}</p>
            </Notice>
          )}

          <Field
            id="ticket-subject"
            label="Subject"
            required
            placeholder="e.g., Query regarding GST registration documents"
            value={createForm.subject}
            onChange={(e) => setCreateForm({ ...createForm, subject: e.target.value })}
            error={createErrors.subject}
          />

          <Select
            id="ticket-application"
            label="Related Application (Optional)"
            value={createForm.applicationId}
            onChange={(e) => setCreateForm({ ...createForm, applicationId: e.target.value })}
            hint="Link this ticket to one of your active or completed applications"
          >
            <option value="">None / General Inquiry</option>
            {applications.map((app) => (
              <option key={app.id} value={app.id}>
                {app.code} — {app.serviceName} ({app.statusLabel})
              </option>
            ))}
          </Select>

          <Select
            id="ticket-priority"
            label="Priority"
            value={createForm.priority}
            onChange={(e) => setCreateForm({ ...createForm, priority: e.target.value as TicketPriority })}
          >
            <option value="LOW">Low — General inquiry</option>
            <option value="MEDIUM">Medium — Standard assistance</option>
            <option value="HIGH">High — Time-sensitive deadline</option>
            <option value="URGENT">Urgent — Critical blocker</option>
          </Select>

          <TextArea
            id="ticket-description"
            label="Description"
            required
            rows={5}
            placeholder="Provide details about your query or the assistance needed..."
            value={createForm.description}
            onChange={(e) => setCreateForm({ ...createForm, description: e.target.value })}
            error={createErrors.description}
          />

          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              disabled={creating}
              onClick={() => setCreateDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={creating}>
              {creating ? 'Submitting...' : 'Submit Ticket'}
            </Button>
          </div>
        </form>
      </Dialog>
    </div>
  );
}
