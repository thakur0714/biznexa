import { Controller, Get, NotFoundException, OnModuleInit, Param } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { Public } from '../common/auth.decorators';
import { ApiZodResponse, ZodQuery } from '../common/openapi';
import { publicBlogListQuerySchema, publicBlogPagedListSchema, publicBlogPostDetailSchema, publicBlogTaxonomySchema, type PublicBlogListQuery } from '@biznexa/types';
import { sanitizeRichText } from '@biznexa/rich-text';
import { EventBus } from '../events/event-bus';

const publishedWhere = (now: Date): Prisma.BlogPostWhereInput => ({ status: 'PUBLISHED', publishedAt: { lte: now } });
const itemSelect = {
  title: true, slug: true, excerpt: true, featuredImage: true, authorName: true, publishedAt: true,
  categories: { select: { category: { select: { id: true, slug: true, name: true } } } },
  tags: { select: { id: true, slug: true, name: true } },
} satisfies Prisma.BlogPostSelect;

@ApiTags('blog')
@Public()
@Controller('public/blog')
export class PublicBlogPostsController implements OnModuleInit {
  private readonly cache = new Map<string, { expiresAt: number; value: Promise<unknown> }>();

  constructor(private readonly prisma: PrismaService, private readonly events: EventBus) {}

  onModuleInit() {
    this.events.on('blog.post_changed', () => this.invalidate());
    this.events.on('blog.taxonomy_changed', () => this.invalidate());
  }

  private async cached<T>(key: string, load: () => Promise<T>): Promise<T> {
    const entry = this.cache.get(key);
    if (entry && entry.expiresAt > Date.now()) return entry.value as Promise<T>;
    if (this.cache.size >= 256) this.cache.clear();
    const pending = load();
    this.cache.set(key, { expiresAt: Date.now() + 300_000, value: pending });
    try {
      const value = await pending;
      if (this.cache.get(key)?.value === pending) this.cache.set(key, { expiresAt: Date.now() + 300_000, value: pending });
      return value;
    } catch (error) {
      if (this.cache.get(key)?.value === pending) this.cache.delete(key);
      throw error;
    }
  }

  private invalidate() {
    this.cache.clear();
  }

  @ApiZodResponse('PublicBlogPagedList', publicBlogPagedListSchema)
  @Get('posts')
  list(@ZodQuery(publicBlogListQuerySchema) query: PublicBlogListQuery) {
    return this.cached(`posts:${JSON.stringify(query)}`, () => this.loadList(query));
  }

  private async loadList(query: PublicBlogListQuery) {
    const now = new Date();
    const category = query.category ? await this.prisma.blogCategory.findUnique({ where: { slug: query.category }, select: { id: true } }) : null;
    const tag = query.tag ? await this.prisma.tag.findUnique({ where: { slug: query.tag }, select: { id: true } }) : null;
    if ((query.category && !category) || (query.tag && !tag)) throw new NotFoundException('Blog category or tag not found');
    const where: Prisma.BlogPostWhereInput = {
      ...publishedWhere(now),
      ...(category ? { categories: { some: { categoryId: category.id } } } : {}),
      ...(tag ? { tags: { some: { id: tag.id } } } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.blogPost.findMany({ where, orderBy: [{ publishedAt: 'desc' }, { slug: 'asc' }], skip: (query.page - 1) * query.pageSize, take: query.pageSize, select: itemSelect }),
      this.prisma.blogPost.count({ where }),
    ]);
    return { items: rows.map(({ categories, ...post }) => ({ ...post, publishedAt: post.publishedAt!.toISOString(), categories: categories.map(({ category: c }) => c) })), page: query.page, pageSize: query.pageSize, total, pages: Math.ceil(total / query.pageSize) };
  }

  @ApiZodResponse('PublicBlogTaxonomyList', publicBlogTaxonomySchema.array())
  @Get('categories')
  categories() {
    return this.cached('categories', () => this.loadCategories());
  }

  private async loadCategories() {
    const now = new Date();
    const rows = await this.prisma.blogCategory.findMany({
      where: { categorizedPosts: { some: { post: publishedWhere(now) } } }, orderBy: { name: 'asc' },
      select: { id: true, slug: true, name: true, _count: { select: { categorizedPosts: { where: { post: publishedWhere(now) } } } } },
    });
    return rows.map(({ _count, ...category }) => ({ ...category, postCount: _count.categorizedPosts }));
  }

  @ApiZodResponse('PublicBlogTagList', publicBlogTaxonomySchema.array())
  @Get('tags')
  tags() {
    return this.cached('tags', () => this.loadTags());
  }

  private async loadTags() {
    const now = new Date();
    const rows = await this.prisma.tag.findMany({
      where: { posts: { some: publishedWhere(now) } }, orderBy: { name: 'asc' },
      select: { id: true, slug: true, name: true, _count: { select: { posts: { where: publishedWhere(now) } } } },
    });
    return rows.map(({ _count, ...tag }) => ({ ...tag, postCount: _count.posts }));
  }

  @ApiZodResponse('PublicBlogPostDetail', publicBlogPostDetailSchema)
  @Get('posts/:slug')
  detail(@Param('slug') slug: string) {
    return this.cached(`post:${slug}`, () => this.loadDetail(slug));
  }

  private async loadDetail(slug: string) {
    const post = await this.prisma.blogPost.findFirst({ where: { slug, ...publishedWhere(new Date()) }, select: { ...itemSelect, content: true, seoTitle: true, metaDescription: true } });
    if (!post) throw new NotFoundException('Blog post not found');
    const { categories, ...result } = post;
    return { ...result, publishedAt: post.publishedAt!.toISOString(), content: sanitizeRichText(post.content), categories: categories.map(({ category }) => category) };
  }
}
