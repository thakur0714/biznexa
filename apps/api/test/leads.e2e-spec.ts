import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { PrismaClient } from '../src/generated/prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/main';
import { staffSession } from './staff';
import { randomUUID } from 'node:crypto';

describe('Leads API (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaClient;
  let pool: Pool;
  let adminToken: string;
  let customerToken: string;
  const adminEmail = `admin_leads_test_${Date.now()}@example.com`;
  const customerEmail = `cust_leads_test_${Date.now()}@example.com`;
  const customerMobile = `9${Math.floor(Math.random() * 1000000000).toString().padStart(9, '0')}`;

  beforeAll(async () => {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL is not set');
    pool = new Pool({ connectionString: url });
    const adapter = new PrismaPg(pool);
    prisma = new PrismaClient({ adapter });

    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication<NestExpressApplication>();
    configureApp(app);
    await app.init();

    const admin = await staffSession(request(app.getHttpServer()), prisma as any, 'ADMIN', adminEmail);
    adminToken = admin.accessToken;

    const customerRes = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({
        name: 'Test Customer',
        email: customerEmail,
        mobile: customerMobile,
        password: 'Password1',
        consent: true,
      })
      .expect(201);
    customerToken = customerRes.body.accessToken;
  });

  afterAll(async () => {
    try {
      await prisma.lead.deleteMany({
        where: { name: { startsWith: 'LeadTest_' } }
      });
      await prisma.user.deleteMany({
        where: { email: { in: [adminEmail, customerEmail] } }
      });
    } finally {
      await app.close();
      await prisma.$disconnect();
    }
  });

  it('allows public to create a lead', async () => {
    await request(app.getHttpServer())
      .post('/api/leads')
      .send({
        name: 'LeadTest_John',
        mobile: '9876543212',
        email: 'lead_john@example.com',
        message: 'Hello',
        source: 'contact',
      })
      .expect(201);
  });

  it('rejects unauthorized users from viewing leads', async () => {
    await request(app.getHttpServer())
      .get('/api/admin/leads')
      .set('Authorization', `Bearer ${customerToken}`)
      .expect(403);
  });

  it('allows admin with leads.view to list and filter leads', async () => {
    const service = await prisma.service.create({
      data: {
        id: randomUUID(),
        name: 'LeadTest_Service',
        slug: 'leadtest-service',
        shortDescription: 'desc',
        categoryId: (await prisma.category.findFirst())?.id || 'dummy',
        isActive: true,
      }
    });

    await prisma.lead.create({
      data: {
        name: 'LeadTest_Jane',
        mobile: '9876543213',
        source: 'service_page',
        serviceId: service.id,
      }
    });

    const res = await request(app.getHttpServer())
      .get('/api/admin/leads?source=service_page&q=LeadTest_Jane')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(res.body.items).toBeDefined();
    expect(res.body.items.length).toBeGreaterThan(0);
    expect(res.body.items[0].name).toBe('LeadTest_Jane');
    expect(res.body.items[0].serviceName).toBe('LeadTest_Service');
    expect(res.body.items[0].source).toBe('service_page');

    await prisma.service.delete({ where: { id: service.id } });
  });
});
