import { Test } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/main';
import { PrismaService } from '../src/prisma/prisma.service';
import { createStaff, staffSession } from './staff';
import { timeStep, totpCode } from '../src/auth/totp';

let app: NestExpressApplication;
let http: ReturnType<typeof request>;
let prisma: PrismaService;
let adminToken: string;
let supportToken: string;
let opsToken: string;
let adminId: string;
let targetId: string;
let targetRefresh: string;
let targetTotpSecret: string;
const run = `${Date.now().toString().slice(-6)}${Math.floor(Math.random() * 10)}`;
const email = (key: string) => `e2e-staff-${run}-${key}@example.com`;
const as = (token: string) => ({ authorization: `Bearer ${token}` });

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = configureApp(moduleRef.createNestApplication<NestExpressApplication>());
  await app.init();
  http = request(app.getHttpServer()) as unknown as ReturnType<typeof request>;
  prisma = app.get(PrismaService);
  adminToken = (await staffSession(http, prisma, 'ADMIN', email('admin'))).accessToken;
  supportToken = (await staffSession(http, prisma, 'SUPPORT', email('support'))).accessToken;
  opsToken = (await staffSession(http, prisma, 'OPERATIONS', email('ops'))).accessToken;
  adminId = await prisma.user.findUniqueOrThrow({ where: { email: email('admin') } }).then((u) => u.id);
  targetId = await createStaff(prisma, 'OPERATIONS', email('target'));
  const login = await http.post('/api/auth/login').send({ email: email('target'), password: 'Staff@12345' }).expect(200);
  const setup = await http.post('/api/auth/2fa/setup').set(as(login.body.accessToken)).expect(200);
  targetTotpSecret = setup.body.secret;
  const enabled = await http.post('/api/auth/2fa/enable').set(as(login.body.accessToken)).send({ code: totpCode(targetTotpSecret, timeStep()) }).expect(200);
  targetRefresh = enabled.body.refreshToken;
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { email: { contains: `e2e-staff-${run}-` } } });
  await app.close();
});

describe('staff users admin API', () => {
  it('returns 403 to signed-in non-admin staff and customers', async () => {
    await http.get('/api/admin/staff-users').set(as(supportToken)).expect(403);
    await http.get('/api/admin/staff-users').set(as(opsToken)).expect(403);
    await http.post('/api/admin/staff-users').set(as(supportToken)).send({}).expect(403);
  });

  it('lists non-customer staff with search and pagination and does not expose credentials', async () => {
    const response = await http.get(`/api/admin/staff-users?q=${encodeURIComponent('target')}&page=1&limit=1`).set(as(adminToken)).expect(200);
    expect(response.body.items).toHaveLength(1);
    expect(response.body.items[0]).toMatchObject({ id: targetId, name: expect.any(String), active: true, twoFactorEnabled: true, roles: [{ key: 'OPERATIONS' }] });
    expect(response.text).not.toContain('passwordHash');
    expect(response.text).not.toContain(targetTotpSecret);
  });

  it('creates a staff account, changes its roles, then deactivation revokes refresh sessions', async () => {
    const create = await http.post('/api/admin/staff-users').set(as(adminToken)).send({ name: 'Created Staff', email: email('created'), mobile: `96${run}10`, roles: ['SUPPORT'], temporaryPassword: 'Temporary@123' }).expect(201);
    const id = create.body.id as string;
    expect(create.body).not.toHaveProperty('temporaryPassword');
    expect(create.body.twoFactorEnabled).toBe(false);
    await http.patch(`/api/admin/staff-users/${id}/roles`).set(as(adminToken)).send({ roles: ['OPERATIONS'] }).expect(200);
    const login = await http.post('/api/auth/login').send({ email: email('created'), password: 'Temporary@123' }).expect(200);
    await http.patch(`/api/admin/staff-users/${id}/status`).set(as(adminToken)).send({ active: false }).expect(200);
    await http.post('/api/auth/refresh').send({ refreshToken: login.body.refreshToken }).expect(401);
  });

  it('prevents deactivating yourself and prevents removing or deactivating the last active ADMIN', async () => {
    await http.patch(`/api/admin/staff-users/${adminId}/status`).set(as(adminToken)).send({ active: false }).expect(403);
    const last = await createStaff(prisma, 'ADMIN', email('last-admin'));
    const adminRole = await prisma.role.findUniqueOrThrow({ where: { key: 'ADMIN' }, select: { id: true } });
    const otherAdminBindings = await prisma.userRole.findMany({ where: { roleId: adminRole.id, userId: { not: last } }, select: { userId: true, roleId: true } });
    await prisma.userRole.deleteMany({ where: { roleId: adminRole.id, userId: { not: last } } });
    try {
      await http.patch(`/api/admin/staff-users/${last}/status`).set(as(adminToken)).send({ active: false }).expect(409);
      await http.patch(`/api/admin/staff-users/${last}/roles`).set(as(adminToken)).send({ roles: ['OPERATIONS'] }).expect(409);
    } finally {
      await prisma.userRole.createMany({ data: otherAdminBindings, skipDuplicates: true });
    }
  });

  it('resets 2FA, logs the user out everywhere, requires setup again, and audits no secrets', async () => {
    await http.post(`/api/admin/staff-users/${targetId}/reset-2fa`).set(as(adminToken)).expect(201).expect({ success: true });
    await http.post('/api/auth/refresh').send({ refreshToken: targetRefresh }).expect(401);
    const targetAccess = (await http.post('/api/auth/login').send({ email: email('target'), password: 'Staff@12345' }).expect(200)).body.accessToken;
    const pendingSetup = await http.post('/api/auth/2fa/setup').set(as(targetAccess)).expect(200);
    expect(pendingSetup.body.secret).toBeTruthy();
    const entries = await prisma.auditLog.findMany({ where: { entityId: targetId }, select: { before: true, after: true } });
    const audit = JSON.stringify(entries);
    expect(audit).not.toContain(targetTotpSecret);
    expect(audit).not.toContain(pendingSetup.body.secret);
    expect(audit).not.toContain('Temporary@123');
    expect(audit).not.toMatch(/passwordHash|totpSecret|twoFactorSecret/i);
  });

  it('rejects a duplicate mobile, signs the user out on a role change, and leaves blocked or erased accounts alone', async () => {
    const mobile = `97${run}20`;
    const create = await http.post('/api/admin/staff-users').set(as(adminToken)).send({ name: 'Role Change', email: email('roles'), mobile, roles: ['SUPPORT'], temporaryPassword: 'Temporary@123' }).expect(201);
    const id = create.body.id as string;
    await http.post('/api/admin/staff-users').set(as(adminToken)).send({ name: 'Same Mobile', email: email('dupe'), mobile, roles: ['SUPPORT'], temporaryPassword: 'Temporary@123' }).expect(409);

    const login = await http.post('/api/auth/login').send({ email: email('roles'), password: 'Temporary@123' }).expect(200);
    await http.patch(`/api/admin/staff-users/${id}/roles`).set(as(adminToken)).send({ roles: ['OPERATIONS'] }).expect(200);
    await http.post('/api/auth/refresh').send({ refreshToken: login.body.refreshToken }).expect(401);

    for (const status of ['BLOCKED', 'DELETED'] as const) {
      await prisma.user.update({ where: { id }, data: { status } });
      await http.patch(`/api/admin/staff-users/${id}/status`).set(as(adminToken)).send({ active: true }).expect(409);
      expect((await prisma.user.findUniqueOrThrow({ where: { id } })).status).toBe(status);
    }
  });

  it('does not allow an admin to reset their own 2FA', async () => {
    await http.post(`/api/admin/staff-users/${adminId}/reset-2fa`).set(as(adminToken)).expect(403);
  });
});
