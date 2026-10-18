import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/main';
import { PrismaService } from '../src/prisma/prisma.service';
import { staffSession } from './staff';

// Slugs are unique per run, so a parallel or earlier crashed run cannot collide with this one.
const run = randomUUID().slice(0, 8);

describe('Admin Blog Categories API', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let http: ReturnType<typeof request>;
  let session: { accessToken: string };

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(moduleFixture.createNestApplication<NestExpressApplication>());
    await app.init();
    prisma = app.get(PrismaService);
    http = request(app.getHttpServer());

    session = await staffSession(http, prisma, 'ADMIN', 'blog_cat_admin@test.com');
  });

  afterAll(async () => {
    try {
      await prisma.blogCategory.deleteMany({ where: { slug: { startsWith: `test-cat-${run}-` } } });
      await prisma.user.delete({ where: { email: 'blog_cat_admin@test.com' } });
    } finally {
      await app.close();
    }
  });

  it('should list categories', async () => {
    await prisma.blogCategory.create({ data: { slug: `test-cat-${run}-1`, name: 'Test Cat 1' } });

    const res = await http
      .get('/api/admin/blog/categories')
      .set('Authorization', `Bearer ${session.accessToken}`)
      .expect(200);

    expect(res.body).toBeInstanceOf(Array);
    expect(res.body.some((c: { slug: string }) => c.slug === `test-cat-${run}-1`)).toBe(true);
  });

  it('should create a category', async () => {
    const res = await http
      .post('/api/admin/blog/categories')
      .set('Authorization', `Bearer ${session.accessToken}`)
      .send({ slug: `test-cat-${run}-2`, name: 'Test Cat 2' })
      .expect(201);

    expect(res.body.slug).toBe(`test-cat-${run}-2`);

    const logs = await prisma.auditLog.findMany({ where: { entityId: res.body.id } });
    expect(logs).toHaveLength(1);
    expect(logs[0].action).toBe('blog_category.created');
  });

  it('should enforce unique slug on create', async () => {
    await http
      .post('/api/admin/blog/categories')
      .set('Authorization', `Bearer ${session.accessToken}`)
      .send({ slug: `test-cat-${run}-1`, name: 'Another Test Cat' })
      .expect(409);
  });

  it('should update a category', async () => {
    const cat = await prisma.blogCategory.create({ data: { slug: `test-cat-${run}-3`, name: 'Test Cat 3' } });

    const res = await http
      .put(`/api/admin/blog/categories/${cat.id}`)
      .set('Authorization', `Bearer ${session.accessToken}`)
      .send({ name: 'Updated Cat 3' })
      .expect(200);

    expect(res.body.name).toBe('Updated Cat 3');

    const logs = await prisma.auditLog.findMany({ where: { entityId: cat.id, action: 'blog_category.updated' } });
    expect(logs.length).toBeGreaterThan(0);
  });

  it('should enforce unique slug on update', async () => {
    const cat = await prisma.blogCategory.create({ data: { slug: `test-cat-${run}-4`, name: 'Test Cat 4' } });

    await http
      .put(`/api/admin/blog/categories/${cat.id}`)
      .set('Authorization', `Bearer ${session.accessToken}`)
      .send({ slug: `test-cat-${run}-1` })
      .expect(409);
  });

  it('should delete a category', async () => {
    const cat = await prisma.blogCategory.create({ data: { slug: `test-cat-${run}-5`, name: 'Test Cat 5' } });

    await http
      .delete(`/api/admin/blog/categories/${cat.id}`)
      .set('Authorization', `Bearer ${session.accessToken}`)
      .expect(200);

    const check = await prisma.blogCategory.findUnique({ where: { id: cat.id } });
    expect(check).toBeNull();

    const logs = await prisma.auditLog.findMany({ where: { entityId: cat.id, action: 'blog_category.deleted' } });
    expect(logs.length).toBeGreaterThan(0);
  });

  it('should restrict access without permissions', async () => {
    const noPermsSession = await staffSession(http, prisma, 'SUPPORT', 'no_perms@test.com');
    await http
      .get('/api/admin/blog/categories')
      .set('Authorization', `Bearer ${noPermsSession.accessToken}`)
      .expect(403);

    await prisma.user.delete({ where: { email: 'no_perms@test.com' } });
  });
});
