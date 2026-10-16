'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useApi } from '@biznexa/api-client/react';
import { Button, Notice } from '@biznexa/ui';
import { formatDate, type Message, type MessageThreadPage } from '@biznexa/types';

export function MessagesPanel({ applicationId }: { applicationId: string }) {
  const api = useApi();
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);

  useEffect(() => {
    let cancelled = false;

    api
      .call<MessageThreadPage>((c) =>
        c.GET('/api/admin/applications/{applicationId}/messages', {
          params: { path: { applicationId } },
        }),
      )
      .then((page) => {
        if (!cancelled) {
          setMessages(page.items);
          setLoading(false);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load messages');
          setLoading(false);
        }
      });

    api
      .call((c) =>
        c.POST('/api/admin/applications/{applicationId}/messages/read', {
          params: { path: { applicationId } },
        }),
      )
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [api, applicationId]);

  const trimmed = body.trim();

  async function handleSend(e: FormEvent) {
    e.preventDefault();
    if (!trimmed || sending) return;
    setSending(true);
    setError(null);
    try {
      const created = await api.call<Message>((c) =>
        c.POST('/api/admin/applications/{applicationId}/messages', {
          params: { path: { applicationId } },
          body: { body: trimmed },
        }),
      );
      setMessages((prev) => [...prev, created]);
      setBody('');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to send message');
    } finally {
      setSending(false);
    }
  }

  return (
    <section className="p-4 bg-white border border-rule rounded-md space-y-4">
      <h2 className="font-semibold text-lg">Messages</h2>
      {error && <Notice tone="error">{error}</Notice>}

      {loading ? (
        <p className="text-muted text-sm">Loading messages...</p>
      ) : messages.length === 0 ? (
        <p className="text-muted text-sm">No messages yet.</p>
      ) : (
        <div className="space-y-3">
          {messages.map((m) => (
            <div
              key={m.id}
              data-sender-role={m.sender.isStaff ? 'staff' : 'customer'}
              className={
                m.sender.isStaff
                  ? 'p-3 rounded border bg-sky-50 border-sky-200 ml-6'
                  : 'p-3 rounded border bg-paper border-rule mr-6'
              }
            >
              <div className="flex items-center justify-between gap-2 text-xs text-muted mb-1">
                <span className="font-medium text-ink">
                  {m.sender.name} ({m.sender.isStaff ? 'Staff' : 'Customer'})
                </span>
                <span>{formatDate(m.createdAt)}</span>
              </div>
              <p className="text-sm whitespace-pre-wrap">{m.body}</p>
            </div>
          ))}
        </div>
      )}

      <form onSubmit={handleSend} className="space-y-2">
        <textarea
          name="messageBody"
          aria-label="Message"
          placeholder="Write a message..."
          rows={3}
          maxLength={4000}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          className="w-full border border-rule p-2 rounded text-sm"
        />
        <div className="flex justify-end">
          <Button variant="ink" type="submit" disabled={sending || !trimmed}>
            {sending ? 'Sending...' : 'Send'}
          </Button>
        </div>
      </form>
    </section>
  );
}
