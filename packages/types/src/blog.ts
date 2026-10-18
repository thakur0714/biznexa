import { z } from 'zod';

export const blogCategorySchema = z.object({
  id: z.string().uuid(),
  slug: z.string().min(1).max(100),
  name: z.string().min(1).max(100),
});

export type BlogCategory = z.infer<typeof blogCategorySchema>;

export const createBlogCategoryInput = blogCategorySchema.omit({ id: true });
export type CreateBlogCategoryInput = z.infer<typeof createBlogCategoryInput>;

export const updateBlogCategoryInput = blogCategorySchema.omit({ id: true }).partial();
export type UpdateBlogCategoryInput = z.infer<typeof updateBlogCategoryInput>;

export const tagSchema = z.object({
  id: z.string().uuid(),
  slug: z.string().min(1).max(100),
  name: z.string().min(1).max(100),
});

export type Tag = z.infer<typeof tagSchema>;

export const createTagInput = tagSchema.omit({ id: true });
export type CreateTagInput = z.infer<typeof createTagInput>;

export const updateTagInput = tagSchema.omit({ id: true }).partial();
export type UpdateTagInput = z.infer<typeof updateTagInput>;
