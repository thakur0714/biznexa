'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useApi } from '@biznexa/api-client/react';
import { Button, Notice } from '@biznexa/ui';
import { formatDate, type Message, type MessageThreadPage, type StoredFileResult, type FileLinkResult } from '@biznexa/types';

export function MessagesPanel({ applicationId }: { applicationId: string }) {
  const api = useApi();
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [body, setBody] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [sending, setSending] = useState(false);
  const [openingFileId, setOpeningFileId] = useState<string | null>(null);

  async function openFile(fileId: string) {
    setError(null);
    setOpeningFileId(fileId);
    const tab = window.open('', '_blank');
    try {
      const link = await api.call<FileLinkResult>((client) => client.POST('/api/files/{id}/link', {
        params: { path: { id: fileId }, query: { disposition: 'inline' } },
      }));
      if (tab) {
        tab.opener = null;
        tab.location.href = link.url;
      } else {
        window.location.assign(link.url);
      }
    } catch (err: unknown) {
      tab?.close();
      setError(err instanceof Error ? err.message : 'Could not open this file.');
    } finally {
      setOpeningFileId(null);
    }
  }

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
    if ((!trimmed && files.length === 0) || sending) return;
    setSending(true);
    setError(null);
    try {
      const fileIds: string[] = [];
      for (const f of files) {
        const formData = new FormData();
        formData.append('file', f);
        const uploadBody = Object.assign(formData, { file: f.name });
        const uploaded = await api.call<StoredFileResult>((c) => c.POST('/api/files', { body: uploadBody }));
        fileIds.push(uploaded.id);
      }

      const created = await api.call<Message>((c) =>
        c.POST('/api/admin/applications/{applicationId}/messages', {
          params: { path: { applicationId } },
          body: { body: trimmed, fileIds: fileIds.length > 0 ? fileIds : undefined },
        }),
      );
      setMessages((prev) => [...prev, created]);
      setBody('');
      setFiles([]);
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
              {m.body && <p className="text-sm whitespace-pre-wrap">{m.body}</p>}
              {m.attachments && m.attachments.length > 0 && (
                <div className="mt-2 space-y-2">
                  {m.attachments.map(att => (
                    <div key={att.id} className="flex items-center gap-2 text-sm bg-white/50 p-2 rounded border border-rule">
                      <div className="flex-1 min-w-0">
                        <p className="truncate font-medium">{att.fileName}</p>
                        <p className="text-xs text-muted">{(att.sizeBytes / 1024).toFixed(1)} KB</p>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        type="button"
                        disabled={openingFileId === att.id}
                        onClick={() => openFile(att.id)}
                      >
                        {openingFileId === att.id ? 'Opening...' : 'Open'}
                      </Button>
                    </div>
                  ))}
                </div>
              )}
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
        {files.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-2">
            {files.map((f, i) => (
              <div key={i} className="flex items-center gap-1 bg-paper border border-rule rounded px-2 py-1 text-xs">
                <span className="truncate max-w-[150px]">{f.name}</span>
                <button
                  type="button"
                  onClick={() => setFiles(prev => prev.filter((_, idx) => idx !== i))}
                  className="text-muted hover:text-ink px-1"
                  aria-label={`Remove ${f.name}`}
                >
                  &times;
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="flex justify-between items-center">
          <div>
            <input
              type="file"
              id={`message-file-upload-${applicationId}`}
              multiple
              className="hidden"
              onChange={(e) => {
                if (e.target.files) {
                  const newFiles = Array.from(e.target.files);
                  setFiles(prev => {
                    const combined = [...prev, ...newFiles];
                    return combined.slice(0, 5);
                  });
                }
                e.target.value = '';
              }}
            />
            <Button
              variant="outline"
              type="button"
              disabled={sending || files.length >= 5}
              onClick={() => document.getElementById(`message-file-upload-${applicationId}`)?.click()}
            >
              Attach files
            </Button>
            {files.length >= 5 && <span className="ml-2 text-xs text-muted">Max 5 files</span>}
          </div>
          <Button variant="ink" type="submit" disabled={sending || (!trimmed && files.length === 0)}>
            {sending ? 'Sending...' : 'Send'}
          </Button>
        </div>
      </form>
    </section>
  );
}
