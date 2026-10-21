import { configureApp } from '../src/main';

import { NestExpressApplication } from '@nestjs/platform-express';
import * as supertest from 'supertest';
const request = supertest.default || supertest;
import { PrismaService } from '../src/prisma/prisma.service';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module';
import { JwtService } from '@nestjs/jwt';
import { PERMS } from '@biznexa/types';

describe('InternalNotesController (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let jwt: JwtService;

  const run = Date.now().toString().slice(-7);
  let adminId: string;
  let assignedStaffId: string;
  let unassignedStaffId: string;
  let customerId: string;

  let assignedApplicationId: string;
  let categoryId: string;
  let serviceId: string;
  let packageId: string;

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication<NestExpressApplication>();
    
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    jwt = app.get(JwtService);

    const users = await prisma.user.createManyAndReturn({
      data: [
        { email: `admin-${run}@test.com`, name: 'Admin', passwordHash: 'hash', consentAt: new Date() },
        { email: `staff1-${run}@test.com`, name: 'Staff 1', passwordHash: 'hash', consentAt: new Date() },
        { email: `staff2-${run}@test.com`, name: 'Staff 2', passwordHash: 'hash', consentAt: new Date() },
        { email: `customer-${run}@test.com`, name: 'Customer', passwordHash: 'hash', consentAt: new Date() },
      ],
    });
    adminId = users[0].id;
    assignedStaffId = users[1].id;
    unassignedStaffId = users[2].id;
    customerId = users[3].id;

    const cat = await prisma.category.create({ data: { name: `Cat ${run}`, slug: `cat-${run}` } });
    categoryId = cat.id;

    const svc = await prisma.service.create({
      data: {
        slug: `svc-${run}`,
        categoryId,
        name: `Test Service ${run}`,
        shortDescription: 'Test',
        sacCode: '998231',
        packages: {
          create: [{ name: 'Test Package', professionalFee: 100, governmentFee: 0, gstRate: 18, sortOrder: 0 }],
        },
        formSchemas: {
          create: [{ version: 1, schema: {}, isCurrent: true }],
        },
      },
      include: { packages: true },
    });
    serviceId = svc.id;
    packageId = svc.packages[0].id;

    
    await prisma.order.create({ data: { code: `ORD-${run}-1`, customerId, items: {}, total: 100, taxTotal: 0, subtotal: 100, status: 'CREATED', amountPaid: 0, discount: 0, govtFees: 0 } });

    const app1 = await prisma.application.create({
      data: {
        code: `BN${run}1`,
        status: 'SUBMITTED',
        serviceId,
        packageId,
        formSchemaVersion: 1,
        formData: {},
        customerId,
        
      },
    });
    const _applicationId = app1.id;

    
    await prisma.order.create({ data: { code: `ORD-${run}-2`, customerId, items: {}, total: 100, taxTotal: 0, subtotal: 100, status: 'CREATED', amountPaid: 0, discount: 0, govtFees: 0 } });

    const app2 = await prisma.application.create({
      data: {
        code: `BN${run}2`,
        status: 'SUBMITTED',
        serviceId,
        packageId,
        formSchemaVersion: 1,
        formData: {},
        customerId,
        assignedToId: assignedStaffId,
        
      },
    });
    assignedApplicationId = app2.id;
  });

  afterAll(async () => {
    // Delete in reverse order of creation, scoped to our run
    await prisma.internalNote.deleteMany({
      where: { application: { order: { customerId } } },
    });
    await prisma.application.deleteMany({
      where: { customerId },
    });
    await prisma.order.deleteMany({
      where: { customerId },
    });
    await prisma.servicePackage.deleteMany({
      where: { serviceId },
    });
    await prisma.serviceFormSchema.deleteMany({
      where: { serviceId },
    });
    await prisma.service.deleteMany({
      where: { id: serviceId },
    });
    await prisma.category.deleteMany({
      where: { id: categoryId },
    });
    await prisma.user.deleteMany({
      where: { id: { in: [adminId, assignedStaffId, unassignedStaffId, customerId] } },
    });
    await app.close();
  });

  const getAdminToken = () => {
    return jwt.sign({ sub: adminId, roles: [], perms: [PERMS.APPLICATIONS_VIEW_ALL], typ: 'access', tfa: 'verified' });
  };
  const getAssignedStaffToken = () => {
    return jwt.sign({ sub: assignedStaffId, roles: [], perms: [PERMS.APPLICATIONS_VIEW_ASSIGNED], typ: 'access', tfa: 'verified' });
  };
  const getUnassignedStaffToken = () => {
    return jwt.sign({ sub: unassignedStaffId, roles: [], perms: [PERMS.APPLICATIONS_VIEW_ASSIGNED], typ: 'access', tfa: 'verified' });
  };
  const getCustomerToken = () => {
    return jwt.sign({ sub: customerId, roles: [], perms: [], typ: 'access', tfa: 'verified' });
  };

  it('unassigned ops -> 404 on list and create', async () => {
    const token = getUnassignedStaffToken();
    await request(app.getHttpServer())
      .get(`/api/admin/applications/${assignedApplicationId}/notes`)
      .set('Authorization', `Bearer ${token}`)
      .expect(404);
      
    await request(app.getHttpServer())
      .post(`/api/admin/applications/${assignedApplicationId}/notes`)
      .set('Authorization', `Bearer ${token}`)
      .send({ content: 'Test note' })
      .expect(404);
  });

  it('assigned ops -> list/create ok, delete own ok, other note 403', async () => {
    await prisma.application.findUnique({ where: { id: assignedApplicationId }});
    

    const token = getAssignedStaffToken();
    
    // Create by assigned staff
    const resCreate = await request(app.getHttpServer())
      .post(`/api/admin/applications/${assignedApplicationId}/notes`)
      .set('Authorization', `Bearer ${token}`)
      .send({ content: 'My note' })
      .expect(201).then(res => { console.log(res.body); return res; });
    
    expect(resCreate.body.content).toBe('My note');
    const myNoteId = resCreate.body.id;

    // List
    const resList = await request(app.getHttpServer())
      .get(`/api/admin/applications/${assignedApplicationId}/notes`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(resList.body.length).toBeGreaterThan(0);

    // Create a note by admin for this application
    const adminToken = getAdminToken();
    const resAdminCreate = await request(app.getHttpServer())
      .post(`/api/admin/applications/${assignedApplicationId}/notes`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ content: 'Admin note' })
      .expect(201);
    const adminNoteId = resAdminCreate.body.id;

    // Assigned staff cannot edit/delete admin note
    await request(app.getHttpServer())
      .put(`/api/admin/applications/${assignedApplicationId}/notes/${adminNoteId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ content: 'Hacked' })
      .expect(403);
    await request(app.getHttpServer())
      .delete(`/api/admin/applications/${assignedApplicationId}/notes/${adminNoteId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(403);

    // Assigned staff can delete own note
    await request(app.getHttpServer())
      .delete(`/api/admin/applications/${assignedApplicationId}/notes/${myNoteId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
  });

  it('admin deletes any', async () => {
    const adminToken = getAdminToken();
    
    // Create note by assigned staff
    const staffToken = getAssignedStaffToken();
    const resCreate = await request(app.getHttpServer())
      .post(`/api/admin/applications/${assignedApplicationId}/notes`)
      .set('Authorization', `Bearer ${staffToken}`)
      .send({ content: 'Note to delete' })
      .expect(201);
    const noteId = resCreate.body.id;

    // Admin can delete it
    await request(app.getHttpServer())
      .delete(`/api/admin/applications/${assignedApplicationId}/notes/${noteId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
  });

  it('customer never sees notes', async () => {
    const token = getCustomerToken();
    await request(app.getHttpServer())
      .get(`/api/admin/applications/${assignedApplicationId}/notes`)
      .set('Authorization', `Bearer ${token}`)
      .expect(403);
  });
});
