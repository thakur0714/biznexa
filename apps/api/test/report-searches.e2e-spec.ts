import { randomInt } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import type { ReportUnansweredSearchItem } from '@biznexa/types';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/main';
import { PrismaService } from '../src/prisma/prisma.service';
import { staffSession } from './staff';

let app: NestExpressApplication;
let http: ReturnType<typeof request>;
let prisma: PrismaService;

let adminToken: string;
let opsToken: string;

const runId = `${Date.now().toString().slice(-6)}${randomInt(100, 999)}`;
const as = (token: string) => ({ authorization: `Bearer ${token}` });
const searchIds: string[] = [];

// Fixture rows sit in a fixed past window so other searches in the database don't mix in.
const day = (d: string, time = '10:00:00') => new Date(`${d}T${time}.000+05:30`);
const fixture = [
  { query: `GST Refund ${runId}`, resultCount: 0, createdAt: day('2001-03-10') },
  { query: `gst refund ${runId}`, resultCount: 0, createdAt: day('2001-03-11', '11:00:00') },
  { query: `GST REFUND ${runId}`, resultCount: 0, createdAt: day('2001-03-12', '18:15:00') },
  { query: `trademark ${runId}`, resultCount: 0, createdAt: day('2001-03-11') },
  // Found results: never listed.
  { query: `gst refund ${runId}`, resultCount: 4, createdAt: day('2001-03-11') },
  // Outside 10–12 March.
  { query: `trademark ${runId}`, resultCount: 0, createdAt: day('2001-03-09') },
  { query: `trademark ${runId}`, resultCount: 0, createdAt: day('2001-03-13') },
];

const ours = (rows: ReportUnansweredSearchItem[]) => rows.filter((r) => r.query.includes(runId));

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = configureApp(moduleRef.createNestApplication<NestExpressApplication>());
  await app.init();
  http = request(app.getHttpServer());
  prisma = app.get(PrismaService);

  adminToken = (await staffSession(http, prisma, 'ADMIN', `admin-srch-${runId}@example.com`)).accessToken;
  opsToken = (await staffSession(http, prisma, 'OPERATIONS', `ops-srch-${runId}@example.com`)).accessToken;

  for (const data of fixture) {
    const row = await prisma.searchQuery.create({ data }); // NOSONAR: test steps run in order
    searchIds.push(row.id);
  }
});

afterAll(async () => {
  if (searchIds.length) await prisma.searchQuery.deleteMany({ where: { id: { in: searchIds } } });
  await app?.close();
});

describe('GET /api/admin/reports/searches', () => {
  it('requires authentication (401) and reports.view (403 for Operations staff)', async () => {
    await http.get('/api/admin/reports/searches').expect(401);
    await http.get('/api/admin/reports/searches').set(as(opsToken)).expect(403);
  });

  it('groups unanswered searches case-insensitively, most searched first, with the latest spelling and time', async () => {
    const res = await http
      .get('/api/admin/reports/searches')
      .query({ from: '2001-03-10', to: '2001-03-12' })
      .set(as(adminToken))
      .expect(200);

    expect(res.body.range).toEqual({
      from: new Date('2001-03-10T00:00:00.000+05:30').toISOString(),
      to: new Date('2001-03-12T23:59:59.999+05:30').toISOString(),
    });
    expect(ours(res.body.searches)).toEqual([
      { query: `GST REFUND ${runId}`, count: 3, lastSearchedAt: day('2001-03-12', '18:15:00').toISOString() },
      { query: `trademark ${runId}`, count: 1, lastSearchedAt: day('2001-03-11').toISOString() },
    ]);
  });

  it('counts only searches inside the date range', async () => {
    const res = await http
      .get('/api/admin/reports/searches')
      .query({ from: '2001-03-09', to: '2001-03-11' })
      .set(as(adminToken))
      .expect(200);

    expect(ours(res.body.searches)).toEqual([
      { query: `gst refund ${runId}`, count: 2, lastSearchedAt: day('2001-03-11', '11:00:00').toISOString() },
      { query: `trademark ${runId}`, count: 2, lastSearchedAt: day('2001-03-11').toISOString() },
    ]);

    const none = await http
      .get('/api/admin/reports/searches')
      .query({ from: '2001-03-14', to: '2001-03-20' })
      .set(as(adminToken))
      .expect(200);
    expect(ours(none.body.searches)).toEqual([]);
  });
});
