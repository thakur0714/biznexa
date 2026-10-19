import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/main';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Public blog pages API', () => {
  const run = randomUUID().slice(0, 10);
  let app: INestApplication;
  let prisma: PrismaService;
  let http: ReturnType<typeof request>;
  let categoryId: string;
  let tagId: string;
  const prefix = `public-blog-${run}`;

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(module.createNestApplication<NestExpressApplication>());
    await app.init();
    prisma = app.get(PrismaService);
    http = request(app.getHttpServer());
    const category = await prisma.blogCategory.create({ data: { slug: `${prefix}-category`, name: `Category ${run}` } });
    const tag = await prisma.tag.create({ data: { slug: `${prefix}-tag`, name: `Tag ${run}` } });
    categoryId = category.id;
    tagId = tag.id;
    await prisma.blogPost.createMany({ data: [
      { slug: `${prefix}-published-a`, title: `Published A ${run}`, content: '<p>Visible <script>bad()</script></p>', status: 'PUBLISHED', publishedAt: new Date(Date.now() - 60_000), categoryId, authorName: 'Writer' },
      { slug: `${prefix}-published-b`, title: `Published B ${run}`, content: '<p>Other visible</p>', status: 'PUBLISHED', publishedAt: new Date(Date.now() - 30_000), categoryId },
      { slug: `${prefix}-future`, title: `Future ${run}`, content: '<p>Future</p>', status: 'PUBLISHED', publishedAt: new Date(Date.now() + 60_000), categoryId },
      { slug: `${prefix}-draft`, title: `Draft ${run}`, content: '<p>Draft</p>', status: 'DRAFT', publishedAt: null, categoryId },
    ] });
    const postIds = await prisma.blogPost.findMany({ where: { slug: { startsWith: prefix } }, select: { id: true } });
    await prisma.blogPostCategory.createMany({ data: postIds.map(({ id }) => ({ postId: id, categoryId })) });
    await prisma.blogPost.update({ where: { slug: `${prefix}-published-a` }, data: { tags: { connect: { id: tagId } } } });
  });

  afterAll(async () => {
    await prisma.blogPost.deleteMany({ where: { slug: { startsWith: prefix } } });
    await prisma.blogCategory.deleteMany({ where: { id: categoryId } });
    await prisma.tag.deleteMany({ where: { id: tagId } });
    await app.close();
  });

  it('only returns currently published posts, with typed paged results', async () => {
    const response = await http.get('/api/public/blog/posts').query({ page: 1, pageSize: 50 }).expect(200);
    const slugs = response.body.items.map((post: { slug: string }) => post.slug);
    expect(slugs).toContain(`${prefix}-published-a`);
    expect(slugs).toContain(`${prefix}-published-b`);
    expect(slugs).not.toContain(`${prefix}-future`);
    expect(slugs).not.toContain(`${prefix}-draft`);
    expect(response.body).toMatchObject({ page: 1, pageSize: 50, total: expect.any(Number), pages: expect.any(Number) });
  });

  it('filters and pages results and lists only taxonomies with visible post counts', async () => {
    const first = await http.get('/api/public/blog/posts').query({ category: `${prefix}-category`, page: 1, pageSize: 1 }).expect(200);
    expect(first.body).toMatchObject({ page: 1, pageSize: 1, total: 2, pages: 2 });
    expect(first.body.items).toHaveLength(1);
    const second = await http.get('/api/public/blog/posts').query({ category: `${prefix}-category`, page: 2, pageSize: 1 }).expect(200);
    expect(second.body.items).toHaveLength(1);
    const tagged = await http.get('/api/public/blog/posts').query({ tag: `${prefix}-tag` }).expect(200);
    expect(tagged.body.total).toBe(1);
    expect((await http.get('/api/public/blog/categories').expect(200)).body).toContainEqual(expect.objectContaining({ id: categoryId, postCount: 2 }));
    expect((await http.get('/api/public/blog/tags').expect(200)).body).toContainEqual(expect.objectContaining({ id: tagId, postCount: 1 }));
    await http.get('/api/public/blog/posts').query({ pageSize: 51 }).expect(400);
  });

  it('returns 404 for unknown taxonomy slugs and hides future/draft details', async () => {
    await http.get('/api/public/blog/posts').query({ category: 'missing-blog-category' }).expect(404);
    await http.get('/api/public/blog/posts').query({ tag: 'missing-blog-tag' }).expect(404);
    await http.get(`/api/public/blog/posts/${prefix}-future`).expect(404);
    await http.get(`/api/public/blog/posts/${prefix}-draft`).expect(404);
    const detail = await http.get(`/api/public/blog/posts/${prefix}-published-a`).expect(200);
    expect(detail.body.content).not.toMatch(/script|bad\(\)/i);
    expect(detail.body.categories).toEqual([expect.objectContaining({ id: categoryId })]);
  });
});
