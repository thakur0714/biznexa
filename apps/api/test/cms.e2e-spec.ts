import { Test } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/main';
import { PrismaService } from '../src/prisma/prisma.service';
import { Prisma } from '../src/generated/prisma/client';
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
    try {
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
      await http.post(`/api/admin/cms/pages/${slug}/unpublish`).set('authorization', `Bearer ${operations}`).expect(403);
      await http.post(`/api/admin/cms/pages/${slug}/publish`).set('authorization', `Bearer ${admin}`).expect(201);
      const published = await http.get(`/api/cms/pages/${slug}`).expect(200);
      expect(published.body.content).toEqual({ html: '<p>Safe</p>' });
      // Saving an edit to a published page leaves the published copy live.
      await http.put('/api/admin/cms/pages').set('authorization', `Bearer ${admin}`).send({
        slug, title: 'About edited', content: { html: '<p>Edited</p>' },
        seoTitle: 'SEO', metaDescription: 'Description', ogImageUrl: null, contactEmail: null, contactPhone: null,
      }).expect(200);
      expect((await http.get(`/api/cms/pages/${slug}`).expect(200)).body).toMatchObject({ title: 'About draft', content: { html: '<p>Safe</p>' } });
      const adminDraft = (await http.get('/api/admin/cms/pages').set('authorization', `Bearer ${admin}`).expect(200)).body.find((row: { slug: string }) => row.slug === slug);
      expect(adminDraft).toMatchObject({ draftTitle: 'About edited', draftContent: { html: '<p>Edited</p>' } });
      await http.post(`/api/admin/cms/pages/${slug}/publish`).set('authorization', `Bearer ${admin}`).expect(201);
      expect((await http.get(`/api/cms/pages/${slug}`).expect(200)).body).toMatchObject({ title: 'About edited', content: { html: '<p>Edited</p>' } });
      await http.put('/api/admin/cms/pages').set('authorization', `Bearer ${admin}`).send({ slug, title: 'About discarded', content: { html: '<p>Discard me</p>' }, seoTitle: null, metaDescription: null, ogImageUrl: null, contactEmail: null, contactPhone: null }).expect(200);
      await http.post(`/api/admin/cms/pages/${slug}/discard-draft`).set('authorization', `Bearer ${admin}`).expect(201);
      expect((await http.get(`/api/cms/pages/${slug}`).expect(200)).body).toMatchObject({ title: 'About edited', content: { html: '<p>Edited</p>' } });
      // A never-published draft still saves directly to its working fields and publishes as before.
      await prisma.cmsPage.update({ where: { slug }, data: { status: 'DRAFT' } });
      await http.put('/api/admin/cms/pages').set('authorization', `Bearer ${admin}`).send({ slug, title: 'Draft page', content: { html: '<p>Draft</p>' }, seoTitle: null, metaDescription: null, ogImageUrl: null, contactEmail: null, contactPhone: null }).expect(200);
      expect(await prisma.cmsPage.findUniqueOrThrow({ where: { slug } })).toMatchObject({ status: 'DRAFT', title: 'Draft page' });
      await http.post(`/api/admin/cms/pages/${slug}/unpublish`).set('authorization', `Bearer ${admin}`).expect(201);
      await http.get(`/api/cms/pages/${slug}`).expect(404);
      expect(await prisma.auditLog.count({ where: { entityType: 'CmsPage', entityId: existing.id, actor: users } })).toBeGreaterThanOrEqual(4);
    } finally {
      await prisma.cmsPage.update({ where: { slug }, data: { title: existing.title, content: structuredClone(existing.content) as object, seoTitle: existing.seoTitle, metaDescription: existing.metaDescription, ogImageUrl: existing.ogImageUrl, contactEmail: existing.contactEmail, contactPhone: existing.contactPhone, status: existing.status, draftTitle: existing.draftTitle, draftContent: existing.draftContent === null ? Prisma.DbNull : (structuredClone(existing.draftContent) as object), draftSeoTitle: existing.draftSeoTitle, draftMetaDescription: existing.draftMetaDescription, draftOgImageUrl: existing.draftOgImageUrl, draftContactEmail: existing.draftContactEmail, draftContactPhone: existing.draftContactPhone } });
    }
  });

  it('starts a new contact page as a private draft and serves SEO and contact details once published', async () => {
    const existingContact = await prisma.cmsPage.findUnique({ where: { slug: 'contact' } });
    const ogImageUrl = '/api/media/ab/0123456789abcdef0123456789abcdef.webp';
    try {
      await prisma.cmsPage.deleteMany({ where: { slug: 'contact' } });
      await http.put('/api/admin/cms/pages').set('authorization', `Bearer ${admin}`).send({
        slug: 'contact',
        title: 'Contact BizNexa',
        content: { html: '<p>Call our team</p><iframe src="https://evil.example"></iframe>' },
        seoTitle: 'Contact Us | BizNexa',
        metaDescription: 'Reach our compliance team.',
        ogImageUrl,
        contactEmail: 'hello@biznexa.com',
        contactPhone: '+91 98765 43210',
      }).expect(200);
      await http.get('/api/cms/pages/contact').expect(404);
      await http.post('/api/admin/cms/pages/contact/publish').set('authorization', `Bearer ${admin}`).expect(201);
      const published = await http.get('/api/cms/pages/contact').expect(200);
      expect(published.body).toMatchObject({
        slug: 'contact',
        title: 'Contact BizNexa',
        content: { html: '<p>Call our team</p>' },
        seoTitle: 'Contact Us | BizNexa',
        metaDescription: 'Reach our compliance team.',
        ogImageUrl,
        contactEmail: 'hello@biznexa.com',
        contactPhone: '+91 98765 43210',
      });
    } finally {
      if (existingContact) {
        await prisma.cmsPage.upsert({
          where: { slug: 'contact' },
          create: { slug: 'contact', title: existingContact.title, content: structuredClone(existingContact.content) as object, seoTitle: existingContact.seoTitle, metaDescription: existingContact.metaDescription, ogImageUrl: existingContact.ogImageUrl, contactEmail: existingContact.contactEmail, contactPhone: existingContact.contactPhone, status: existingContact.status },
          update: { title: existingContact.title, content: structuredClone(existingContact.content) as object, seoTitle: existingContact.seoTitle, metaDescription: existingContact.metaDescription, ogImageUrl: existingContact.ogImageUrl, contactEmail: existingContact.contactEmail, contactPhone: existingContact.contactPhone, status: existingContact.status },
        });
      } else {
        await prisma.cmsPage.deleteMany({ where: { slug: 'contact' } });
      }
    }
  });
});
