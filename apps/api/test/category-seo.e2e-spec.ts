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
let categoryId: string;
const run = Date.now().toString().slice(-7);
const users = { email: { startsWith: `e2e-catseo-${run}` } };
const slug = `e2e-cat-seo-${run}`;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = configureApp(moduleRef.createNestApplication<NestExpressApplication>());
  await app.init();
  http = request(app.getHttpServer()) as unknown as ReturnType<typeof request>;
  prisma = app.get(PrismaService);
  admin = (await staffSession(http, prisma, 'ADMIN', `e2e-catseo-${run}-admin@example.com`)).accessToken;
  operations = (await staffSession(http, prisma, 'OPERATIONS', `e2e-catseo-${run}-ops@example.com`)).accessToken;
  const created = await http.post('/api/admin/catalogue/categories').set('authorization', `Bearer ${admin}`).send({ slug, name: 'E2E SEO category', sortOrder: 42, isActive: true }).expect(201);
  categoryId = created.body.id;
});

afterAll(async () => {
  await prisma.category.deleteMany({ where: { slug } });
  await prisma.auditLog.deleteMany({ where: { actor: users } });
  await prisma.user.deleteMany({ where: users });
  await app.close();
});

const patch = (body: object, token = admin) => http.patch(`/api/admin/catalogue/categories/${categoryId}`).set('authorization', `Bearer ${token}`).send(body);

describe('Category SEO content and FAQs', () => {
  it('saves sanitised content and FAQs in order, serves them publicly, and leaves other fields alone', async () => {
    const saved = await patch({
      seoContent: '<h2>About these services</h2><p>Everything online.</p><script>alert(1)</script><img src=x onerror=alert(2)>',
      faqs: [
        { question: 'Second question here?', answer: '<p>Two</p>', sortOrder: 1 },
        { question: 'First question here?', answer: '<p>One</p><iframe src="https://evil.example"></iframe>', sortOrder: 0 },
      ],
    }).expect(200);
    expect(saved.body.seoContent).toBe('<h2>About these services</h2><p>Everything online.</p>');
    expect(saved.body.faqs).toEqual([
      { question: 'First question here?', answer: '<p>One</p>', sortOrder: 0 },
      { question: 'Second question here?', answer: '<p>Two</p>', sortOrder: 1 },
    ]);
    // A partial PATCH must not reset fields with defaults.
    expect(saved.body).toMatchObject({ sortOrder: 42, isActive: true, name: 'E2E SEO category' });

    const pub = (await http.get(`/api/catalogue/categories/${slug}`).expect(200)).body;
    expect(pub.seoContent).toBe('<h2>About these services</h2><p>Everything online.</p>');
    expect(pub.faqs.map((f: { question: string }) => f.question)).toEqual(['First question here?', 'Second question here?']);

    expect((await http.get(`/api/admin/catalogue/categories/${categoryId}`).set('authorization', `Bearer ${admin}`).expect(200)).body).toEqual(saved.body);
    const audit = await prisma.auditLog.findFirst({ where: { action: 'category.update', entityId: categoryId, actor: users } });
    expect(audit).not.toBeNull();
  });

  it('replaces FAQs only when they are sent, and clears content with null', async () => {
    await patch({ faqs: [{ question: 'Only question now?', answer: '<p>Yes</p>', sortOrder: 0 }] }).expect(200);
    await patch({ tagline: 'New tagline' }).expect(200);
    let pub = (await http.get(`/api/catalogue/categories/${slug}`).expect(200)).body;
    expect(pub.faqs.map((f: { question: string }) => f.question)).toEqual(['Only question now?']);
    expect(pub.tagline).toBe('New tagline');

    await patch({ seoContent: null, faqs: [] }).expect(200);
    pub = (await http.get(`/api/catalogue/categories/${slug}`).expect(200)).body;
    expect(pub.seoContent).toBeNull();
    expect(pub.faqs).toEqual([]);
  });

  it('refuses bad FAQs and changes nothing', async () => {
    await patch({ faqs: [{ question: 'Kept question?', answer: '<p>Kept</p>', sortOrder: 0 }] }).expect(200);
    await patch({ faqs: [{ question: 'Hi', answer: '<p>Too short a question</p>', sortOrder: 0 }] }).expect(400);
    await patch({ faqs: Array.from({ length: 31 }, (_, i) => ({ question: `Question number ${i}?`, answer: '<p>A</p>', sortOrder: i })) }).expect(400);
    const pub = (await http.get(`/api/catalogue/categories/${slug}`).expect(200)).body;
    expect(pub.faqs.map((f: { question: string }) => f.question)).toEqual(['Kept question?']);
  });

  it('is closed to staff without services.manage', async () => {
    await http.get(`/api/admin/catalogue/categories/${categoryId}`).set('authorization', `Bearer ${operations}`).expect(403);
    await patch({ seoContent: '<p>x</p>' }, operations).expect(403);
    await http.get(`/api/admin/catalogue/categories/${categoryId}`).expect(401);
    await http.get('/api/admin/catalogue/categories/00000000-0000-4000-8000-000000000000').set('authorization', `Bearer ${admin}`).expect(404);
  });
});
