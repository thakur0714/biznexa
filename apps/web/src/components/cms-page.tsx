import { notFound } from 'next/navigation';
import { formatDate } from '@biznexa/types';
import { Container } from '@biznexa/ui';
import { apiOrNull } from '@/lib/api';
import { RichText } from './rich-text';

interface Block {
  type: 'paragraph' | 'heading' | 'list';
  text?: string;
  items?: string[];
}
export interface CmsPageData {
  slug: string;
  title: string;
  /** Seeded pages use blocks; pages saved from the admin editor (M9.5) store sanitised `html`. */
  content: { blocks?: Block[]; html?: string };
  updatedAt: string;
}

export function getCmsPage(slug: string) {
  return apiOrNull<CmsPageData>(`/cms/pages/${slug}`);
}

/** Renders a published CMS page (content managed by Admin). */
export async function CmsPage({ slug }: { slug: string }) {
  const page = await getCmsPage(slug);
  if (!page) notFound();
  return (
    <Container className="max-w-[760px] py-14">
      <h1 className="text-4xl font-bold tracking-[-0.025em]">{page.title}</h1>
      <p className="mt-2 text-sm text-muted">Last updated {formatDate(page.updatedAt)}</p>
      {typeof page.content.html === 'string' ? (
        <RichText html={page.content.html} className="mt-8" />
      ) : (
        <div className="mt-8 space-y-4 text-[17px] leading-relaxed">
          {(page.content.blocks ?? []).map((b, i) =>
            b.type === 'heading' ? (
              <h2 key={i} className="pt-4 text-xl font-semibold">
                {b.text}
              </h2>
            ) : b.type === 'list' ? (
              <ul key={i} className="list-disc space-y-1 pl-6">
                {b.items?.map((it) => <li key={it}>{it}</li>)}
              </ul>
            ) : (
              <p key={i}>{b.text}</p>
            ),
          )}
        </div>
      )}
    </Container>
  );
}
