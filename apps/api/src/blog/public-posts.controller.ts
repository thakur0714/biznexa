import { Controller, Get, NotFoundException, Param, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { Public } from '../common/auth.decorators';
import { ApiZodResponse, ZodQuery } from '../common/openapi';
import { publicBlogListQuerySchema, publicBlogPagedListSchema, publicBlogPostDetailSchema, publicBlogTaxonomySchema, type PublicBlogListQuery } from '@biznexa/types';
import { sanitizeRichText } from '@biznexa/rich-text';

const publishedWhere = (now: Date): Prisma.BlogPostWhereInput => ({ status: 'PUBLISHED', publishedAt: { lte: now } });
const itemSelect = {
  title: true, slug: true, excerpt: true, featuredImage: true, authorName: true, publishedAt: true,
  categories: { select: { category: { select: { id: true, slug: true, name: true } } } },
  tags: { select: { id: true, slug: true, name: true } },
} satisfies Prisma.BlogPostSelect;

@ApiTags('blog')
@Public()
@Controller('public/blog')
export class PublicBlogPostsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('posts')
  @ApiZodResponse('PublicBlogPagedList', publicBlogPagedListSchema)
  async list(@ZodQuery(publicBlogListQuerySchema) query: PublicBlogListQuery) {
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

  @Get('categories')
  @ApiZodResponse('PublicBlogTaxonomyList', publicBlogTaxonomySchema.array())
  async categories() {
    const now = new Date();
    const rows = await this.prisma.blogCategory.findMany({
      where: { categorizedPosts: { some: { post: publishedWhere(now) } } }, orderBy: { name: 'asc' },
      select: { id: true, slug: true, name: true, _count: { select: { categorizedPosts: { where: { post: publishedWhere(now) } } } } },
    });
    return rows.map(({ _count, ...category }) => ({ ...category, postCount: _count.categorizedPosts }));
  }

  @Get('tags')
  @ApiZodResponse('PublicBlogTagList', publicBlogTaxonomySchema.array())
  async tags() {
    const now = new Date();
    const rows = await this.prisma.tag.findMany({
      where: { posts: { some: publishedWhere(now) } }, orderBy: { name: 'asc' },
      select: { id: true, slug: true, name: true, _count: { select: { posts: { where: publishedWhere(now) } } } },
    });
    return rows.map(({ _count, ...tag }) => ({ ...tag, postCount: _count.posts }));
  }

  @Get('posts/:slug')
  @ApiZodResponse('PublicBlogPostDetail', publicBlogPostDetailSchema)
  async detail(@Param('slug') slug: string) {
    const post = await this.prisma.blogPost.findFirst({ where: { slug, ...publishedWhere(new Date()) }, select: { ...itemSelect, content: true, seoTitle: true, metaDescription: true } });
    if (!post) throw new NotFoundException('Blog post not found');
    const { categories, ...result } = post;
    return { ...result, publishedAt: post.publishedAt!.toISOString(), content: sanitizeRichText(post.content), categories: categories.map(({ category }) => category) };
  }
}
