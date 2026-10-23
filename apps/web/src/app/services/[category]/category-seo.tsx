import { Container } from '@biznexa/ui';
import { RichText } from '@/components/rich-text';
import type { CategoryDetail } from '@/lib/api';

/** The category's long SEO copy and FAQs below its services, with FAQPage JSON-LD when there are FAQs. */
export function CategorySeo({ category }: Readonly<{ category: Pick<CategoryDetail, 'seoContent' | 'faqs'> }>) {
  const { seoContent, faqs } = category;
  if (!seoContent && faqs.length === 0) return null;
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faqs.map((f) => ({ '@type': 'Question', name: f.question, acceptedAnswer: { '@type': 'Answer', text: f.answer } })),
  };

  return (
    <section className="border-t border-rule bg-white">
      <Container className="max-w-3xl py-14">
        {seoContent && <RichText html={seoContent} />}
        {faqs.length > 0 && (
          <div className={seoContent ? 'mt-12' : ''}>
            <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replaceAll('<', String.raw`\u003c`) }} />
            <h2 className="text-3xl font-bold tracking-[-0.02em]">Frequently asked questions</h2>
            <div className="mt-5 divide-y divide-rule">
              {faqs.map((item) => (
                <details key={item.question} className="py-4">
                  <summary className="cursor-pointer font-semibold">{item.question}</summary>
                  <RichText html={item.answer} className="mt-3" />
                </details>
              ))}
            </div>
          </div>
        )}
      </Container>
    </section>
  );
}
