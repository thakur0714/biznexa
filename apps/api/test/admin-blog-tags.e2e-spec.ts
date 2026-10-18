import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/main';
import { PrismaService } from '../src/prisma/prisma.service';
import { staffSession } from './staff';

describe('Admin Blog Tags API', () => {
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

    session = await staffSession(http, prisma, 'ADMIN', 'blog_tag_admin@test.com');
  });

  afterAll(async () => {
    try {
      await prisma.tag.deleteMany({ where: { slug: { startsWith: 'test-tag-' } } });
      await prisma.user.delete({ where: { email: 'blog_tag_admin@test.com' } });
    } finally {
      await app.close();
    }
  });

  it('should list tags', async () => {
    await prisma.tag.create({ data: { slug: 'test-tag-1', name: 'Test Tag 1' } });

    const res = await http
      .get('/api/admin/blog/tags')
      .set('Authorization', `Bearer ${session.accessToken}`)
      .expect(200);

    expect(res.body).toBeInstanceOf(Array);
    expect(res.body.some((t: { slug: string }) => t.slug === 'test-tag-1')).toBe(true);
  });

  it('should create a tag', async () => {
    const res = await http
      .post('/api/admin/blog/tags')
      .set('Authorization', `Bearer ${session.accessToken}`)
      .send({ slug: 'test-tag-2', name: 'Test Tag 2' })
      .expect(201);

    expect(res.body.slug).toBe('test-tag-2');

    const logs = await prisma.auditLog.findMany({ where: { entityId: res.body.id } });
    expect(logs).toHaveLength(1);
    expect(logs[0].action).toBe('tag.created');
  });

  it('should enforce unique slug on create', async () => {
    await http
      .post('/api/admin/blog/tags')
      .set('Authorization', `Bearer ${session.accessToken}`)
      .send({ slug: 'test-tag-1', name: 'Another Test Tag' })
      .expect(409);
  });

  it('should update a tag', async () => {
    const tag = await prisma.tag.create({ data: { slug: 'test-tag-3', name: 'Test Tag 3' } });

    const res = await http
      .put(`/api/admin/blog/tags/${tag.id}`)
      .set('Authorization', `Bearer ${session.accessToken}`)
      .send({ name: 'Updated Tag 3' })
      .expect(200);

    expect(res.body.name).toBe('Updated Tag 3');

    const logs = await prisma.auditLog.findMany({ where: { entityId: tag.id, action: 'tag.updated' } });
    expect(logs.length).toBeGreaterThan(0);
  });

  it('should enforce unique slug on update', async () => {
    const tag = await prisma.tag.create({ data: { slug: 'test-tag-4', name: 'Test Tag 4' } });

    await http
      .put(`/api/admin/blog/tags/${tag.id}`)
      .set('Authorization', `Bearer ${session.accessToken}`)
      .send({ slug: 'test-tag-1' })
      .expect(409);
  });

  it('should delete a tag', async () => {
    const tag = await prisma.tag.create({ data: { slug: 'test-tag-5', name: 'Test Tag 5' } });

    await http
      .delete(`/api/admin/blog/tags/${tag.id}`)
      .set('Authorization', `Bearer ${session.accessToken}`)
      .expect(200);

    const check = await prisma.tag.findUnique({ where: { id: tag.id } });
    expect(check).toBeNull();

    const logs = await prisma.auditLog.findMany({ where: { entityId: tag.id, action: 'tag.deleted' } });
    expect(logs.length).toBeGreaterThan(0);
  });

  it('should restrict access without permissions', async () => {
    const noPermsSession = await staffSession(http, prisma, 'SUPPORT', 'no_perms_tag@test.com');
    await http
      .get('/api/admin/blog/tags')
      .set('Authorization', `Bearer ${noPermsSession.accessToken}`)
      .expect(403);

    await prisma.user.delete({ where: { email: 'no_perms_tag@test.com' } });
  });
});
