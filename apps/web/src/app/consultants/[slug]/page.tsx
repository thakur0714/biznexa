import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { api, apiOrNull } from '@/lib/api';
import type { PublicConsultantProfile, PublicConsultantSlots } from '@biznexa/types';
import { ConsultantProfileView } from './profile-view';

type Props = { params: Promise<{ slug: string }> };

async function getProfile(slug: string) {
  return apiOrNull<PublicConsultantProfile>(`/public/consultants/${encodeURIComponent(slug)}`);
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const profile = await getProfile((await params).slug);
  if (!profile) return { title: 'Consultant not found', robots: { index: false } };
  return {
    title: `${profile.name} · ${profile.qualification} | BizNexa`,
    description: profile.bio || `${profile.name}, ${profile.qualification} in ${profile.city}. Book a verified ${profile.category.replaceAll('_', ' ').toLowerCase()} consultation online.`,
    alternates: { canonical: `/consultants/${profile.slug}` },
  };
}

export default async function ConsultantProfilePage({ params }: Props) {
  const { slug } = await params;
  const profile = await getProfile(slug);
  if (!profile) notFound();
  let slots: PublicConsultantSlots | null = null;
  try {
    slots = await api<PublicConsultantSlots>(`/public/consultants/${encodeURIComponent(slug)}/slots`, { revalidate: 0 });
  } catch {
    // Keep the profile available when the booking calendar is temporarily unavailable.
  }
  return <ConsultantProfileView profile={profile} slots={slots} />;
}
