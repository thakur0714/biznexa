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
  seoTitle?: string | null;
  metaDescription?: string | null;
  ogImageUrl?: string | null;
  updatedAt: string;
}

export function getCmsPage(slug: string) {
  return apiOrNull<CmsPageData>(`/cms/pages/${slug}`);
}

export async function cmsMetadata(slug: string) {
  const page = await getCmsPage(slug);
  return { title: page?.seoTitle || page?.title || 'BizNexa', ...(page?.metaDescription ? { description: page.metaDescription } : {}), ...(page?.ogImageUrl ? { openGraph: { images: [page.ogImageUrl] } } : {}) };
}

function renderBlock(b: Block, key: string) {
  if (b.type === 'heading') {
    return (
      <h2 key={key} className="pt-4 text-xl font-semibold">
        {b.text}
      </h2>
    );
  }
  if (b.type === 'list') {
    return (
      <ul key={key} className="list-disc space-y-1 pl-6">
        {b.items?.map((it) => <li key={it}>{it}</li>)}
      </ul>
    );
  }
  return <p key={key}>{b.text}</p>;
}

function keyedBlocks(blocks: Block[]) {
  const seen = new Map<string, number>();
  return blocks.map((b) => {
    const raw = b.text ?? b.items?.join('|') ?? b.type;
    const count = (seen.get(raw) ?? 0) + 1;
    seen.set(raw, count);
    const key = count === 1 ? raw : `${raw}#${count}`;
    return { block: b, key };
  });
}

/** Renders a published CMS page (content managed by Admin). */
export async function CmsPage({ slug }: Readonly<{ slug: string }>) {
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
          {keyedBlocks(page.content.blocks ?? []).map(({ block, key }) => renderBlock(block, key))}
        </div>
      )}
    </Container>
  );
}
