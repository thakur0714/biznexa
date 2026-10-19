import { z } from 'zod';
import { isMediaPath } from './media';

export const blogCategorySchema = z.object({ id: z.string().uuid(), slug: z.string().min(1).max(100), name: z.string().min(1).max(100) });
export type BlogCategory = z.infer<typeof blogCategorySchema>;
export const createBlogCategoryInput = blogCategorySchema.omit({ id: true });
export type CreateBlogCategoryInput = z.infer<typeof createBlogCategoryInput>;
export const updateBlogCategoryInput = blogCategorySchema.omit({ id: true }).partial();
export type UpdateBlogCategoryInput = z.infer<typeof updateBlogCategoryInput>;

export const tagSchema = z.object({ id: z.string().uuid(), slug: z.string().min(1).max(100), name: z.string().min(1).max(100) });
export type Tag = z.infer<typeof tagSchema>;
export const createTagInput = tagSchema.omit({ id: true });
export type CreateTagInput = z.infer<typeof createTagInput>;
export const updateTagInput = tagSchema.omit({ id: true }).partial();
export type UpdateTagInput = z.infer<typeof updateTagInput>;

export const blogPostStatusSchema = z.enum(['DRAFT', 'SCHEDULED', 'PUBLISHED']);
export const blogPostSchema = z.object({
  id: z.string().uuid(), title: z.string(), slug: z.string(), excerpt: z.string().nullable(), content: z.string(), featuredImage: z.string().nullable(),
  authorName: z.string().nullable(), categoryId: z.string().nullable(), categories: z.array(blogCategorySchema).optional(), tags: z.array(tagSchema),
  seoTitle: z.string().nullable(), metaDescription: z.string().nullable(), status: blogPostStatusSchema, publishAt: z.string().datetime().nullable(), publishedAt: z.string().datetime().nullable(), createdAt: z.string().datetime(), updatedAt: z.string().datetime(),
});
export const blogPostInput = z.object({ title: z.string().trim().min(1).max(200), slug: z.string().trim().min(1).max(160).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/), excerpt: z.string().trim().max(500).nullable(), content: z.string().max(100000), featuredImage: z.string().max(500).nullable().refine((url) => url === null || isMediaPath(url), 'Choose an image uploaded to the public media library'), authorName: z.string().trim().max(120).nullable(), categoryIds: z.array(z.string().uuid()).max(20), tagIds: z.array(z.string().uuid()).max(50), seoTitle: z.string().trim().max(160).nullable(), metaDescription: z.string().trim().max(320).nullable(), status: blogPostStatusSchema, publishAt: z.string().datetime().nullable() });
export type BlogPostInput = z.infer<typeof blogPostInput>;

// Public contracts deliberately omit internal/admin fields and share validation with the API.
export const publicBlogPostSchema = z.object({
  title: z.string(), slug: z.string(), excerpt: z.string().nullable(), featuredImage: z.string().nullable(),
  authorName: z.string().nullable(), publishedAt: z.string().datetime(),
  categories: z.array(blogCategorySchema), tags: z.array(tagSchema),
});
export type PublicBlogPost = z.infer<typeof publicBlogPostSchema>;
export const publicBlogPostDetailSchema = publicBlogPostSchema.extend({
  content: z.string(), seoTitle: z.string().nullable(), metaDescription: z.string().nullable(),
});
export type PublicBlogPostDetail = z.infer<typeof publicBlogPostDetailSchema>;
export const blogSearchResultSchema = z.object({ type: z.literal('post'), title: z.string(), slug: z.string(), excerpt: z.string().nullable() });
export const catalogueSearchResponseSchema = z.object({
  services: z.array(z.object({ id: z.string(), slug: z.string(), name: z.string(), shortDescription: z.string(), icon: z.string().nullable(), estimatedTime: z.string().nullable(), startingPrice: z.number().nullable(), governmentFeeFrom: z.number(), popularity: z.number(), isPopular: z.boolean(), category: z.object({ slug: z.string(), name: z.string() }), subcategory: z.object({ slug: z.string(), name: z.string() }).nullable(), type: z.literal('service') })),
  posts: z.array(blogSearchResultSchema),
  categories: z.array(z.object({ slug: z.string(), name: z.string() })),
});
export type BlogSearchResult = z.infer<typeof blogSearchResultSchema>;
export type CatalogueSearchResponse = z.infer<typeof catalogueSearchResponseSchema>;
export const publicBlogTaxonomySchema = z.object({ id: z.string().uuid(), slug: z.string(), name: z.string(), postCount: z.number().int().positive() });
export type PublicBlogTaxonomy = z.infer<typeof publicBlogTaxonomySchema>;
export const publicBlogListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(12),
  category: z.string().trim().min(1).optional(),
  tag: z.string().trim().min(1).optional(),
});
export type PublicBlogListQuery = z.infer<typeof publicBlogListQuerySchema>;
export const publicBlogPagedListSchema = z.object({ items: z.array(publicBlogPostSchema), page: z.number().int(), pageSize: z.number().int(), total: z.number().int(), pages: z.number().int() });
export type PublicBlogPagedList = z.infer<typeof publicBlogPagedListSchema>;
