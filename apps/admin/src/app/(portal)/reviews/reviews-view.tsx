'use client';

import { useCallback, useEffect, useState } from 'react';
import { adminReviewListSchema, reviewModerationStatuses, type AdminReview, type AdminReviewList } from '@biznexa/types';
import { useApi } from '@biznexa/api-client/react';
import { Button, EmptyState, Notice, Select } from '@biznexa/ui';
import { NotAllowed } from '@/components/portal-shell';
import { useAuth } from '@/lib/auth';
import { canSee, findNavItem } from '@/lib/nav';

const labels: Record<(typeof reviewModerationStatuses)[number], string> = { PENDING: 'Pending', APPROVED: 'Approved', REJECTED: 'Rejected' };

export function ReviewsView() {
  const api = useApi();
  const { user } = useAuth();
  const navItem = findNavItem('reviews');
  const [status, setStatus] = useState<(typeof reviewModerationStatuses)[number]>('PENDING');
  const [result, setResult] = useState<AdminReviewList | null>(null);
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const value = await api.call((client) => client.GET('/api/admin/reviews', { params: { query: { status } } }));
      setResult(adminReviewListSchema.parse(value));
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load reviews.');
    } finally { setLoading(false); }
  }, [api, status]);

  useEffect(() => {
    let live = true;
    api.call((client) => client.GET('/api/admin/reviews', { params: { query: { status } } })).then((value) => {
      if (live) { setResult(adminReviewListSchema.parse(value)); setError(''); }
    }).catch((cause: unknown) => {
      if (live) setError(cause instanceof Error ? cause.message : 'Could not load reviews.');
    }).finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [api, status]);

  async function moderate(review: AdminReview, nextStatus: 'APPROVED' | 'REJECTED') {
    setBusyId(review.id);
    setError('');
    try {
      await api.call((client) => client.POST('/api/admin/reviews/{id}/moderate', {
        params: { path: { id: review.id } },
        body: { status: nextStatus, reason: reasons[review.id]?.trim() || undefined },
      }));
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not moderate this review.');
    } finally { setBusyId(null); }
  }

  if (!user || !navItem) return null;
  if (!canSee(navItem, user.permissions)) return <NotAllowed />;

  return <main className="space-y-5 p-4 sm:p-6" aria-labelledby="reviews-heading">
    <header className="flex flex-wrap items-end justify-between gap-3">
      <div><h1 id="reviews-heading" className="text-2xl font-semibold">Review moderation</h1><p className="mt-1 text-sm text-muted">Only approved reviews appear on consultant profiles and affect ratings.</p></div>
      <Select id="review-status" label="Status" className="w-full max-w-xs" value={status} onChange={(event) => { setLoading(true); setStatus(event.target.value as typeof status); }}>
        {reviewModerationStatuses.map((value) => <option key={value} value={value}>{labels[value]}</option>)}
      </Select>
    </header>
    {error && <Notice tone="error">{error}</Notice>}
    {loading ? <p role="status">Loading reviews…</p> : result?.items.length ? <div className="space-y-3">{result.items.map((review) => <article key={review.id} className="rounded-lg border border-rule bg-white p-5">
      <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="font-semibold">{review.consultantName}</h2><p className="text-sm text-muted">{review.customerName} · {review.bookingCode} · {new Date(review.createdAt).toLocaleDateString('en-IN')}</p></div><span aria-label={`${review.rating} out of 5 stars`} className="font-semibold text-amber-700">{'★'.repeat(review.rating)}{'☆'.repeat(5 - review.rating)} <span className="text-xs">{review.rating}/5</span></span></div>
      <p className="mt-3 whitespace-pre-wrap text-sm">{review.text || 'No written comment.'}</p>
      {review.moderationReason && <p className="mt-2 text-sm text-muted">Moderation note: {review.moderationReason}</p>}
      {review.status === 'PENDING' && <div className="mt-4 flex flex-wrap items-end gap-2"><label className="min-w-[220px] flex-1 text-sm">Rejection reason<textarea className="mt-1 block w-full rounded-md border border-rule p-2" value={reasons[review.id] ?? ''} onChange={(event) => setReasons((current) => ({ ...current, [review.id]: event.target.value }))} rows={2} /></label><Button disabled={busyId === review.id} onClick={() => void moderate(review, 'APPROVED')}>Approve</Button><Button variant="outline" disabled={busyId === review.id || (reasons[review.id] ?? '').trim().length < 3} onClick={() => void moderate(review, 'REJECTED')}>Reject</Button></div>}
    </article>)}</div> : <EmptyState title={`No ${labels[status].toLowerCase()} reviews`} description="Reviews matching this status will appear here." />}
  </main>;
}
