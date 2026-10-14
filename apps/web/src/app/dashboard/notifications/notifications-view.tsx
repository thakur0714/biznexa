'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Badge, Button, EmptyState, LinkButton, Notice } from '@biznexa/ui';
import { Icon } from '@/components/icons';
import { formatDate } from '@biznexa/types';
import type { NotificationItem, NotificationListPage } from '@biznexa/types';
import { useApi } from '@biznexa/api-client/react';
import { ClientApiError } from '@biznexa/api-client/browser';

interface NotificationsState {
  items: NotificationItem[];
  total: number;
  page: number;
  pages: number;
  unreadCount: number;
}

export function NotificationsView() {
  const api = useApi();
  const router = useRouter();

  const [page, setPage] = useState(1);
  const [refreshKey, setRefreshKey] = useState(0);
  const [data, setData] = useState<NotificationsState | null>(null);
  const [error, setError] = useState('');
  const [markingAll, setMarkingAll] = useState(false);

  useEffect(() => {
    let live = true;

    (async () => {
      try {
        const [pageData, countData] = await Promise.all([
          api.call<NotificationListPage>((c) =>
            c.GET('/api/notifications', {
              params: { query: { page, limit: 20 } },
            })
          ),
          api.call<{ count: number }>((c) => c.GET('/api/notifications/unread-count')),
        ]);

        if (live) {
          setData({
            items: pageData.items,
            total: pageData.total,
            page: pageData.page,
            pages: pageData.pages,
            unreadCount: countData.count,
          });
          setError('');
        }
      } catch (err) {
        if (live) {
          const message = err instanceof ClientApiError ? err.message : 'Failed to load notifications. Please try again.';
          setError(message);
        }
      }
    })();

    return () => {
      live = false;
    };
  }, [api, page, refreshKey]);

  async function handleMarkAllRead() {
    if (markingAll || !data || data.unreadCount === 0) return;
    setMarkingAll(true);
    try {
      await api.call((c) => c.POST('/api/notifications/read-all'));
      const now = new Date().toISOString();
      setData((prev) =>
        prev
          ? {
              ...prev,
              items: prev.items.map((item) => ({ ...item, readAt: item.readAt ?? now })),
              unreadCount: 0,
            }
          : prev
      );
    } catch (err) {
      const message = err instanceof ClientApiError ? err.message : 'Could not mark notifications as read.';
      setError(message);
    } finally {
      setMarkingAll(false);
    }
  }

  async function handleItemClick(item: NotificationItem) {
    if (!item.readAt) {
      // Optimistic update in UI
      const now = new Date().toISOString();
      setData((prev) =>
        prev
          ? {
              ...prev,
              items: prev.items.map((i) => (i.id === item.id ? { ...i, readAt: now } : i)),
              unreadCount: Math.max(0, prev.unreadCount - 1),
            }
          : prev
      );

      // Call API in background
      api
        .call((c) =>
          c.POST('/api/notifications/{id}/read', {
            params: { path: { id: item.id } },
          })
        )
        .catch(() => undefined);
    }

    if (item.link) {
      router.push(item.link);
    }
  }

  const loading = data === null && !error;
  const items = data?.items ?? [];
  const unreadCount = data?.unreadCount ?? 0;
  const pages = data?.pages ?? 1;
  const total = data?.total ?? 0;

  return (
    <div className="mx-auto max-w-[800px] min-w-0 px-4 py-8 sm:px-6">
      <div className="mb-6">
        <Link
          href="/dashboard"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-muted hover:text-ink transition-colors"
        >
          <span aria-hidden="true">&larr;</span> Back to dashboard
        </Link>
      </div>

      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold tracking-[-0.025em] text-night sm:text-3xl">Notifications</h1>
            {unreadCount > 0 && <Badge tone="info">{unreadCount} unread</Badge>}
          </div>
          <p className="mt-1 text-sm text-muted">Updates about your applications, payments and certificates.</p>
        </div>

        {unreadCount > 0 && (
          <Button
            variant="outline"
            size="sm"
            onClick={handleMarkAllRead}
            disabled={markingAll || loading}
            aria-busy={markingAll}
          >
            {markingAll ? 'Marking all...' : 'Mark all as read'}
          </Button>
        )}
      </div>

      {error && (
        <div className="mb-6">
          <Notice tone="error">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span>{error}</span>
              <button
                type="button"
                onClick={() => setRefreshKey((k) => k + 1)}
                className="font-medium underline hover:text-danger-900"
              >
                Try again
              </button>
            </div>
          </Notice>
        </div>
      )}

      {loading ? (
        <div className="space-y-3" aria-busy="true" aria-label="Loading notifications">
          {[1, 2, 3].map((i) => (
            <div key={i} className="animate-pulse rounded-lg border border-rule bg-white p-5">
              <div className="flex items-center justify-between gap-4">
                <div className="h-5 w-48 rounded bg-paper" />
                <div className="h-4 w-24 rounded bg-paper" />
              </div>
              <div className="mt-3 h-4 w-full rounded bg-paper" />
              <div className="mt-2 h-4 w-2/3 rounded bg-paper" />
            </div>
          ))}
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          icon={<Icon name="bell" size={40} className="text-muted" />}
          title="No notifications yet"
          description="When you receive updates on your applications, filings, or certificates, they will appear here."
          action={
            <LinkButton href="/dashboard" variant="outline">
              Back to dashboard
            </LinkButton>
          }
        />
      ) : (
        <div className="space-y-3" role="feed" aria-label="Notifications list">
          {items.map((item) => {
            const isUnread = !item.readAt;
            return (
              <article
                key={item.id}
                tabIndex={0}
                role="button"
                onClick={() => handleItemClick(item)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    handleItemClick(item);
                  }
                }}
                className={`group relative cursor-pointer rounded-lg border p-4 sm:p-5 transition-all outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2 ${
                  isUnread
                    ? 'border-l-4 border-rule border-l-ink bg-sky-050/30 hover:bg-sky-050/60 shadow-xs'
                    : 'border-rule border-l-4 border-l-transparent bg-white hover:bg-paper/50'
                }`}
                aria-label={`${item.title}, ${formatDate(item.createdAt)}${isUnread ? ', unread' : ''}`}
              >
                <div className="flex items-start justify-between gap-2 sm:gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2
                        className={`text-base tracking-[-0.01em] ${
                          isUnread ? 'font-bold text-night' : 'font-medium text-ink'
                        }`}
                      >
                        {item.title}
                      </h2>
                      {isUnread && (
                        <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-ink">
                          <span className="h-2 w-2 rounded-full bg-ink" aria-hidden="true" />
                          New
                        </span>
                      )}
                    </div>

                    {/* Notification body rendered as plain text (React escaping, no dangerouslySetInnerHTML) */}
                    <p className="mt-1.5 text-sm leading-relaxed text-ink/80 whitespace-pre-wrap break-words">
                      {item.body}
                    </p>

                    {item.link && (
                      <div className="mt-3 flex items-center gap-1 text-xs font-semibold text-ink group-hover:underline">
                        <span>View details</span>
                        <Icon name="chevronRight" size={14} />
                      </div>
                    )}
                  </div>

                  <time
                    dateTime={item.createdAt}
                    className="shrink-0 text-xs font-medium text-muted pt-0.5"
                  >
                    {formatDate(item.createdAt)}
                  </time>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {!loading && pages > 1 && (
        <nav aria-label="Notifications pagination" className="mt-8 flex items-center justify-between gap-4 border-t border-rule pt-4">
          <p className="text-xs text-muted">
            Page <span className="font-semibold text-ink">{page}</span> of{' '}
            <span className="font-semibold text-ink">{pages}</span> ({total} total)
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => {
                setData(null);
                setPage((p) => Math.max(1, p - 1));
              }}
            >
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= pages}
              onClick={() => {
                setData(null);
                setPage((p) => Math.min(pages, p + 1));
              }}
            >
              Next
            </Button>
          </div>
        </nav>
      )}
    </div>
  );
}
