import { NAV } from '@/lib/nav';
import { SectionView } from './section-view';

// Only known sections exist; any other URL is a real 404 (not a 200 page that 404s in the browser).
export const dynamicParams = false;

export function generateStaticParams() {
  return NAV.flatMap((g) => g.items)
    .filter((i) => i.slug !== '' && !i.built)
    .map((i) => ({ section: i.slug }));
}

export default async function SectionPage({ params }: { params: Promise<{ section: string }> }) {
  const { section } = await params;
  return <SectionView slug={section} />;
}
