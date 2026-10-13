import { configureApp } from '../src/main';
import { INestApplication } from '@nestjs/common';
import * as supertest from 'supertest';
const request = supertest.default || supertest;
import { PrismaService } from '../src/prisma/prisma.service';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module';
import { JwtService } from '@nestjs/jwt';
import { PERMS } from '@biznexa/types';

describe('AuditController (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  let adminId: string;
  let opsId: string;
  let customerId: string;

  const run = Date.now().toString().slice(-7);

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    jwt = app.get(JwtService);

    const users = await prisma.user.createManyAndReturn({
      data: [
        { email: `admin-audit-${run}@test.com`, name: 'Admin', passwordHash: 'hash', consentAt: new Date() },
        { email: `ops-audit-${run}@test.com`, name: 'Ops', passwordHash: 'hash', consentAt: new Date() },
        { email: `customer-audit-${run}@test.com`, name: 'Customer', passwordHash: 'hash', consentAt: new Date() },
      ],
    });
    adminId = users[0].id;
    opsId = users[1].id;
    customerId = users[2].id;

    await prisma.auditLog.createMany({
      data: [
        {
          actorId: adminId,
          action: 'test.action',
          entityType: 'TestEntity',
          entityId: '1',
          before: { secret: 'hidden1', public: 'ok' },
          after: { secret: 'hidden2', public: 'ok2', nested: [{ password: 'pwd', other: 'val' }] },
          createdAt: new Date('2026-10-10T12:00:00Z'),
        },
        {
          actorId: opsId,
          action: 'another.action',
          entityType: 'OtherEntity',
          entityId: '2',
          before: { pan: 'ABCD1234E' },
          after: null,
          createdAt: new Date('2026-10-11T12:00:00Z'),
        }
      ]
    });
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { entityType: { in: ['TestEntity', 'OtherEntity'] } } });
    await prisma.user.deleteMany({ where: { id: { in: [adminId, opsId, customerId] } } });
    await app.close();
  });

  const getAdminToken = () => jwt.sign({ sub: adminId, roles: [], perms: [PERMS.AUDIT_VIEW], typ: 'access', tfa: 'verified' });
  const getOpsToken = () => jwt.sign({ sub: opsId, roles: [], perms: [], typ: 'access', tfa: 'verified' });
  const getCustomerToken = () => jwt.sign({ sub: customerId, roles: [], perms: [], typ: 'access', tfa: 'verified' });

  it('allows access with AUDIT_VIEW and paginates properly', async () => {
    const token = getAdminToken();
    const res = await request(app.getHttpServer())
      .get('/api/admin/audit')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    // It should fetch at least our 2 items, possibly more from other tests
    expect(res.body.items.length).toBeGreaterThanOrEqual(2);
    expect(res.body.total).toBeGreaterThanOrEqual(2);
    expect(res.body.limit).toBe(50);
  });

  it('filters correctly by actorId', async () => {
    const token = getAdminToken();
    const res = await request(app.getHttpServer())
      .get(`/api/admin/audit?actorId=${opsId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].action).toBe('another.action');
    // Ensure N+1 is avoided by returning actor name
    expect(res.body.items[0].actorName).toBe('Ops');
  });

  it('redacts secrets recursively case-insensitive', async () => {
    const token = getAdminToken();
    const res = await request(app.getHttpServer())
      .get(`/api/admin/audit?actorId=${adminId}&entityType=TestEntity`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const log = res.body.items.find((i: any) => i.action === 'test.action');
    expect(log).toBeDefined();
    expect(log.before).toEqual({ secret: '***', public: 'ok' });
    expect(log.after).toEqual({ secret: '***', public: 'ok2', nested: [{ password: '***', other: 'val' }] });
  });

  it('redacts pan correctly', async () => {
    const token = getAdminToken();
    const res = await request(app.getHttpServer())
      .get(`/api/admin/audit?actorId=${opsId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const log = res.body.items.find((i: any) => i.action === 'another.action');
    expect(log.before).toEqual({ pan: '***' });
  });

  it('refuses access without AUDIT_VIEW', async () => {
    await request(app.getHttpServer())
      .get('/api/admin/audit')
      .set('Authorization', `Bearer ${getOpsToken()}`)
      .expect(403);

    await request(app.getHttpServer())
      .get('/api/admin/audit')
      .set('Authorization', `Bearer ${getCustomerToken()}`)
      .expect(403);
  });
});
