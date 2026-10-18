import { Test } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/main';
import { PrismaService } from '../src/prisma/prisma.service';
import { staffSession } from './staff';

let app: NestExpressApplication;
let http: ReturnType<typeof request>;
let prisma: PrismaService;
let admin: string;
let operations: string;
const run = Date.now().toString().slice(-7);
const users = { email: { startsWith: `e2e-cms-${run}` } };
const slug = 'about';

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = configureApp(moduleRef.createNestApplication<NestExpressApplication>());
  await app.init();
  http = request(app.getHttpServer()) as unknown as ReturnType<typeof request>;
  prisma = app.get(PrismaService);
  admin = (await staffSession(http, prisma, 'ADMIN', `e2e-cms-${run}-admin@example.com`)).accessToken;
  operations = (await staffSession(http, prisma, 'OPERATIONS', `e2e-cms-${run}-ops@example.com`)).accessToken;
});

afterAll(async () => {
  await prisma.auditLog.deleteMany({ where: { actor: users } });
  await prisma.user.deleteMany({ where: users });
  await app.close();
});

describe('CMS page draft and publish', () => {
  it('keeps drafts private, sanitises on save and render, and denies staff without cms.manage', async () => {
        const existing = await prisma.cmsPage.findUniqueOrThrow({ where: { slug } });
    // Start from a draft (the seed publishes About); saving keeps whatever status the page has.
    await prisma.cmsPage.update({ where: { slug }, data: { status: 'DRAFT' } });
    await http.put('/api/admin/cms/pages').set('authorization', `Bearer ${admin}`).send({
      slug, title: 'About draft', content: { html: '<p>Safe</p><script>alert(1)</script><img src=x onerror=alert(2)>' },
      seoTitle: 'SEO', metaDescription: 'Description', ogImageUrl: null, contactEmail: null, contactPhone: null,
    }).expect(200);
    const draft = await prisma.cmsPage.findUniqueOrThrow({ where: { slug } });
    expect(draft.status).toBe('DRAFT');
    expect(draft.content).toEqual({ html: '<p>Safe</p>' });
    await http.get(`/api/cms/pages/${slug}`).expect(404);
    await http.get('/api/admin/cms/pages').set('authorization', `Bearer ${operations}`).expect(403);
    await http.put('/api/admin/cms/pages').set('authorization', `Bearer ${operations}`).send({}).expect(403);
    await http.post(`/api/admin/cms/pages/${slug}/publish`).set('authorization', `Bearer ${operations}`).expect(403);
    await http.post(`/api/admin/cms/pages/${slug}/publish`).set('authorization', `Bearer ${admin}`).expect(201);
    const published = await http.get(`/api/cms/pages/${slug}`).expect(200);
    expect(published.body.content).toEqual({ html: '<p>Safe</p>' });
    // Editing a published page keeps it live with the new text.
    await http.put('/api/admin/cms/pages').set('authorization', `Bearer ${admin}`).send({
      slug, title: 'About edited', content: { html: '<p>Edited</p>' },
      seoTitle: 'SEO', metaDescription: 'Description', ogImageUrl: null, contactEmail: null, contactPhone: null,
    }).expect(200);
    expect((await http.get(`/api/cms/pages/${slug}`).expect(200)).body).toMatchObject({ title: 'About edited', content: { html: '<p>Edited</p>' } });
    await http.post(`/api/admin/cms/pages/${slug}/unpublish`).set('authorization', `Bearer ${admin}`).expect(201);
    await http.get(`/api/cms/pages/${slug}`).expect(404);
    await prisma.cmsPage.update({ where: { slug }, data: { title: existing.title, content: JSON.parse(JSON.stringify(existing.content)) as object, seoTitle: existing.seoTitle, metaDescription: existing.metaDescription, ogImageUrl: existing.ogImageUrl, contactEmail: existing.contactEmail, contactPhone: existing.contactPhone, status: existing.status } });
  });
});
