import type { Metadata } from 'next';
import { Suspense } from 'react';
import { RequireAuth } from '@/components/require-auth';
import { DocumentsView } from './documents-view';

export const metadata: Metadata = { title: 'Documents', robots: { index: false } };

export default function DocumentsPage() {
  return (
    <Suspense>
      <RequireAuth>
        <DocumentsView />
      </RequireAuth>
    </Suspense>
  );
}
