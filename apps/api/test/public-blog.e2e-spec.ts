import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/main';
import { PrismaService } from '../src/prisma/prisma.service';
import { EventBus } from '../src/events/event-bus';

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

  it('caches published post details and invalidates them on blog post changes', async () => {
    const slug = `${prefix}-published-a`;
    await app.get(EventBus).emit('blog.post_changed', { postId: 'warm-cache', slug });
    const findFirst = jest.spyOn(prisma.blogPost, 'findFirst');
    const path = `/api/public/blog/posts/${slug}`;
    const first = await http.get(path).expect(200);
    const second = await http.get(path).expect(200);
    expect(second.body).toEqual(first.body);
    expect(findFirst).toHaveBeenCalledTimes(1);

    const updated = await prisma.blogPost.update({ where: { slug }, data: { title: `Updated ${run}` } });
    await app.get(EventBus).emit('blog.post_changed', { postId: updated.id, slug });
    const refreshed = await http.get(path).expect(200);
    expect(refreshed.body.title).toBe(`Updated ${run}`);
    expect(findFirst).toHaveBeenCalledTimes(2);
    findFirst.mockRestore();
  });

  it('caches blog taxonomy and invalidates it on taxonomy changes', async () => {
    await app.get(EventBus).emit('blog.taxonomy_changed', { entityType: 'category', operation: 'updated' });
    const findMany = jest.spyOn(prisma.blogCategory, 'findMany');
    const first = await http.get('/api/public/blog/categories').expect(200);
    await http.get('/api/public/blog/categories').expect(200);
    expect(findMany).toHaveBeenCalledTimes(1);

    const name = `Renamed ${run}`;
    await prisma.blogCategory.update({ where: { id: categoryId }, data: { name } });
    await app.get(EventBus).emit('blog.taxonomy_changed', { entityType: 'category', operation: 'updated' });
    const refreshed = await http.get('/api/public/blog/categories').expect(200);
    expect(refreshed.body).toContainEqual(expect.objectContaining({ id: categoryId, name }));
    expect(findMany).toHaveBeenCalledTimes(2);
    expect(first.body).not.toContainEqual(expect.objectContaining({ id: categoryId, name }));
    findMany.mockRestore();
  });

  it('searches published posts by typo-tolerant title and tag while hiding drafts and future posts', async () => {
    await prisma.blogPost.createMany({ data: [
      { slug: `${prefix}-search-title`, title: `Zebra Trademark Compliance ${run}`, content: 'Article', status: 'PUBLISHED', publishedAt: new Date(), categoryId },
      { slug: `${prefix}-search-tag`, title: `Zebra Filing Guide ${run}`, content: 'Article', status: 'PUBLISHED', publishedAt: new Date(), categoryId },
      { slug: `${prefix}-search-draft`, title: `Zebra Draft ${run}`, content: 'Article', status: 'DRAFT', categoryId },
      { slug: `${prefix}-search-future`, title: `Zebra Future ${run}`, content: 'Article', status: 'PUBLISHED', publishedAt: new Date(Date.now() + 60_000), categoryId },
    ] });
    const taggedPost = await prisma.blogPost.findUniqueOrThrow({ where: { slug: `${prefix}-search-tag` } });
    await prisma.blogPost.update({ where: { id: taggedPost.id }, data: { tags: { connect: { id: tagId } } } });
    const title = await http.get('/api/catalogue/search').query({ q: 'trademrak complianc' }).expect(200);
    expect(title.body.posts).toContainEqual(expect.objectContaining({ type: 'post', slug: `${prefix}-search-title` }));
    const tag = await http.get('/api/catalogue/search').query({ q: 'tag' }).expect(200);
    expect(tag.body.posts).toContainEqual(expect.objectContaining({ type: 'post', slug: `${prefix}-search-tag` }));
    expect(tag.body.posts.map((post: { slug: string }) => post.slug)).not.toContain(`${prefix}-search-draft`);
    expect(tag.body.posts.map((post: { slug: string }) => post.slug)).not.toContain(`${prefix}-search-future`);
    const mixed = await http.get('/api/catalogue/search').query({ q: 'trademark registration' }).expect(200);
    expect(mixed.body.services[0].type).toBe('service');
    await prisma.blogPost.deleteMany({ where: { slug: { startsWith: `${prefix}-search-` } } });
  });

  it('invalidates the cached search index when a post is published', async () => {
    const slug = `${prefix}-publish-cache`;
    const draft = await prisma.blogPost.create({ data: { slug, title: `CachePublished ${run}`, content: 'Article', status: 'DRAFT' } });
    const before = await http.get('/api/catalogue/search').query({ q: 'cachepublished' }).expect(200);
    expect(before.body.posts).not.toContainEqual(expect.objectContaining({ slug }));
    await prisma.blogPost.update({ where: { id: draft.id }, data: { status: 'PUBLISHED', publishedAt: new Date() } });
    await app.get(EventBus).emit('blog.post_changed', { postId: draft.id, slug: draft.slug });
    const after = await http.get('/api/catalogue/search').query({ q: 'cachepublished' }).expect(200);
    expect(after.body.posts).toContainEqual(expect.objectContaining({ type: 'post', slug }));
    await prisma.blogPost.delete({ where: { id: draft.id } });
  });
});
