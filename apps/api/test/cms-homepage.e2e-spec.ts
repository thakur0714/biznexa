import { Test } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/main';
import { PrismaService } from '../src/prisma/prisma.service';
import { EventBus } from '../src/events/event-bus';
import { staffSession } from './staff';

let app: NestExpressApplication;
let http: ReturnType<typeof request>;
let prisma: PrismaService;
let admin: string;
let operations: string;
const run = Date.now().toString().slice(-7);
const users = { email: { startsWith: `e2e-home-${run}` } };

// The homepage content is shared: what was there before the test is put back afterwards.
let saved: {
  banners: Awaited<ReturnType<PrismaService['banner']['findMany']>>;
  testimonials: Awaited<ReturnType<PrismaService['testimonial']['findMany']>>;
  setting: { value: unknown } | null;
};

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = configureApp(moduleRef.createNestApplication<NestExpressApplication>());
  await app.init();
  http = request(app.getHttpServer()) as unknown as ReturnType<typeof request>;
  prisma = app.get(PrismaService);
  admin = (await staffSession(http, prisma, 'ADMIN', `e2e-home-${run}-admin@example.com`)).accessToken;
  operations = (await staffSession(http, prisma, 'OPERATIONS', `e2e-home-${run}-ops@example.com`)).accessToken;
  saved = {
    banners: await prisma.banner.findMany({ where: { placement: 'home' } }),
    testimonials: await prisma.testimonial.findMany(),
    setting: await prisma.setting.findUnique({ where: { key: 'home.cms' }, select: { value: true } }),
  };
});

afterAll(async () => {
  await prisma.banner.deleteMany({ where: { placement: 'home' } });
  if (saved.banners.length) await prisma.banner.createMany({ data: saved.banners });
  await prisma.testimonial.deleteMany({});
  if (saved.testimonials.length) await prisma.testimonial.createMany({ data: saved.testimonials });
  if (saved.setting) await prisma.setting.update({ where: { key: 'home.cms' }, data: { value: saved.setting.value as object } });
  else await prisma.setting.deleteMany({ where: { key: 'home.cms' } });
  await prisma.auditLog.deleteMany({ where: { actor: users } });
  await prisma.user.deleteMany({ where: users });
  await app.close();
});

const put = (body: unknown, token = admin) => http.put('/api/admin/cms/homepage').set('authorization', `Bearer ${token}`).send(body as object);

function content(popularServiceIds: string[]) {
  return {
    banners: [
      { title: 'Second banner', subtitle: null, imageUrl: null, linkUrl: '/consultants', sortOrder: 1, isActive: true },
      { title: 'Hidden banner', subtitle: 'Switched off', imageUrl: null, linkUrl: null, sortOrder: 2, isActive: false },
      { title: 'First banner', subtitle: 'Festive offer', imageUrl: '/api/media/ab/0123456789abcdef0123456789abcdef.webp', linkUrl: '/services', sortOrder: 0, isActive: true },
    ],
    testimonials: [
      { name: 'Asha', company: 'Asha Foods', quote: 'Quick and clear.', rating: 5, sortOrder: 0, isActive: true },
      { name: 'Hidden', company: null, quote: 'Not shown.', rating: 3, sortOrder: 1, isActive: false },
    ],
    stats: [
      { label: 'Customers', value: '5,000+', sortOrder: 1, isActive: true },
      { label: 'Hidden counter', value: '0', sortOrder: 2, isActive: false },
      { label: 'Services', value: '80+', sortOrder: 0, isActive: true },
    ],
    popularServiceIds,
    faq: [
      { question: 'Second question?', answer: '<p>Two</p>', sortOrder: 1, isActive: true },
      { question: 'First question?', answer: '<p>One</p><script>alert(1)</script><img src=x onerror=alert(2)>', sortOrder: 0, isActive: true },
      { question: 'Hidden question?', answer: '<p>Hidden</p>', sortOrder: 2, isActive: false },
    ],
  };
}

describe('Homepage CMS (M9.6)', () => {
  it('shows only active content, in order, with FAQ answers sanitised, and the picked services as popular', async () => {
    const services = await prisma.service.findMany({ where: { isActive: true, deletedAt: null }, orderBy: { name: 'asc' }, take: 3, select: { id: true, slug: true } });
    const picked = [services[2].id, services[0].id];
    await put(content(picked)).expect(200);

    const home = (await http.get('/api/cms/homepage').expect(200)).body;
    expect(home.banners.map((b: { title: string }) => b.title)).toEqual(['First banner', 'Second banner']);
    expect(home.testimonials.map((t: { name: string }) => t.name)).toEqual(['Asha']);
    expect(home.stats.map((s: { label: string }) => s.label)).toEqual(['Services', 'Customers']);
    expect(home.faq.map((f: { question: string }) => f.question)).toEqual(['First question?', 'Second question?']);
    expect(home.faq[0].answer).toBe('<p>One</p>');
    expect(home.popularServices.map((s: { id: string }) => s.id)).toEqual(picked);
    // The website's popular services section follows the same pick, in the admin's order.
    const popular = (await http.get('/api/catalogue/popular').expect(200)).body;
    expect(popular.map((s: { id: string }) => s.id)).toEqual(picked);

    // The admin sees everything, including switched-off rows, to edit them again.
    const edit = (await http.get('/api/admin/cms/homepage').set('authorization', `Bearer ${admin}`).expect(200)).body;
    expect(edit.banners).toHaveLength(3);
    expect(edit.testimonials).toHaveLength(2);
    expect(edit.stats).toHaveLength(3);
    expect(edit.faq).toHaveLength(3);
    expect(edit.popularServiceIds).toEqual(picked);

    const audit = await prisma.auditLog.findFirst({ where: { action: 'cms.homepage.update', actor: users }, orderBy: { createdAt: 'desc' } });
    expect(audit?.entityType).toBe('CmsHomepage');
  });

  it('falls back to the catalogue’s popular services when no picked service is still active', async () => {
    const service = await prisma.service.findFirstOrThrow({ where: { isActive: true, deletedAt: null }, select: { id: true } });
    await put(content([service.id])).expect(200);
    try {
      await prisma.service.update({ where: { id: service.id }, data: { isActive: false } });
      // The catalogue editor emits this when it switches a service off; it drops the cached popular list.
      await app.get(EventBus).emit('catalogue.changed', { entityType: 'service' });
      const popular = (await http.get('/api/catalogue/popular').expect(200)).body as { id: string }[];
      expect(popular.length).toBeGreaterThan(0);
      expect(popular.map((s) => s.id)).not.toContain(service.id);
      expect((await http.get('/api/cms/homepage').expect(200)).body.popularServices).toEqual([]);
    } finally {
      await prisma.service.update({ where: { id: service.id }, data: { isActive: true } });
    }
  });

  it('refuses bad content and leaves the homepage unchanged', async () => {
    const [a, b] = await prisma.service.findMany({ where: { isActive: true, deletedAt: null }, take: 2, select: { id: true } });
    await put(content([a.id])).expect(200);
    const before = (await http.get('/api/admin/cms/homepage').set('authorization', `Bearer ${admin}`).expect(200)).body;

    const bad = [
      { ...content([a.id]), banners: [{ ...content([]).banners[0], imageUrl: 'https://evil.example/x.png' }] },
      { ...content([a.id]), banners: [{ ...content([]).banners[0], linkUrl: 'javascript:alert(1)' }] },
      { ...content([a.id]), testimonials: [{ ...content([]).testimonials[0], rating: 6 }] },
      { ...content([a.id]), stats: [{ label: '', value: '1', sortOrder: 0, isActive: true }] },
    ];
    for (const body of bad) await put(body).expect(400);
    await put(content([a.id, a.id])).expect(400);
    await put(content([a.id, b.id, '00000000-0000-4000-8000-000000000000'])).expect(404);
    await put(content(Array.from({ length: 9 }, () => a.id))).expect(400);

    const after = (await http.get('/api/admin/cms/homepage').set('authorization', `Bearer ${admin}`).expect(200)).body;
    expect(after).toEqual(before);
  });

  it('denies staff without cms.manage and visitors', async () => {
    await http.get('/api/admin/cms/homepage').set('authorization', `Bearer ${operations}`).expect(403);
    await http.get('/api/admin/cms/homepage/services').set('authorization', `Bearer ${operations}`).expect(403);
    await put(content([]), operations).expect(403);
    await http.get('/api/admin/cms/homepage').expect(401);
    await http.put('/api/admin/cms/homepage').send(content([])).expect(401);
  });

  it('lists only active catalogue services to pick from', async () => {
    const list = (await http.get('/api/admin/cms/homepage/services').set('authorization', `Bearer ${admin}`).expect(200)).body as { id: string }[];
    const inactive = await prisma.service.findMany({ where: { OR: [{ isActive: false }, { deletedAt: { not: null } }] }, select: { id: true } });
    const ids = new Set(list.map((s) => s.id));
    expect(list.length).toBeGreaterThan(0);
    for (const s of inactive) expect(ids.has(s.id)).toBe(false);
  });
});
