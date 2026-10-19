import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/main';
import { PrismaService } from '../src/prisma/prisma.service';
import { staffSession } from './staff';

// Slugs and the admin email are unique per run, so a parallel or earlier crashed run cannot collide.
const run = randomUUID().slice(0, 8);
const email = `e2e-blog-posts-${run}@example.com`;

describe('Admin blog posts and scheduled publish', () => {
  let app: INestApplication; let prisma: PrismaService; let http: ReturnType<typeof request>;
  let session: { accessToken: string }; let categoryId: string; let tagId: string;
  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(module.createNestApplication<NestExpressApplication>()); await app.init();
    prisma = app.get(PrismaService); http = request(app.getHttpServer());
    session = await staffSession(http, prisma, 'ADMIN', email);
    const cat = await prisma.blogCategory.create({ data: { slug: `test-post-${run}-cat`, name: 'Post Cat' } }); categoryId = cat.id;
    const tag = await prisma.tag.create({ data: { slug: `test-post-${run}-tag`, name: 'Post Tag' } }); tagId = tag.id;
  });
  afterAll(async () => { await prisma.blogPost.deleteMany({ where: { slug: { startsWith: `test-post-${run}-` } } }); await prisma.blogCategory.deleteMany({ where: { slug: `test-post-${run}-cat` } }); await prisma.tag.deleteMany({ where: { slug: `test-post-${run}-tag` } }); await prisma.user.delete({ where: { email } }); await app.close(); });
  const base = (slug: string, status: 'DRAFT'|'SCHEDULED'|'PUBLISHED' = 'DRAFT') => ({ title: 'Test post', slug, excerpt: 'Excerpt', content: '<p>Safe <strong>body</strong><script>alert(1)</script></p><img src=x onerror=alert(1)>', featuredImage: null, authorName: 'Writer', categoryIds: [categoryId], tagIds: [tagId], seoTitle: 'SEO', metaDescription: 'Meta', status, publishAt: status === 'SCHEDULED' ? new Date(Date.now() + 2500).toISOString() : null });
  const auth = () => ({ Authorization: `Bearer ${session.accessToken}` });
  it('stores rich text after stripping XSS and keeps drafts private', async () => {
    const res = await http.post('/api/admin/blog/posts').set(auth()).send(base(`test-post-${run}-draft`)).expect(201);
    expect(res.body.content).not.toMatch(/script|onerror/i); expect(res.body.content).toContain('<strong>body</strong>');
    await http.get(`/api/public/blog/posts/test-post-${run}-draft`).expect(404);
    expect((await http.get('/api/public/blog/posts')).body.items.some((p: { slug: string }) => p.slug === `test-post-${run}-draft`)).toBe(false);
    expect(await prisma.auditLog.count({ where: { entityId: res.body.id, action: 'blog_post.created' } })).toBe(1);
    await http.post('/api/admin/blog/posts').set(auth()).send(base(`test-post-${run}-draft`)).expect(409);
  });
  it('keeps scheduled posts private until the queue publishes them', async () => {
    const res = await http.post('/api/admin/blog/posts').set(auth()).send(base(`test-post-${run}-scheduled`,'SCHEDULED')).expect(201);
    await http.get(`/api/public/blog/posts/test-post-${run}-scheduled`).expect(404);
    await new Promise(resolve => setTimeout(resolve, 3500));
    const published = await prisma.blogPost.findUnique({ where: { id: res.body.id } });
    expect(published?.status).toBe('PUBLISHED'); expect(published?.publishedAt).not.toBeNull();
    await http.get(`/api/public/blog/posts/test-post-${run}-scheduled`).expect(200);
  });
  it('requires cms.manage on every admin route', async () => {
    const noPerms = await staffSession(http, prisma, 'SUPPORT', `e2e-blog-posts-${run}-support@example.com`);
    await http.get('/api/admin/blog/posts').set({ Authorization: `Bearer ${noPerms.accessToken}` }).expect(403);
    await http.post('/api/admin/blog/posts').set({ Authorization: `Bearer ${noPerms.accessToken}` }).send(base(`test-post-${run}-denied`)).expect(403);
    await prisma.user.delete({ where: { email: `e2e-blog-posts-${run}-support@example.com` } });
  });
});
