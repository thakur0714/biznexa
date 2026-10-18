import type { Metadata } from 'next';
import { Suspense } from 'react';
import { RequireAuth } from '@/components/require-auth';
import { ConsultationsView } from './consultations-view';

export const metadata: Metadata = { title: 'My Consultations — BizNexa', robots: { index: false } };

export default function ConsultationsPage() {
  return <Suspense><RequireAuth><ConsultationsView /></RequireAuth></Suspense>;
}
