import type { Metadata } from 'next';
import { Suspense } from 'react';
import { RequireAuth } from '@/components/require-auth';
import { ReviewForm } from './review-form';

export const metadata: Metadata = { title: 'Leave a review — BizNexa', robots: { index: false } };

export default async function ReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <Suspense><RequireAuth><ReviewForm bookingId={id} /></RequireAuth></Suspense>;
}
