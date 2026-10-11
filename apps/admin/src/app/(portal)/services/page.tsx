import type { Metadata } from 'next';
import { CatalogueView } from './catalogue-view';

export const metadata: Metadata = { title: 'Services' };

export default function ServicesPage() {
  return <CatalogueView />;
}
