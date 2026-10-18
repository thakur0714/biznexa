import { Controller, Get, NotFoundException, Param, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../prisma/prisma.service';
import { Public } from '../common/auth.decorators';
import { sanitizeRichText } from '@biznexa/rich-text';

@ApiTags('blog')
@Public()
@Controller('public/blog/posts')
export class PublicBlogPostsController {
  constructor(private readonly prisma: PrismaService) {}
  @Get() async list(@Query('category') category?: string, @Query('tag') tag?: string) {
    const rows = await this.prisma.blogPost.findMany({ where: { status: 'PUBLISHED', ...(category ? { categories: { some: { category: { slug: category } } } } : {}), ...(tag ? { tags: { some: { slug: tag } } } : {}) }, orderBy: { publishedAt: 'desc' }, select: { title: true, slug: true, excerpt: true, featuredImage: true, authorName: true, publishedAt: true, categories: { include: { category: true } }, tags: true } });
    return rows.map(({ categories, ...p }) => ({ ...p, categories: categories.map(x => x.category) }));
  }
  @Get(':slug') async detail(@Param('slug') slug: string) {
    const post = await this.prisma.blogPost.findFirst({ where: { slug, status: 'PUBLISHED' }, include: { tags: true, categories: { include: { category: true } } } });
    if (!post) throw new NotFoundException('Blog post not found');
    const { categories, ...result } = post;
    return { ...result, content: sanitizeRichText(post.content), categories: categories.map(x => x.category) };
  }
}
