import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { FormGallery } from './form-gallery';

export const metadata: Metadata = { title: 'Application forms (dev)', robots: { index: false } };

/** Development-only gallery of every ready-made application form in the customer renderer (M3.6). */
export default function DevFormsPage() {
  if (process.env.NODE_ENV === 'production') notFound();
  return <FormGallery />;
}
