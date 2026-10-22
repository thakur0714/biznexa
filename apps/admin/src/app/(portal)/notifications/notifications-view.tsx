'use client';

import { useEffect, useState, useMemo, useRef, type SubmitEvent } from 'react';
import {
  NOTIFICATION_CHANNELS,
  NOTIFICATION_EVENT_VARIABLES,
  getSampleVariablesForEvent,
  getAllowedVariablesForEvent,
  escapeHtml,
  type NotificationChannel,
  type AdminNotificationTemplate,
} from '@biznexa/types';
import { Button, Field, Notice, Select, TextArea, Checkbox, Badge, useToast } from '@biznexa/ui';
import { ClientApiError } from '@biznexa/api-client/browser';
import { useApi } from '@biznexa/api-client/react';
import { NotAllowed } from '@/components/portal-shell';
import { useAuth } from '@/lib/auth';
import { canSee, findNavItem } from '@/lib/nav';

const EVENT_GROUPS: { label: string; events: string[] }[] = [
  {
    label: 'Authentication',
    events: ['auth.registered', 'auth.otp'],
  },
  {
    label: 'Orders & Payments',
    events: ['payment.succeeded', 'payment.failed', 'refund.processed', 'invoice.issued'],
  },
  {
    label: 'Applications & Documents',
    events: [
      'application.status_changed',
      'document.requested',
      'document.approved',
      'document.rejected',
      'expert.assigned',
    ],
  },
  {
    label: 'Certificates & Reminders',
    events: ['certificate.issued', 'certificate.expiring', 'compliance.reminder'],
  },
  {
    label: 'Support & Messages',
    events: ['ticket.created', 'ticket.replied', 'ticket.resolved', 'message.received'],
  },
  {
    label: 'Consultations',
    events: ['consultation.booked', 'consultation.reminder', 'consultation.cancelled'],
  },
  {
    label: 'Privacy & Account',
    events: ['privacy.export_ready', 'privacy.request_rejected', 'privacy.account_deleted'],
  },
];

export function NotificationsView() {
  const { user } = useAuth();
  const item = findNavItem('notifications');

  if (!user || !item) return null;
  if (!canSee(item, user.permissions)) return <NotAllowed />;

  return <TemplateEditor />;
}

function TemplateEditor() {
  const api = useApi();
  const toast = useToast();

  const [templates, setTemplates] = useState<AdminNotificationTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  const [selectedEvent, setSelectedEvent] = useState<string>('payment.succeeded');
  const [selectedChannel, setSelectedChannel] = useState<NotificationChannel>('EMAIL');
  const selectedEventRef = useRef(selectedEvent);
  const selectedChannelRef = useRef(selectedChannel);
  useEffect(() => {
    selectedEventRef.current = selectedEvent;
    selectedChannelRef.current = selectedChannel;
  }, [selectedEvent, selectedChannel]);

  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [dltTemplateId, setDltTemplateId] = useState('');
  const [isActive, setIsActive] = useState(true);

  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [activeInput, setActiveInput] = useState<'subject' | 'body'>('body');

  const applyTemplate = (t?: AdminNotificationTemplate) => {
    if (t) {
      setSubject(t.subject ?? '');
      setBody(t.body ?? '');
      setDltTemplateId(t.dltTemplateId ?? '');
      setIsActive(t.isActive);
    } else {
      setSubject('');
      setBody('');
      setDltTemplateId('');
      setIsActive(true);
    }
    setFieldErrors({});
    setFormError(null);
  };

  useEffect(() => {
    let cancelled = false;
    api
      .call((c) => c.GET('/api/admin/notifications/templates', {}))
      .then(
        (res) => {
          if (cancelled) return;
          const list = (res as { templates: AdminNotificationTemplate[] }).templates || [];
          setTemplates(list);
          const current = list.find((t) => t.event === selectedEventRef.current && t.channel === selectedChannelRef.current);
          applyTemplate(current);
          setLoading(false);
          setLoadError(null);
        },
        (err: Error) => {
          if (!cancelled) {
            setLoadError(err.message);
            setLoading(false);
          }
        },
      );
    return () => {
      cancelled = true;
    };
  }, [api, reload]);

  // Current active template from DB
  const currentTemplate = useMemo(() => {
    return templates.find((t) => t.event === selectedEvent && t.channel === selectedChannel);
  }, [templates, selectedEvent, selectedChannel]);

  const handleSelectEvent = (ev: string) => {
    setSelectedEvent(ev);
    const t = templates.find((row) => row.event === ev && row.channel === selectedChannel);
    applyTemplate(t);
  };

  const handleSelectChannel = (ch: NotificationChannel) => {
    setSelectedChannel(ch);
    const t = templates.find((row) => row.event === selectedEvent && row.channel === ch);
    applyTemplate(t);
  };

  // Allowed variables for selected event
  const allowedVars = useMemo(() => {
    return getAllowedVariablesForEvent(selectedEvent);
  }, [selectedEvent]);

  const varInfoList = useMemo(() => {
    return (NOTIFICATION_EVENT_VARIABLES as Record<string, { name: string; description: string; sample: string }[]>)[
      selectedEvent
    ] || [];
  }, [selectedEvent]);

  // Parse variables in current text
  const { variablesUsed, unknownVariables } = useMemo(() => {
    const combined = `${subject} ${body}`;
    const regex = /{{\s*(\w+)\s*}}/g;
    const used = new Set<string>();
    let m: RegExpExecArray | null;
    while ((m = regex.exec(combined)) !== null) {
      used.add(m[1]);
    }
    const list = Array.from(used);
    const unknown = list.filter((v) => !allowedVars.includes(v));
    return { variablesUsed: list, unknownVariables: unknown };
  }, [subject, body, allowedVars]);

  // Live rendered preview
  const preview = useMemo(() => {
    const samples = getSampleVariablesForEvent(selectedEvent);
    const render = (text: string, isEmailHtml: boolean) => {
      return text.replaceAll(/{{\s*(\w+)\s*}}/g, (_match, name: string) => {
        const val = samples[name];
        if (val === undefined || val === null) {
          return `{{${name}}}`;
        }
        return isEmailHtml ? escapeHtml(val) : val;
      });
    };

    return {
      subject: subject ? render(subject, selectedChannel === 'EMAIL') : '',
      body: body ? render(body, selectedChannel === 'EMAIL') : '',
    };
  }, [subject, body, selectedChannel, selectedEvent]);

  const insertVariable = (varName: string) => {
    const tag = `{{${varName}}}`;
    if (activeInput === 'subject') {
      setSubject((prev) => `${prev}${prev && !prev.endsWith(' ') ? ' ' : ''}${tag}`);
    } else {
      setBody((prev) => `${prev}${prev && !prev.endsWith(' ') ? ' ' : ''}${tag}`);
    }
  };

  const isDirty = useMemo(() => {
    if (!currentTemplate) return false;
    return (
      (currentTemplate.subject ?? '') !== subject ||
      currentTemplate.body !== body ||
      (currentTemplate.dltTemplateId ?? '') !== dltTemplateId ||
      currentTemplate.isActive !== isActive
    );
  }, [currentTemplate, subject, body, dltTemplateId, isActive]);

  async function handleSave(e: SubmitEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!currentTemplate) return;

    if (!body.trim()) {
      setFieldErrors({ body: 'Body cannot be empty' });
      return;
    }

    setSaving(true);
    setFormError(null);
    setFieldErrors({});

    try {
      const updated = (await api.call((c) =>
        c.PUT('/api/admin/notifications/templates/{id}', {
          params: { path: { id: currentTemplate.id } },
          body: {
            subject: subject.trim() || null,
            body: body.trim(),
            dltTemplateId: dltTemplateId.trim() || null,
            isActive,
          },
        }),
      )) as AdminNotificationTemplate;

      setTemplates((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
      toast('Notification template saved successfully', 'success');
    } catch (err) {
      if (err instanceof ClientApiError && err.errors?.length) {
        setFieldErrors(Object.fromEntries(err.errors.map((x) => [x.field, x.message])));
      } else {
        setFormError((err as Error).message);
      }
    } finally {
      setSaving(false);
    }
  }

  const smsCharCount = body.length;
  const smsSegments = Math.max(1, Math.ceil(smsCharCount / 160));

  if (loading) {
    return (
      <div className="max-w-[1100px] py-4">
        <h1 className="text-2xl font-bold tracking-[-0.02em] text-night">Notification Templates</h1>
        <output className="block mt-4 text-muted">
          Loading notification templates…
        </output>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="max-w-[1100px] py-4 space-y-4">
        <h1 className="text-2xl font-bold tracking-[-0.02em] text-night">Notification Templates</h1>
        <Notice tone="error">{loadError}</Notice>
        <Button variant="outline" size="sm" onClick={() => { setLoading(true); setReload((n) => n + 1); }}>
          Try again
        </Button>
      </div>
    );
  }

  return (
    <div className="max-w-[1200px] space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-[-0.02em] text-night">Notification Templates</h1>
          <p className="mt-1 text-sm text-muted">
            Configure message templates and test live previews across email, SMS, push, and in-app channels.
          </p>
        </div>
        {currentTemplate && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted">Status:</span>
            <Badge tone={isActive ? 'success' : 'neutral'}>
              {isActive ? 'Active' : 'Inactive'}
            </Badge>
          </div>
        )}
      </div>

      {formError && <Notice tone="error">{formError}</Notice>}

      {/* Event Selection */}
      <div className="rounded-lg border border-rule bg-white p-4 shadow-xs">
        <label htmlFor="event-select" className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-muted">
          Select Event Trigger
        </label>
        <div className="max-w-md">
          <Select
            id="event-select"
            label=""
            value={selectedEvent}
            onChange={(e) => handleSelectEvent(e.target.value)}
          >
            {EVENT_GROUPS.map((g) => (
              <optgroup key={g.label} label={g.label}>
                {g.events.map((ev) => (
                  <option key={ev} value={ev}>
                    {ev}
                  </option>
                ))}
              </optgroup>
            ))}
          </Select>
        </div>
      </div>

      {/* Channel Tabs */}
      <div className="border-b border-rule">
        <div className="flex gap-2 overflow-x-auto pb-px">
          {NOTIFICATION_CHANNELS.map((ch) => {
            const isSelected = selectedChannel === ch;
            const t = templates.find((row) => row.event === selectedEvent && row.channel === ch);
            return (
              <button
                key={ch}
                type="button"
                onClick={() => handleSelectChannel(ch)}
                className={`flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${
                  isSelected
                    ? 'border-ink text-night'
                    : 'border-transparent text-muted hover:border-rule hover:text-night'
                }`}
              >
                <span>{ch.replace('_', '-')}</span>
                {t && (
                  <span
                    className={`size-2 rounded-full ${t.isActive ? 'bg-success' : 'bg-muted/40'}`}
                    title={t.isActive ? 'Active' : 'Inactive'}
                  />
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Main Grid: Editor on Left, Live Preview on Right */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-start">
        {/* Editor Column */}
        <form onSubmit={handleSave} className="space-y-5 rounded-lg border border-rule bg-white p-5 shadow-xs">
          <div className="flex items-center justify-between pb-2 border-b border-rule">
            <h2 className="text-base font-semibold text-night">
              Edit Template ({selectedChannel.replace('_', '-')})
            </h2>
            <Checkbox
              id="template-active-toggle"
              label="Enabled"
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
            />
          </div>

          {/* Subject field (for Email, In-App, Push) */}
          {selectedChannel !== 'SMS' && selectedChannel !== 'WHATSAPP' && (
            <div>
              <Field
                id="template-subject"
                label={selectedChannel === 'EMAIL' ? 'Email Subject' : 'Notification Title / Subject'}
                value={subject}
                onFocus={() => setActiveInput('subject')}
                onChange={(e) => setSubject(e.target.value)}
                error={fieldErrors.subject}
                placeholder="e.g. Action Required: {{customerName}}"
              />
            </div>
          )}

          {/* Body field */}
          <div>
            <TextArea
              id="template-body"
              label={selectedChannel === 'EMAIL' ? 'HTML / Text Body' : 'Message Body'}
              rows={selectedChannel === 'SMS' ? 4 : 7}
              value={body}
              onFocus={() => setActiveInput('body')}
              onChange={(e) => setBody(e.target.value)}
              error={fieldErrors.body}
              hint={
                selectedChannel === 'EMAIL'
                  ? 'Supports plain text and standard HTML tags. Values are auto-escaped.'
                  : undefined
              }
              placeholder="Enter message text with {{variables}}..."
            />
            {selectedChannel === 'SMS' && (
              <div className="mt-1 flex items-center justify-between text-xs text-muted">
                <span>{smsCharCount} characters</span>
                <span>~{smsSegments} SMS {smsSegments > 1 ? 'segments' : 'segment'}</span>
              </div>
            )}
          </div>

          {/* SMS specific DLT Template ID */}
          {selectedChannel === 'SMS' && (
            <div>
              <Field
                id="template-dlt-id"
                label="DLT Template ID (India Telecom requirement)"
                value={dltTemplateId}
                onChange={(e) => setDltTemplateId(e.target.value)}
                error={fieldErrors.dltTemplateId}
                placeholder="e.g. DLT-120716179644"
                hint="Required by telecom operators to dispatch transactional SMS."
              />
            </div>
          )}

          {/* Unknown variable warning */}
          {unknownVariables.length > 0 && (
            <Notice tone="error">
              Unknown variable(s) detected: <strong>{unknownVariables.map((v) => `{{${v}}}`).join(', ')}</strong>.
              These variables may not be available when this event is dispatched.
            </Notice>
          )}

          {/* Variable Palette */}
          <div className="rounded-md border border-rule/70 bg-paper/50 p-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-night">
                Available Variables ({allowedVars.length})
              </span>
              <span className="text-xs text-muted">Click to insert into {activeInput}</span>
            </div>
            <div className="flex flex-wrap gap-1.5 max-h-36 overflow-y-auto pt-1">
              {varInfoList.map((v) => {
                const isUsed = variablesUsed.includes(v.name);
                return (
                  <button
                    key={v.name}
                    type="button"
                    onClick={() => insertVariable(v.name)}
                    title={`${v.description} (Sample: ${v.sample})`}
                    className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-mono transition-colors border ${
                      isUsed
                        ? 'border-ink bg-ink text-white'
                        : 'border-rule bg-white text-night hover:border-ink hover:bg-paper'
                    }`}
                  >
                    <span>{`{{${v.name}}}`}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex items-center justify-between pt-3 border-t border-rule">
            <span className="text-xs text-muted">
              {isDirty ? '● Unsaved changes' : 'All changes saved'}
            </span>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={!isDirty || saving}
                onClick={() => {
                  if (currentTemplate) {
                    setSubject(currentTemplate.subject ?? '');
                    setBody(currentTemplate.body ?? '');
                    setDltTemplateId(currentTemplate.dltTemplateId ?? '');
                    setIsActive(currentTemplate.isActive);
                    setFieldErrors({});
                  }
                }}
              >
                Reset
              </Button>
              <Button type="submit" size="sm" disabled={!isDirty || saving}>
                {saving ? 'Saving…' : 'Save Changes'}
              </Button>
            </div>
          </div>
        </form>

        {/* Live Preview Column */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-night">Live Channel Preview</h2>
            <Badge tone="neutral">Simulated Device</Badge>
          </div>

          {/* Email Preview Card */}
          {selectedChannel === 'EMAIL' && (
            <div className="overflow-hidden rounded-xl border border-rule bg-white shadow-sm">
              <div className="border-b border-rule bg-paper px-4 py-3 space-y-1.5 text-xs text-muted font-sans">
                <div className="flex items-center justify-between">
                  <span><strong>From:</strong> BizNexa Notifications &lt;no-reply@biznexa.com&gt;</span>
                  <span className="text-[11px] text-muted">just now</span>
                </div>
                <div>
                  <strong>To:</strong> Rajesh Sharma &lt;rajesh@example.com&gt;
                </div>
                <div className="text-sm font-semibold text-night pt-1">
                  {preview.subject || <span className="italic text-muted font-normal">No subject line</span>}
                </div>
              </div>
              <div className="p-6">
                <div
                  className="prose prose-sm max-w-none text-night leading-relaxed"
                  dangerouslySetInnerHTML={{ __html: preview.body || '<p class="italic text-muted">Empty email body</p>' }}
                />
                <div className="mt-8 border-t border-rule/60 pt-4 text-[11px] text-muted text-center">
                  BizNexa Technologies Pvt Ltd • 12 Mall Road, Ludhiana, Punjab
                </div>
              </div>
            </div>
          )}

          {/* SMS Preview Card */}
          {selectedChannel === 'SMS' && (
            <div className="max-w-sm mx-auto overflow-hidden rounded-2xl border-2 border-rule bg-paper shadow-md">
              <div className="border-b border-rule bg-white px-4 py-3 text-center">
                <div className="text-xs font-bold text-night tracking-wider">BIZNEXA</div>
                <div className="text-[10px] text-muted">
                  DLT: {dltTemplateId || <span className="text-danger">Unset</span>}
                </div>
              </div>
              <div className="p-4 min-h-[160px] flex flex-col justify-end">
                <div className="self-start max-w-[85%] rounded-2xl rounded-bl-xs bg-white px-3.5 py-2.5 text-sm text-night shadow-xs border border-rule/60 leading-relaxed">
                  {preview.body || <span className="italic text-muted">Empty message</span>}
                </div>
                <span className="mt-1 self-start text-[10px] text-muted px-1">Today 11:42 AM</span>
              </div>
            </div>
          )}

          {/* Push Preview Card */}
          {selectedChannel === 'PUSH' && (
            <div className="max-w-md mx-auto space-y-3">
              <div className="rounded-xl border border-rule/80 bg-white/95 p-3.5 shadow-md backdrop-blur-md">
                <div className="flex items-center justify-between text-xs text-muted mb-1">
                  <div className="flex items-center gap-1.5 font-semibold text-night">
                    <span className="size-4 rounded-sm bg-ink text-[10px] text-white flex items-center justify-center font-bold">
                      B
                    </span>{' '}
                    BizNexa
                  </div>
                  <span>now</span>
                </div>
                <div className="text-sm font-semibold text-night">
                  {preview.subject || <span className="italic text-muted font-normal">Push notification title</span>}
                </div>
                <p className="mt-0.5 text-xs text-muted leading-relaxed">
                  {preview.body || <span className="italic">Notification message body</span>}
                </p>
              </div>
            </div>
          )}

          {/* In-App Preview Card */}
          {selectedChannel === 'IN_APP' && (
            <div className="max-w-md mx-auto overflow-hidden rounded-xl border border-rule bg-white shadow-sm">
              <div className="border-b border-rule bg-paper px-3 py-2 text-xs font-medium text-muted">
                In-App Inbox Notification
              </div>
              <div className="p-4 flex gap-3 items-start">
                <div className="size-8 rounded-full bg-ink/10 text-ink flex items-center justify-center shrink-0 text-sm font-bold">
                  🔔
                </div>
                <div className="space-y-1 min-w-0">
                  <div className="text-sm font-semibold text-night">
                    {preview.subject || 'Notification Title'}
                  </div>
                  <p className="text-xs text-night/80 leading-relaxed">
                    {preview.body || <span className="italic text-muted">Notification body text</span>}
                  </p>
                  <span className="text-[11px] text-muted block pt-1">Just now</span>
                </div>
              </div>
            </div>
          )}

          {/* WhatsApp Preview Card */}
          {selectedChannel === 'WHATSAPP' && (
            <div className="max-w-sm mx-auto overflow-hidden rounded-2xl border-2 border-rule bg-[#EFEAE2] shadow-md">
              <div className="bg-[#075E54] text-white px-4 py-3 flex items-center gap-2">
                <span className="text-xs font-bold">BizNexa Business</span>
              </div>
              <div className="p-4 min-h-[160px] flex flex-col justify-end">
                <div className="self-start max-w-[90%] rounded-lg bg-white px-3 py-2 text-xs text-night shadow-xs border border-black/5 leading-relaxed">
                  {preview.body || <span className="italic text-muted">Empty message</span>}
                  <div className="text-[9px] text-muted text-right mt-1">11:42 AM</div>
                </div>
              </div>
            </div>
          )}

          {/* Variables Reference Panel */}
          <div className="rounded-lg border border-rule bg-white p-4 space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted">
              Sample Data Used for Preview
            </h3>
            <div className="grid grid-cols-2 gap-2 text-xs">
              {varInfoList.slice(0, 6).map((v) => (
                <div key={v.name} className="truncate">
                  <span className="font-mono text-muted">{v.name}:</span>{' '}
                  <span className="text-night font-medium">{v.sample}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
