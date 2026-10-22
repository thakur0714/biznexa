'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { BookingView, ReviewView } from '@biznexa/types';
import { useApi } from '@biznexa/api-client/react';
import { Button, Notice } from '@biznexa/ui';

export function ReviewForm({ bookingId }: Readonly<{ bookingId: string }>) {
  const api = useApi();
  const [booking, setBooking] = useState<BookingView | null>(null);
  const [review, setReview] = useState<ReviewView | null>(null);
  const [rating, setRating] = useState(5);
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    let live = true;
    Promise.all([
      api.call((client) => client.GET('/api/bookings/{id}', { params: { path: { id: bookingId } } })),
      api.call((client) => client.GET('/api/bookings/{id}/review', { params: { path: { id: bookingId } } })),
    ]).then(([bookingResult, reviewResult]) => {
      if (live) { setBooking(bookingResult); setReview(reviewResult); }
    }).catch((cause: unknown) => {
      if (live) setError(cause instanceof Error ? cause.message : 'Could not load this consultation.');
    }).finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [api, bookingId]);

  async function submit(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const result = await api.call((client) => client.POST('/api/bookings/{id}/review', { params: { path: { id: bookingId } }, body: { rating, text: text.trim() || undefined } }));
      setReview(result);
      setSubmitted(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not submit your review.');
    } finally { setBusy(false); }
  }

  let reviewContent: React.ReactNode;
  if (loading) {
    reviewContent = <output className="block mt-5">Loading consultation…</output>;
  } else if (booking?.status !== 'COMPLETED') {
    reviewContent = <p className="mt-4 rounded-lg border border-rule bg-white p-5 text-sm">Reviews are available after the consultant marks the session completed.</p>;
  } else if (review) {
    let reviewStatusLabel = 'Not published';
    if (review.status === 'PENDING') reviewStatusLabel = 'Pending review';
    else if (review.status === 'APPROVED') reviewStatusLabel = 'Published';
    else if (review.moderationReason) reviewStatusLabel += `: ${review.moderationReason}`;
    reviewContent = (
      <div className="mt-4 rounded-lg border border-rule bg-white p-5">
        <p className="font-medium">{submitted ? 'Your review was submitted for moderation.' : 'You have already reviewed this consultation.'}</p>
        <p className="mt-2 text-sm text-muted">{reviewStatusLabel}</p>
      </div>
    );
  } else {
    reviewContent = (
      <form className="mt-4 space-y-5 rounded-lg border border-rule bg-white p-5" onSubmit={submit}>
        <p className="text-sm text-muted">Share feedback about your session with {booking.consultant.name}.</p>
        <fieldset><legend className="mb-2 text-sm font-medium">Your rating</legend><div className="flex gap-2">{[1, 2, 3, 4, 5].map((value) => <button key={value} type="button" aria-label={`${value} star${value === 1 ? '' : 's'}`} aria-pressed={rating === value} onClick={() => setRating(value)} className={`text-3xl ${value <= rating ? 'text-amber-500' : 'text-muted/40'}`}>★</button>)}</div></fieldset>
        <label className="block text-sm font-medium">Comment (optional)<textarea className="mt-1 block w-full rounded-md border border-rule p-3" rows={5} maxLength={2000} value={text} onChange={(event) => setText(event.target.value)} placeholder="How was your consultation?" /></label>
        <p className="text-xs text-muted">Reviews are checked by our team before they appear publicly.</p>
        <Button type="submit" disabled={busy}>{busy ? 'Submitting…' : 'Submit review'}</Button>
      </form>
    );
  }

  return <main className="mx-auto max-w-2xl" aria-labelledby="review-heading">
    <Link href="/dashboard/consultations" className="text-sm font-medium text-muted hover:text-ink">← Back to consultations</Link>
    <h1 id="review-heading" className="mt-5 text-2xl font-bold">Leave a review</h1>
    {error && <div className="mt-4"><Notice tone="error">{error}</Notice></div>}
    {reviewContent}
  </main>;
}
