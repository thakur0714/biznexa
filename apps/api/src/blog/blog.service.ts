import { Injectable, NotFoundException, ConflictException, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../common/auth.decorators';
import { CreateBlogCategoryInput, UpdateBlogCategoryInput, CreateTagInput, UpdateTagInput } from '@biznexa/types';
import { Prisma } from '../generated/prisma/client';
import { QueueService } from '../queue/queue.service';
import type { BlogPostInput } from '@biznexa/types';
import { sanitizeRichText } from '@biznexa/rich-text';

@Injectable()
export class AdminBlogService implements OnModuleInit {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService, private readonly queues: QueueService) {}

  async onModuleInit() {
    this.queues.process<{ postId: string }>('blog-publish', async ({ data }) => { await this.publishScheduled(data.postId); });
    const scheduled = await this.prisma.blogPost.findMany({ where: { status: 'SCHEDULED', publishAt: { not: null } }, select: { id: true, publishAt: true } });
    for (const post of scheduled) await this.enqueue(post.id, post.publishAt!);
  }

  private async enqueue(id: string, at: Date) {
    const queue = this.queues.queue<{ postId: string }>('blog-publish');
    await queue.remove(`blog-publish-${id}`);
    await queue.add('publish', { postId: id }, { jobId: `blog-publish-${id}`, delay: Math.max(0, at.getTime() - Date.now()) });
  }

  private async publishScheduled(id: string) {
    const now = new Date();
    const post = await this.prisma.blogPost.findFirst({ where: { id, status: 'SCHEDULED', publishAt: { lte: now } } });
    if (!post) return;
    const changed = await this.prisma.blogPost.updateMany({ where: { id, status: 'SCHEDULED', publishAt: { lte: now } }, data: { status: 'PUBLISHED', publishedAt: post.publishAt } });
    if (changed.count) await this.audit.log({ action: 'blog_post.published', entityType: 'BlogPost', entityId: id, before: { status: 'SCHEDULED' }, after: { status: 'PUBLISHED', publishedAt: post.publishAt } });
  }

  async listPosts() { return this.prisma.blogPost.findMany({ include: { tags: true, categories: { include: { category: true } } }, orderBy: { updatedAt: 'desc' } }).then(rows => rows.map(({ categories, ...p }) => ({ ...p, categories: categories.map(x => x.category) }))); }

  async createPost(input: BlogPostInput, u: AuthUser) {
    if (input.status === 'SCHEDULED' && !input.publishAt) throw new ConflictException('Scheduled posts require a publish date');
    if (input.status !== 'SCHEDULED' && input.publishAt) throw new ConflictException('Only scheduled posts can have a publish date');
    const content = sanitizeRichText(input.content);
    const post = await this.prisma.blogPost.create({ data: { title: input.title, slug: input.slug, excerpt: input.excerpt, content, featuredImage: input.featuredImage, authorName: input.authorName, categoryId: input.categoryIds[0] ?? null, categories: { create: input.categoryIds.map(categoryId => ({ categoryId })) }, tags: { connect: input.tagIds.map(id => ({ id })) }, seoTitle: input.seoTitle, metaDescription: input.metaDescription, status: input.status, publishAt: input.publishAt ? new Date(input.publishAt) : null, ...(input.status === 'PUBLISHED' ? { publishedAt: new Date() } : {}) }, include: { tags: true, categories: { include: { category: true } } } });
    const { categories, ...result } = post; const response = { ...result, categories: categories.map(x => x.category) };
    await this.audit.log({ actorId: u.id, action: 'blog_post.created', entityType: 'BlogPost', entityId: post.id, after: response });
    if (post.status === 'SCHEDULED') await this.enqueue(post.id, post.publishAt!);
    return response;
  }

  async updatePost(id: string, input: BlogPostInput, u: AuthUser) {
    const before = await this.prisma.blogPost.findUnique({ where: { id }, include: { tags: true, categories: { include: { category: true } } } });
    if (!before) throw new NotFoundException('Blog post not found');
    if (input.status === 'SCHEDULED' && !input.publishAt) throw new ConflictException('Scheduled posts require a publish date');
    if (input.status !== 'SCHEDULED' && input.publishAt) throw new ConflictException('Only scheduled posts can have a publish date');
    const post = await this.prisma.blogPost.update({ where: { id }, data: { title: input.title, slug: input.slug, excerpt: input.excerpt, content: sanitizeRichText(input.content), featuredImage: input.featuredImage, authorName: input.authorName, categoryId: input.categoryIds[0] ?? null, categories: { deleteMany: {}, create: input.categoryIds.map(categoryId => ({ categoryId })) }, tags: { set: input.tagIds.map(tagId => ({ id: tagId })) }, seoTitle: input.seoTitle, metaDescription: input.metaDescription, status: input.status, publishAt: input.publishAt ? new Date(input.publishAt) : null, publishedAt: input.status === 'PUBLISHED' ? (before.status === 'PUBLISHED' ? before.publishedAt : new Date()) : null }, include: { tags: true, categories: { include: { category: true } } } });
    const { categories, ...result } = post; const response = { ...result, categories: categories.map(x => x.category) };
    await this.audit.log({ actorId: u.id, action: 'blog_post.updated', entityType: 'BlogPost', entityId: id, before, after: response });
    if (post.status === 'SCHEDULED') await this.enqueue(id, post.publishAt!);
    else await this.queues.queue('blog-publish').remove(`blog-publish-${id}`);
    return response;
  }

  async deletePost(id: string, u: AuthUser) {
    const before = await this.prisma.blogPost.findUnique({ where: { id } }); if (!before) throw new NotFoundException('Blog post not found');
    await this.prisma.blogPost.delete({ where: { id } });
    await this.queues.queue('blog-publish').remove(`blog-publish-${id}`);
    await this.audit.log({ actorId: u.id, action: 'blog_post.deleted', entityType: 'BlogPost', entityId: id, before, after: null });
  }

  // --- Categories ---

  async listCategories() {
    return this.prisma.blogCategory.findMany({ orderBy: { name: 'asc' } });
  }

  async createCategory(data: CreateBlogCategoryInput, u: AuthUser) {
    try {
      const category = await this.prisma.blogCategory.create({ data });
      await this.audit.log({
        actorId: u.id,
        action: 'blog_category.created',
        entityType: 'BlogCategory',
        entityId: category.id,
        before: null,
        after: category,
      });
      return category;
    } catch (e: unknown) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('A category with this slug already exists');
      }
      throw e;
    }
  }

  async updateCategory(id: string, data: UpdateBlogCategoryInput, u: AuthUser) {
    const existing = await this.prisma.blogCategory.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Blog category not found');

    try {
      const category = await this.prisma.blogCategory.update({
        where: { id },
        data,
      });
      await this.audit.log({
        actorId: u.id,
        action: 'blog_category.updated',
        entityType: 'BlogCategory',
        entityId: category.id,
        before: existing,
        after: category,
      });
      return category;
    } catch (e: unknown) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('A category with this slug already exists');
      }
      throw e;
    }
  }

  async deleteCategory(id: string, u: AuthUser) {
    const existing = await this.prisma.blogCategory.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Blog category not found');

    await this.prisma.blogCategory.delete({ where: { id } });
    await this.audit.log({
      actorId: u.id,
      action: 'blog_category.deleted',
      entityType: 'BlogCategory',
      entityId: id,
      before: existing,
      after: null,
    });
  }

  // --- Tags ---

  async listTags() {
    return this.prisma.tag.findMany({ orderBy: { name: 'asc' } });
  }

  async createTag(data: CreateTagInput, u: AuthUser) {
    try {
      const tag = await this.prisma.tag.create({ data });
      await this.audit.log({
        actorId: u.id,
        action: 'tag.created',
        entityType: 'Tag',
        entityId: tag.id,
        before: null,
        after: tag,
      });
      return tag;
    } catch (e: unknown) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('A tag with this slug already exists');
      }
      throw e;
    }
  }

  async updateTag(id: string, data: UpdateTagInput, u: AuthUser) {
    const existing = await this.prisma.tag.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Tag not found');

    try {
      const tag = await this.prisma.tag.update({
        where: { id },
        data,
      });
      await this.audit.log({
        actorId: u.id,
        action: 'tag.updated',
        entityType: 'Tag',
        entityId: tag.id,
        before: existing,
        after: tag,
      });
      return tag;
    } catch (e: unknown) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('A tag with this slug already exists');
      }
      throw e;
    }
  }

  async deleteTag(id: string, u: AuthUser) {
    const existing = await this.prisma.tag.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Tag not found');

    await this.prisma.tag.delete({ where: { id } });
    await this.audit.log({
      actorId: u.id,
      action: 'tag.deleted',
      entityType: 'Tag',
      entityId: id,
      before: existing,
      after: null,
    });
  }
}
