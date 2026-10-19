import { describe, expect, it } from 'vitest';
import { publicBlogListQuerySchema, publicBlogPagedListSchema, publicBlogPostDetailSchema, publicBlogPostSchema, publicBlogTaxonomySchema } from './blog';

describe('public blog contracts', () => {
  it('coerces paging values and caps page size at 50', () => {
    expect(publicBlogListQuerySchema.parse({ page: '2', pageSize: '50' })).toMatchObject({ page: 2, pageSize: 50 });
    expect(publicBlogListQuerySchema.safeParse({ pageSize: '51' }).success).toBe(false);
  });
  it('validates item, detail, taxonomy and paged response shapes', () => {
    const item = { title: 'Article', slug: 'article', excerpt: null, featuredImage: null, authorName: null, publishedAt: '2026-10-19T00:00:00.000Z', categories: [], tags: [] };
    expect(publicBlogPostSchema.parse(item)).toEqual(item);
    expect(publicBlogPostDetailSchema.parse({ ...item, content: '<p>Safe</p>', seoTitle: null, metaDescription: null })).toMatchObject({ slug: 'article', content: '<p>Safe</p>' });
    expect(publicBlogTaxonomySchema.parse({ id: '123e4567-e89b-42d3-a456-426614174000', slug: 'tax', name: 'Tax', postCount: 1 }).postCount).toBe(1);
    expect(publicBlogPagedListSchema.parse({ items: [item], page: 1, pageSize: 12, total: 1, pages: 1 }).total).toBe(1);
  });
});
