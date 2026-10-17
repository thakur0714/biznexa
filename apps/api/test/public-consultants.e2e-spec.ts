import { randomInt, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { Test } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/main';
import { PrismaService } from '../src/prisma/prisma.service';
import { istDate } from '@biznexa/types';

const registerSchema = z.object({ accessToken: z.string() });

describe('Public consultant directory (M8.3)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  const runId = randomUUID();
  const runLanguage = `Lang-${runId.slice(0, 8)}`;
  const userIds: string[] = [];
  const consultantIds: string[] = [];
  const http = () => request(app.getHttpServer());

  async function makeConsultant(label: string, status: 'APPROVED' | 'PENDING' | 'SUSPENDED', options: {
    category: 'CA' | 'CS'; city: string; state: string; area: string | null; feePerSession: number;
    rating: number; experienceYears: number; languages: string[]; consultationTypes: ('AUDIO' | 'VIDEO' | 'CHAT' | 'MEETING')[];
    availableToday?: boolean; marker?: boolean;
  }) {
    const email = `consultant-directory-${runId}-${label}@example.com`;
    await http().post('/api/auth/register').send({
      name: `${label} consultant`, email,
      mobile: `7${randomInt(100_000_000, 1_000_000_000)}`,
      password: 'Customer@12345', consent: true,
    }).expect(201).then((response) => registerSchema.parse(response.body));
    const user = await prisma.user.findUniqueOrThrow({ where: { email }, select: { id: true } });
    userIds.push(user.id);
    const consultant = await prisma.consultant.create({
      data: {
        userId: user.id, slug: `directory-${runId}-${label}`, category: options.category,
        qualification: 'Verified qualification', experienceYears: options.experienceYears,
        // A language only this run uses keeps other suites' approved consultants out of the totals.
        expertise: ['Tax'], languages: options.marker === false ? options.languages : [...options.languages, runLanguage], city: options.city, state: options.state,
        area: options.area, feePerSession: options.feePerSession, consultationTypes: options.consultationTypes,
        rating: options.rating, reviewCount: 10, verificationStatus: status,
        minNoticeMinutes: 0,
        availability: options.availableToday ? { create: [{ weekday: currentIstWeekday(), startTime: '00:00', endTime: '24:00', isBlocked: false }] } : undefined,
      },
      select: { id: true },
    });
    consultantIds.push(consultant.id);
    return consultant.id;
  }

  function currentIstWeekday(): number {
    const weekday = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Kolkata', weekday: 'short' }).format(new Date());
    return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(weekday);
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(moduleRef.createNestApplication<NestExpressApplication>());
    await app.init();
    prisma = app.get(PrismaService);
    await makeConsultant('approved-one', 'APPROVED', {
      category: 'CA', city: 'Pune', state: 'Maharashtra', area: 'Kothrud', feePerSession: 150_000,
      rating: 4.8, experienceYears: 8, languages: ['English', 'Hindi'], consultationTypes: ['AUDIO', 'VIDEO'], availableToday: true,
    });
    await makeConsultant('approved-two', 'APPROVED', {
      category: 'CS', city: 'Delhi', state: 'Delhi', area: null, feePerSession: 75_000,
      rating: 4.2, experienceYears: 4, languages: ['English'], consultationTypes: ['CHAT'],
    });
    await makeConsultant('pending', 'PENDING', {
      category: 'CA', city: 'Pune', state: 'Maharashtra', area: 'Kothrud', feePerSession: 110_000,
      rating: 5, experienceYears: 12, languages: ['Hindi'], consultationTypes: ['VIDEO'], availableToday: true,
    });
    await makeConsultant('suspended', 'SUSPENDED', {
      category: 'CA', city: 'Pune', state: 'Maharashtra', area: 'Kothrud', feePerSession: 100_000,
      rating: 5, experienceYears: 15, languages: ['Hindi'], consultationTypes: ['VIDEO'], availableToday: true,
    });
    const blockedId = await makeConsultant('blocked-today', 'APPROVED', {
      category: 'CA', city: 'Pune', state: 'Maharashtra', area: null, feePerSession: 50_000,
      rating: 3.8, experienceYears: 2, languages: ['Blocked-language'], consultationTypes: ['AUDIO'],
      availableToday: true, marker: false,
    });
    await prisma.availabilitySlot.create({
      data: { consultantId: blockedId, date: new Date(`${istDate(new Date())}T00:00:00Z`), startTime: '00:00', endTime: '24:00', isBlocked: true },
    });
  });

  afterAll(async () => {
    try {
      if (consultantIds.length) await prisma.consultant.deleteMany({ where: { id: { in: consultantIds } } });
      if (userIds.length) await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    } finally {
      await app.close();
    }
  });

  it('is public, exposes only approved consultants, applies filters and availability in IST, and paginates/sorts', async () => {
    const filtered = await http().get('/api/public/consultants?category=CA&state=Maharashtra&city=Pune&area=Kothrud&minRating=4.5&minExperience=5&minFee=100000&maxFee=200000&language=Hindi&consultationType=VIDEO&availableToday=true').expect(200);
    expect(filtered.body.total).toBe(1);
    expect(filtered.body.items[0]).toMatchObject({
      name: 'approved-one consultant', category: 'CA', city: 'Pune', state: 'Maharashtra',
      area: 'Kothrud', feePerSession: 150_000, rating: 4.8, availableToday: true,
    });
    expect(filtered.body.items[0]).not.toHaveProperty('userId');
    expect(filtered.body.items[0]).not.toHaveProperty('email');

    const ascending = await http().get(`/api/public/consultants?sort=fee_low&page=1&limit=1&language=${runLanguage}`).expect(200);
    expect(ascending.body.total).toBe(2);
    expect(ascending.body.items).toHaveLength(1);
    expect(ascending.body.items[0].name).toBe('approved-two consultant');
    const secondPage = await http().get(`/api/public/consultants?sort=fee_low&page=2&limit=1&language=${runLanguage}`).expect(200);
    expect(secondPage.body.items[0].name).toBe('approved-one consultant');

    const descending = await http().get(`/api/public/consultants?sort=fee_high&availableToday=false&language=${runLanguage}`).expect(200);
    expect(descending.body.items.map((item: { name: string }) => item.name)).toEqual(['approved-two consultant']);
    await http().get('/api/public/consultants?minFee=200000&maxFee=100000').expect(400);
  });

  it('excludes fully blocked exceptions from available-today results', async () => {
    const available = await http().get('/api/public/consultants?availableToday=true&language=Blocked-language').expect(200);
    expect(available.body.total).toBe(0);
    const unavailable = await http().get('/api/public/consultants?availableToday=false&language=Blocked-language').expect(200);
    expect(unavailable.body.items[0]).toMatchObject({ name: 'blocked-today consultant', availableToday: false });
  });

  it('serves only approved public profiles and returns a 404 for pending or unknown slugs', async () => {
    const response = await http().get(`/api/public/consultants/directory-${runId}-approved-one`).expect(200);
    expect(response.body).toMatchObject({
      name: 'approved-one consultant', category: 'CA', expertise: ['Tax'], languages: ['English', 'Hindi', runLanguage],
      ratingSummary: { average: 4.8, reviewCount: 10, breakdown: { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 } },
      services: [], verifiedReviews: [],
    });
    expect(response.body).not.toHaveProperty('email');
    await http().get(`/api/public/consultants/directory-${runId}-pending`).expect(404);
    await http().get('/api/public/consultants/no-such-consultant').expect(404);
  });
});
