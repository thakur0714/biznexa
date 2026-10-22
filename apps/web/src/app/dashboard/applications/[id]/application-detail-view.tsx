'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useEffect, useState, type SubmitEvent } from 'react';
import {
  conditionMet,
  formatDate,
  formatINR,
  isEmptyValue,
  type ApplicationDetail,
  type CustomerApplicationTimeline,
  type CustomerStageState,
  type CustomerTimelineStage,
  type DeliverableList,
  type DocumentChecklist,
  type FormAddress,
  type FormField,
  type FormLeafField,
  type InvoiceSummary,
  type MarkMessagesReadResponse,
  type Message,
  type MessageThreadPage,
  type MessageUnreadCount,
  type PaymentStatusView,
} from '@biznexa/types';
import { ClientApiError } from '@biznexa/api-client/browser';
import { useApi } from '@biznexa/api-client/react';
import { Badge, Button, EmptyState, LinkButton, Notice, type Tone } from '@biznexa/ui';
import { DocumentRow } from '@/components/document-row';
import { Icon } from '@/components/icons';
import { applicationStatusTone } from '../../services/services-view';

type DetailTab = 'documents' | 'form' | 'payments' | 'deliverables' | 'messages';

const DETAIL_TABS: readonly { key: DetailTab; label: string }[] = [
  { key: 'documents', label: 'Documents' },
  { key: 'form', label: 'Form' },
  { key: 'payments', label: 'Payments' },
  { key: 'deliverables', label: 'Deliverables' },
  { key: 'messages', label: 'Messages' },
];

const MESSAGES_PAGE_LIMIT = 50;

function isDetailTab(value: string | null): value is DetailTab {
  return (
    value === 'documents' ||
    value === 'form' ||
    value === 'payments' ||
    value === 'deliverables' ||
    value === 'messages'
  );
}

function stageStateBadge(state: CustomerStageState): { label: string; tone: Tone } {
  switch (state) {
    case 'done':
      return { label: 'Completed', tone: 'success' };
    case 'current':
      return { label: 'In progress', tone: 'info' };
    case 'upcoming':
      return { label: 'Upcoming', tone: 'neutral' };
  }
}

function StageStepIcon({ stage, index }: Readonly<{ stage: CustomerTimelineStage; index: number }>) {
  if (stage.state === 'done') {
    return (
      <span
        aria-hidden="true"
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-white shadow-xs"
      >
        <Icon name="check" size={16} />
      </span>
    );
  }
  if (stage.state === 'current') {
    return (
      <span
        aria-hidden="true"
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 border-ink bg-surface text-xs font-bold text-ink ring-4 ring-ink/10"
      >
        {index + 1}
      </span>
    );
  }
  return (
    <span
      aria-hidden="true"
      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-rule bg-paper text-xs font-semibold text-muted"
    >
      {index + 1}
    </span>
  );
}

function formatAddressValue(val: unknown): string {
  if (!val || typeof val !== 'object') return '—';
  const addr = val as Partial<FormAddress>;
  const parts = [addr.line1, addr.line2, addr.city, addr.state, addr.pincode]
    .map((p) => (typeof p === 'string' ? p.trim() : ''))
    .filter(Boolean);
  return parts.length > 0 ? parts.join(', ') : '—';
}

function ReadOnlyLeafAnswer({
  field,
  value,
  onOpenFile,
}: Readonly<{
  field: FormLeafField;
  value: unknown;
  onOpenFile: (fileId: string) => void;
}>) {
  if (isEmptyValue(value)) {
    return <span className="text-muted">—</span>;
  }

  if (field.type === 'address') {
    return <span className="text-night">{formatAddressValue(value)}</span>;
  }

  if (field.type === 'multi-select' && Array.isArray(value)) {
    return <span className="text-night">{value.map(String).join(', ')}</span>;
  }

  if (field.type === 'file') {
    let ids: string[] = [];
    if (Array.isArray(value)) ids = value.filter((x): x is string => typeof x === 'string');
    else if (typeof value === 'string') ids = [value];
    if (ids.length === 0) return <span className="text-muted">—</span>;
    return (
      <div className="flex flex-wrap gap-2">
        {ids.map((id, i) => (
          <Button key={id} type="button" variant="outline" size="sm" onClick={() => onOpenFile(id)}>
            View file {ids.length > 1 ? i + 1 : ''}
          </Button>
        ))}
      </div>
    );
  }

  return <span className="whitespace-pre-wrap text-night">{String(value)}</span>;
}


/** The open tab: starts from `?tab=` and follows it when the link changes; the user can switch freely. */
function useTabFromQuery(queryTab: string | null) {
  const [activeTab, setActiveTab] = useState<DetailTab>(() => (isDetailTab(queryTab) ? queryTab : 'documents'));
  const [lastQueryTab, setLastQueryTab] = useState<string | null>(queryTab);
  if (queryTab !== lastQueryTab) {
    setLastQueryTab(queryTab);
    if (isDetailTab(queryTab)) setActiveTab(queryTab);
  }
  return [activeTab, setActiveTab] as const;
}

/** "1 required document pending" / "3 required documents pending". */
const pendingLabel = (n: number) => (n === 1 ? '1 required document pending' : `${n} required documents pending`);

/** The Documents tab: team requests first, then the service's checklist. */
function DocumentsTab({ checklist, applicationId, onChange }: Readonly<{ checklist: DocumentChecklist | null; applicationId: string; onChange: (next: DocumentChecklist) => void }>) {
  if (!checklist) {
    return (
      <div className="rounded-lg border border-rule bg-white p-6 text-sm text-muted">
        No document checklist available for this application.
      </div>
    );
  }
  const pendingMandatory = checklist.pendingMandatory;
  return (
    <>
      {!checklist.canUpload && (
        <Notice tone="info">
          This application is past the document upload stage, so documents are read-only.
        </Notice>
      )}

      {checklist.additional.length > 0 && (
        <div className="space-y-3" aria-labelledby="requested-by-team-heading">
          <div>
            <h2 id="requested-by-team-heading" className="text-base font-bold text-night">
              Requested by our team
            </h2>
            <p className="text-xs text-muted">
              Our team requested these additional documents to continue processing your application.
            </p>
          </div>
          <ul className="space-y-3">
            {checklist.additional.map((item) => (
              <DocumentRow
                key={item.request.id}
                target={{ kind: 'additional', item }}
                applicationId={applicationId}
                canUpload={checklist.canUpload}
                onChange={onChange}
              />
            ))}
          </ul>
        </div>
      )}

      {checklist.items.length === 0 ? (
        checklist.additional.length === 0 && (
          <EmptyState
            className="rounded-lg border border-rule bg-white p-8"
            title="No documents required"
            description="This service does not require any document uploads."
          />
        )
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-base font-bold text-night">Document Checklist</h2>
            {pendingMandatory > 0 && (
              <span className="text-xs font-semibold text-amber-700">
                {pendingLabel(pendingMandatory)}
              </span>
            )}
          </div>
          <ul className="space-y-3">
            {checklist.items.map((item) => (
              <DocumentRow
                key={item.requirement.id}
                target={{ kind: 'requirement', item }}
                applicationId={applicationId}
                canUpload={checklist.canUpload}
                onChange={onChange}
              />
            ))}
          </ul>
        </div>
      )}
    </>
  );
}

export function ApplicationDetailView({ applicationId }: Readonly<{ applicationId: string }>) {
  const api = useApi();
  const searchParams = useSearchParams();
  const queryTab = searchParams.get('tab');

  const [activeTab, setActiveTab] = useTabFromQuery(queryTab);

  const [loadedForId, setLoadedForId] = useState<string>(applicationId);
  const [timeline, setTimeline] = useState<CustomerApplicationTimeline | null>(null);
  const [formDetail, setFormDetail] = useState<ApplicationDetail | null>(null);
  const [checklist, setChecklist] = useState<DocumentChecklist | null>(null);
  const [paymentStatus, setPaymentStatus] = useState<PaymentStatusView | null>(null);
  const [invoices, setInvoices] = useState<InvoiceSummary[]>([]);
  const [deliverables, setDeliverables] = useState<DeliverableList>([]);

  // Messages state (M5.7)
  const [messages, setMessages] = useState<Message[]>([]);
  const [messagesTotal, setMessagesTotal] = useState(0);
  const [messagesPage, setMessagesPage] = useState(1);
  const [messagesLimit, setMessagesLimit] = useState(MESSAGES_PAGE_LIMIT);
  const [unreadMessages, setUnreadMessages] = useState(0);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [draftMessage, setDraftMessage] = useState('');
  const [sendingMessage, setSendingMessage] = useState(false);
  const [messageError, setMessageError] = useState<string | null>(null);

  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  const openInlineFile = (fileId: string) => { void openFileLink(fileId, 'inline'); };

  if (loadedForId !== applicationId) {
    setLoadedForId(applicationId);
    setTimeline(null);
    setFormDetail(null);
    setChecklist(null);
    setPaymentStatus(null);
    setInvoices([]);
    setDeliverables([]);
    setMessages([]);
    setMessagesTotal(0);
    setMessagesPage(1);
    setUnreadMessages(0);
    setDraftMessage('');
    setMessageError(null);
    setError(null);
    setActionError(null);
  }

  useEffect(() => {
    let cancelled = false;
    const path = { params: { path: { id: applicationId } } };

    Promise.all([
      api.call<CustomerApplicationTimeline>((c) => c.GET('/api/applications/{id}/timeline', path)),
      api.call<ApplicationDetail>((c) => c.GET('/api/applications/{id}', path)).catch(() => null),
      api.call<DocumentChecklist>((c) => c.GET('/api/applications/{id}/documents', path)).catch(() => null),
      api.call<PaymentStatusView>((c) => c.GET('/api/applications/{id}/payment', path)).catch(() => null),
      api
        .call<InvoiceSummary[]>((c) => c.GET('/api/invoices', { params: { query: { applicationId } } }))
        .catch(() => []),
      api.call<DeliverableList>((c) => c.GET('/api/applications/{id}/deliverables', path)).catch(() => []),
      api
        .call<MessageThreadPage>((c) =>
          c.GET('/api/applications/{id}/messages', {
            params: { path: { id: applicationId }, query: { page: 1, limit: MESSAGES_PAGE_LIMIT } },
          }),
        )
        .catch(() => ({ items: [], total: 0, page: 1, limit: MESSAGES_PAGE_LIMIT })),
      api
        .call<MessageUnreadCount>((c) => c.GET('/api/applications/{id}/messages/unread-count', path))
        .catch(() => ({ count: 0 })),
    ])
      .then(([tl, fd, docs, pay, invs, delivs, msgPage, unread]) => {
        if (!cancelled) {
          setTimeline(tl);
          setFormDetail(fd);
          setChecklist(docs);
          setPaymentStatus(pay);
          setInvoices(invs);
          setDeliverables(delivs);
          setMessages(msgPage.items);
          setMessagesTotal(msgPage.total);
          setMessagesPage(msgPage.page);
          setMessagesLimit(msgPage.limit);
          setUnreadMessages(unread.count);
          setError(null);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof ClientApiError ? err.message : 'Failed to load application details.');
        }
      });

    return () => {
      cancelled = true;
    };
  }, [api, applicationId]);

  // Mark messages read when the Messages tab is opened
  useEffect(() => {
    if (activeTab !== 'messages' || !timeline) return;
    let cancelled = false;

    api
      .call<MarkMessagesReadResponse>((c) =>
        c.POST('/api/applications/{id}/messages/read', {
          params: { path: { id: applicationId } },
        }),
      )
      .then(() => {
        if (!cancelled) {
          setUnreadMessages(0);
        }
      })
      .catch(() => {
        // Non-blocking if mark-read fails
      });

    return () => {
      cancelled = true;
    };
  }, [api, applicationId, activeTab, timeline]);

  async function handleLoadOlderMessages() {
    if (loadingOlder) return;
    const nextPage = messagesPage + 1;
    setLoadingOlder(true);
    setMessageError(null);
    try {
      const res = await api.call<MessageThreadPage>((c) =>
        c.GET('/api/applications/{id}/messages', {
          params: {
            path: { id: applicationId },
            query: { page: nextPage, limit: messagesLimit },
          },
        }),
      );
      setMessages((prev) => {
        const existingIds = new Set(prev.map((m) => m.id));
        const older = res.items.filter((m) => !existingIds.has(m.id));
        return [...older, ...prev];
      });
      setMessagesTotal(res.total);
      setMessagesPage(nextPage);
    } catch (err: unknown) {
      setMessageError(err instanceof ClientApiError ? err.message : 'Could not load older messages.');
    } finally {
      setLoadingOlder(false);
    }
  }

  async function handleSendMessage(e: SubmitEvent<HTMLFormElement>) {
    e.preventDefault();
    const trimmed = draftMessage.trim();
    if (!trimmed || sendingMessage) return;

    setSendingMessage(true);
    setMessageError(null);
    try {
      const created = await api.call<Message>((c) =>
        c.POST('/api/applications/{id}/messages', {
          params: { path: { id: applicationId } },
          body: { body: trimmed },
        }),
      );
      setMessages((prev) => (prev.some((m) => m.id === created.id) ? prev : [...prev, created]));
      setMessagesTotal((prev) => prev + 1);
      setDraftMessage('');
    } catch (err: unknown) {
      setMessageError(err instanceof ClientApiError ? err.message : 'Failed to send message.');
    } finally {
      setSendingMessage(false);
    }
  }

  async function openFileLink(fileId: string, disposition: 'inline' | 'attachment') {
    setActionError(null);
    setDownloadingId(fileId);
    const tab = window.open('', '_blank');
    try {
      const link = await api.call<{ url: string }>((c) =>
        c.POST('/api/files/{id}/link', {
          params: { path: { id: fileId }, query: { disposition } },
        }),
      );
      if (tab) {
        tab.opener = null;
        tab.location.href = link.url;
      } else {
        window.location.assign(link.url);
      }
    } catch (err: unknown) {
      tab?.close();
      setActionError(err instanceof ClientApiError ? err.message : 'Could not open file.');
    } finally {
      setDownloadingId(null);
    }
  }

  async function downloadInvoice(invoiceId: string) {
    setActionError(null);
    setDownloadingId(invoiceId);
    const tab = window.open('', '_blank');
    try {
      const link = await api.call<{ url: string }>((c) =>
        c.POST('/api/invoices/{id}/link', {
          params: { path: { id: invoiceId } },
        }),
      );
      if (tab) {
        tab.opener = null;
        tab.location.href = link.url;
      } else {
        window.location.assign(link.url);
      }
    } catch (err: unknown) {
      tab?.close();
      setActionError(err instanceof ClientApiError ? err.message : 'Could not download invoice.');
    } finally {
      setDownloadingId(null);
    }
  }

  const loading = timeline === null && !error;

  if (loading) {
    return (
      <output className="block rounded-lg border border-rule bg-white p-10 text-center text-sm text-muted">
        Loading application details…
      </output>
    );
  }

  if (error || !timeline) {
    return (
      <div className="space-y-4">
        <Notice tone="error">{error ?? 'Application not found.'}</Notice>
        <LinkButton href="/dashboard/services" variant="outline" size="sm">
          Back to My Services
        </LinkButton>
      </div>
    );
  }

  const pendingMandatory = checklist?.pendingMandatory ?? 0;
  const hasOlderMessages = messages.length < messagesTotal && messagesPage * messagesLimit < messagesTotal;

  return (
    <div className="min-w-0 space-y-6">
      {/* Breadcrumb */}
      <div>
        <Link
          href="/dashboard/services"
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-muted hover:text-ink"
        >
          <span>←</span>
          <span>Back to My Services</span>
        </Link>
      </div>

      {/* Header */}
      <header className="rounded-lg border border-rule bg-white p-5 shadow-xs sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="num font-mono text-xs font-bold text-muted" data-testid="application-code">
                {timeline.code}
              </span>
              <Badge tone={applicationStatusTone(timeline.status)}>{timeline.statusLabel}</Badge>
            </div>
            <h1 className="text-xl font-bold tracking-[-0.02em] text-night sm:text-2xl">
              {timeline.serviceName}
            </h1>
            <p className="text-sm text-muted">
              <span className="font-semibold text-ink">{timeline.packageName}</span> package · Started{' '}
              {formatDate(timeline.createdAt)}
            </p>
          </div>
          {timeline.assignedExpert && (
            <div
              className="shrink-0 rounded-md border border-rule bg-paper px-3.5 py-2 text-xs"
              data-testid="assigned-expert"
            >
              <p className="font-semibold uppercase tracking-[0.06em] text-muted">Assigned expert</p>
              <p className="mt-0.5 text-sm font-semibold text-night">{timeline.assignedExpert.name}</p>
            </div>
          )}
        </div>
      </header>

      {/* Service Stages Vertical Stepper */}
      <section aria-labelledby="timeline-heading" className="rounded-lg border border-rule bg-white p-5 sm:p-6">
        <div className="mb-5">
          <h2 id="timeline-heading" className="text-lg font-bold text-night">
            Application Timeline
          </h2>
          <p className="mt-0.5 text-xs text-muted">
            Live progress across every stage of your {timeline.serviceName} application.
          </p>
        </div>

        {timeline.stages.length === 0 ? (
          <EmptyState
            title="No stages configured"
            description="Stage progress will appear here as our team works on your application."
          />
        ) : (
          <ol className="space-y-0" aria-label="Service stages">
            {timeline.stages.map((stage, idx) => {
              const isLast = idx === timeline.stages.length - 1;
              const badge = stageStateBadge(stage.state);
              const stageNotes = timeline.history.filter((h) => h.stageId === stage.id && h.note);

              return (
                <li
                  key={stage.id}
                  data-stage-state={stage.state}
                  className="relative flex gap-4 pb-6 last:pb-0"
                >
                  {!isLast && (
                    <span
                      aria-hidden="true"
                      className={`absolute top-8 left-4 -ml-px h-[calc(100%-2rem)] w-0.5 ${
                        stage.state === 'done' ? 'bg-emerald-500' : 'bg-rule'
                      }`}
                    />
                  )}
                  <StageStepIcon stage={stage} index={idx} />
                  <div className="min-w-0 flex-1 pt-0.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3
                          className={`text-sm font-bold ${
                            stage.state === 'upcoming' ? 'text-muted' : 'text-night'
                          }`}
                        >
                          {stage.name}
                        </h3>
                        <Badge tone={badge.tone}>{badge.label}</Badge>
                      </div>
                      {stage.reachedAt && (
                        <span className="num text-xs font-medium text-muted">
                          {formatDate(stage.reachedAt)}
                        </span>
                      )}
                    </div>
                    {stage.description && (
                      <p className="mt-1 text-xs leading-relaxed text-muted">{stage.description}</p>
                    )}
                    {stageNotes.length > 0 && (
                      <div className="mt-2 space-y-1.5">
                        {stageNotes.map((entry) => (
                          <div
                            key={entry.id}
                            className="rounded-md border border-rule bg-paper px-3 py-2 text-xs text-ink"
                          >
                            <p>{entry.note}</p>
                            <p className="mt-0.5 text-[11px] text-muted">{formatDate(entry.changedAt)}</p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        )}

        {/* Customer-visible status history & notes */}
        {timeline.history.length > 0 && (
          <div className="mt-6 border-t border-rule pt-5">
            <h3 className="text-xs font-bold uppercase tracking-[0.06em] text-muted">Status updates</h3>
            <ul className="mt-3 space-y-3" aria-label="Status history">
              {timeline.history.map((item) => (
                <li
                  key={item.id}
                  className="flex flex-col gap-1 rounded-md border border-rule bg-paper/60 px-3.5 py-2.5 text-xs sm:flex-row sm:items-start sm:justify-between"
                >
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-night">{item.statusLabel}</span>
                      {item.stageName && <span className="text-muted">· {item.stageName}</span>}
                    </div>
                    {item.note && <p className="text-ink">{item.note}</p>}
                  </div>
                  <span className="num shrink-0 text-muted">{formatDate(item.changedAt)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      {actionError && <Notice tone="error">{actionError}</Notice>}

      {/* Detail Tabs (M5.5 & M5.7) */}
      <div className="space-y-4">
        <div
          role="tablist"
          aria-label="Application sections"
          className="flex gap-1 overflow-x-auto border-b border-rule"
        >
          {DETAIL_TABS.map((t) => {
            const selected = activeTab === t.key;
            return (
              <button
                key={t.key}
                type="button"
                role="tab"
                aria-selected={selected}
                onClick={() => setActiveTab(t.key)}
                className={`inline-flex shrink-0 items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-semibold transition-colors ${
                  selected
                    ? 'border-ink text-ink'
                    : 'border-transparent text-muted hover:border-rule hover:text-night'
                }`}
              >
                <span>{t.label}</span>
                {t.key === 'documents' && pendingMandatory > 0 && (
                  <Badge tone="warning">{pendingMandatory}</Badge>
                )}
                {t.key === 'deliverables' && deliverables.length > 0 && (
                  <Badge tone="success">{deliverables.length}</Badge>
                )}
                {t.key === 'messages' && unreadMessages > 0 && (
                  <Badge tone="info">{unreadMessages}</Badge>
                )}
              </button>
            );
          })}
        </div>

        {/* Tab: Documents */}
        {activeTab === 'documents' && (
          <section aria-label="Documents" className="space-y-5">
            <DocumentsTab checklist={checklist} applicationId={applicationId} onChange={setChecklist} />
          </section>
        )}

        {/* Tab: Form (read-only answers) */}
        {activeTab === 'form' && (
          <section aria-label="Form answers" className="space-y-4">
            {!formDetail ? (
              <div className="rounded-lg border border-rule bg-white p-6 text-sm text-muted">
                No form answers available for this application.
              </div>
            ) : (
              formDetail.formSchema.steps.map((step) => {
                const formData = formDetail.formData ?? {};
                const visibleFields = step.fields.filter(
                  (f: FormField) => !f.showIf || conditionMet(f.showIf, formData),
                );
                return (
                  <div
                    key={`${step.title}-${step.fields.map((field) => field.name).join('-')}`}
                    className="rounded-lg border border-rule bg-white p-5 sm:p-6"
                  >
                    <h2 className="border-b border-rule pb-3 text-base font-bold text-night">{step.title}</h2>
                    {step.description && <p className="mt-1 text-xs text-muted">{step.description}</p>}
                    {visibleFields.length === 0 ? (
                      <p className="mt-3 text-sm text-muted">No fields in this section.</p>
                    ) : (
                      <dl className="mt-4 divide-y divide-rule text-sm">
                        {visibleFields.map((field: FormField) => {
                          const rawVal = formData[field.name];
                          if (field.type === 'repeater') {
                            const rows = Array.isArray(rawVal)
                              ? rawVal.filter((r): r is Record<string, unknown> => typeof r === 'object' && r !== null)
                              : [];
                            return (
                              <div key={field.name} className="py-3 first:pt-0 last:pb-0">
                                <dt className="font-semibold text-muted">{field.label}</dt>
                                <dd className="mt-2 space-y-3">
                                  {rows.length === 0 ? (
                                    <span className="text-muted">—</span>
                                  ) : (
                                    rows.map((row, rowIdx) => (
                                      <div
                                        key={`${field.itemLabel}-${JSON.stringify(row)}`}
                                        className="rounded-md border border-rule bg-paper/60 p-3 text-xs"
                                      >
                                        <p className="mb-2 font-bold text-ink">
                                          {field.itemLabel} {rowIdx + 1}
                                        </p>
                                        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                                          {field.fields
                                            .filter((sub) => !sub.showIf || conditionMet(sub.showIf, row))
                                            .map((sub) => (
                                              <div key={sub.name}>
                                                <span className="text-muted">{sub.label}: </span>
                                                <ReadOnlyLeafAnswer
                                                  field={sub}
                                                  value={row[sub.name]}
                                                  onOpenFile={openInlineFile}
                                                />
                                              </div>
                                            ))}
                                        </div>
                                      </div>
                                    ))
                                  )}
                                </dd>
                              </div>
                            );
                          }

                          return (
                            <div
                              key={field.name}
                              className="flex flex-col gap-1 py-3 first:pt-0 last:pb-0 sm:flex-row sm:justify-between sm:gap-4"
                            >
                              <dt className="font-medium text-muted">{field.label}</dt>
                              <dd className="sm:text-right">
                                <ReadOnlyLeafAnswer
                                  field={field}
                                  value={rawVal}
                                  onOpenFile={(fid) => void openFileLink(fid, 'inline')}
                                />
                              </dd>
                            </div>
                          );
                        })}
                      </dl>
                    )}
                  </div>
                );
              })
            )}
          </section>
        )}

        {/* Tab: Payments */}
        {activeTab === 'payments' && (
          <section aria-label="Payments and invoices" className="space-y-5">
            {!paymentStatus ? (
              <div className="rounded-lg border border-rule bg-white p-6 text-sm text-muted">
                Payment details are not available for this application yet.
              </div>
            ) : (
              <div className="rounded-lg border border-rule bg-white p-5 sm:p-6">
                <div className="flex flex-wrap items-center justify-between gap-4 border-b border-rule pb-4">
                  <div>
                    <h2 className="text-base font-bold text-night">Order Summary</h2>
                    <p className="mt-0.5 text-xs text-muted">
                      Order <span className="num font-mono font-semibold text-ink">{paymentStatus.orderCode}</span> ·{' '}
                      {paymentStatus.orderStatus}
                    </p>
                  </div>
                  {paymentStatus.balance > 0 && timeline.status !== 'CANCELLED' && (
                    <LinkButton
                      href={`/apply/${timeline.serviceSlug}/${applicationId}/payment`}
                      variant="primary"
                      size="sm"
                    >
                      Pay balance ({formatINR(paymentStatus.balance)})
                    </LinkButton>
                  )}
                </div>

                <dl className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
                  <div className="rounded-md border border-rule bg-paper/50 p-3.5">
                    <dt className="text-xs font-semibold uppercase tracking-[0.06em] text-muted">Order total</dt>
                    <dd className="num mt-1 text-lg font-bold text-night">{formatINR(paymentStatus.total)}</dd>
                  </div>
                  <div className="rounded-md border border-rule bg-paper/50 p-3.5">
                    <dt className="text-xs font-semibold uppercase tracking-[0.06em] text-muted">Paid</dt>
                    <dd className="num mt-1 text-lg font-bold text-emerald-700">
                      {formatINR(paymentStatus.amountPaid)}
                    </dd>
                  </div>
                  <div className="rounded-md border border-rule bg-paper/50 p-3.5">
                    <dt className="text-xs font-semibold uppercase tracking-[0.06em] text-muted">Balance</dt>
                    <dd
                      className={`num mt-1 text-lg font-bold ${
                        paymentStatus.balance > 0 ? 'text-amber-700' : 'text-night'
                      }`}
                    >
                      {formatINR(paymentStatus.balance)}
                    </dd>
                  </div>
                </dl>
              </div>
            )}

            <div className="rounded-lg border border-rule bg-white p-5 sm:p-6">
              <h2 className="text-base font-bold text-night">GST Invoices</h2>
              <p className="mt-0.5 text-xs text-muted">
                Official tax invoices issued for completed payments on this application.
              </p>

              {invoices.length === 0 ? (
                <p className="mt-4 text-sm text-muted">No invoices issued yet.</p>
              ) : (
                <ul className="mt-4 divide-y divide-rule">
                  {invoices.map((inv) => (
                    <li
                      key={inv.id}
                      className="flex flex-col gap-3 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div>
                        <p className="num font-mono text-sm font-bold text-night">{inv.number}</p>
                        <p className="text-xs text-muted">
                          Issued {formatDate(inv.issuedAt)} · {formatINR(inv.total)}
                        </p>
                      </div>
                      <div>
                        {inv.pdfReady ? (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={downloadingId === inv.id}
                            onClick={() => void downloadInvoice(inv.id)}
                          >
                            <Icon name="download" size={15} />
                            <span>{downloadingId === inv.id ? 'Opening…' : 'Download invoice'}</span>
                          </Button>
                        ) : (
                          <Badge tone="neutral">Generating PDF…</Badge>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>
        )}

        {/* Tab: Deliverables */}
        {activeTab === 'deliverables' && (
          <section aria-label="Deliverables" className="rounded-lg border border-rule bg-white p-5 sm:p-6">
            <h2 className="text-base font-bold text-night">Final Deliverables</h2>
            <p className="mt-0.5 text-xs text-muted">
              Official certificates, registrations, and filings uploaded by our team upon completion.
            </p>

            {deliverables.length === 0 ? (
              <EmptyState
                className="mt-4 py-8"
                icon={<Icon name="download" size={32} className="text-ink/40" />}
                title="No deliverables yet"
                description="Once our team completes your application, your final documents will be ready to download here."
              />
            ) : (
              <ul className="mt-4 divide-y divide-rule">
                {deliverables.map((d) => (
                  <li
                    key={d.id}
                    className="flex flex-col gap-3 py-3.5 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="min-w-0">
                      <p className="font-semibold text-night">{d.title}</p>
                      <p className="truncate text-xs text-muted">
                        {d.fileName} · Uploaded {formatDate(d.createdAt)}
                      </p>
                    </div>
                    <div className="shrink-0">
                      <Button
                        type="button"
                        variant="ink"
                        size="sm"
                        disabled={downloadingId === d.fileId}
                        onClick={() => void openFileLink(d.fileId, 'attachment')}
                      >
                        <Icon name="download" size={15} />
                        <span>{downloadingId === d.fileId ? 'Opening…' : 'Download'}</span>
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        {/* Tab: Messages (M5.7) */}
        {activeTab === 'messages' && (
          <section aria-label="Messages" className="rounded-lg border border-rule bg-white p-5 sm:p-6">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-base font-bold text-night">Messages</h2>
                <p className="mt-0.5 text-xs text-muted">
                  Direct conversation with the BizNexa team handling your application.
                </p>
              </div>
              {unreadMessages > 0 && <Badge tone="info">{unreadMessages} unread</Badge>}
            </div>

            {messageError && (
              <div className="mb-4">
                <Notice tone="error">{messageError}</Notice>
              </div>
            )}

            {hasOlderMessages && (
              <div className="mb-4 text-center">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={loadingOlder}
                  onClick={() => void handleLoadOlderMessages()}
                >
                  {loadingOlder ? 'Loading…' : 'Load older'}
                </Button>
              </div>
            )}

            {messages.length === 0 ? (
              <EmptyState
                className="py-8"
                icon={<Icon name="message" size={32} className="text-ink/40" />}
                title="No messages yet"
                description="Send a message below if you have any questions about your application."
              />
            ) : (
              <ul className="mb-4 max-h-96 space-y-3 overflow-y-auto pr-1" aria-label="Message thread">
                {messages.map((msg) => {
                  const isStaff = msg.sender.isStaff;
                  return (
                    <li
                      key={msg.id}
                      data-sender={isStaff ? 'staff' : 'customer'}
                      className={`rounded-lg border p-3.5 ${
                        isStaff ? 'border-rule bg-paper text-night' : 'border-sky-200 bg-sky-50/70 text-night'
                      }`}
                    >
                      <div className="mb-1 flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
                        <span className="font-semibold text-night">
                          {msg.sender.name}{' '}
                          <span className="font-normal text-muted">
                            ({isStaff ? 'BizNexa Team' : 'You'})
                          </span>
                        </span>
                        <span className="num">{formatDate(msg.createdAt)}</span>
                      </div>
                      <p className="whitespace-pre-wrap text-sm">{msg.body}</p>
                    </li>
                  );
                })}
              </ul>
            )}

            <form onSubmit={(e) => void handleSendMessage(e)} className="mt-4 space-y-2 border-t border-rule pt-4">
              <label htmlFor="customer-message-input" className="block text-xs font-semibold text-ink">
                Your message
              </label>
              <textarea
                id="customer-message-input"
                rows={3}
                value={draftMessage}
                onChange={(e) => setDraftMessage(e.target.value)}
                placeholder="Write a message to our team…"
                maxLength={4000}
                className="w-full rounded-md border border-rule bg-white p-2.5 text-sm text-night focus:border-ink focus:outline-none"
              />
              <div className="flex justify-end">
                <Button type="submit" variant="primary" disabled={!draftMessage.trim() || sendingMessage}>
                  {sendingMessage ? 'Sending…' : 'Send'}
                </Button>
              </div>
            </form>
          </section>
        )}
      </div>
    </div>
  );
}
