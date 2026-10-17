import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import type { PublicConsultantSlots } from '@biznexa/types';
import { apiOrNull } from '@/lib/api';
import { BookingFlow } from './booking-flow';

type Props = { params: Promise<{ slug: string }> };

async function consultant(slug: string) {
  return apiOrNull<PublicConsultantSlots>(`/public/consultants/${encodeURIComponent(slug)}/slots`);
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const data = await consultant((await params).slug);
  return { title: data ? `Book ${data.consultant.name}` : 'Book a consultation', robots: { index: false } };
}

/** Book a consultation (M8.8): type → date → slot → hold → pay. The slots are fetched fresh in the browser. */
export default async function BookConsultantPage({ params }: Props) {
  const { slug } = await params;
  const data = await consultant(slug);
  if (!data) notFound();
  return (
    <Suspense>
      <BookingFlow slug={slug} initial={data} />
    </Suspense>
  );
}
