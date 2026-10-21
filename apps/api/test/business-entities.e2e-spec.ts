/**
 * A customer's saved businesses (M3.7, D34): owner-scoped CRUD, GSTIN/PAN checks, PAN encrypted at rest.
 */
import { Test } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { randomInt, randomUUID } from 'node:crypto';
import { businessEntityListSchema, businessEntitySchema, gstinCheckChar, MAX_BUSINESS_ENTITIES, type BusinessEntity, type BusinessEntityInput } from '@biznexa/types';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/main';
import { PrismaService } from '../src/prisma/prisma.service';

let app: NestExpressApplication;
let http: ReturnType<typeof request>;
let prisma: PrismaService;
let alice: string;
let bob: string;

const run = randomUUID();
const mobileRun = String(randomInt(1_000_000, 10_000_000));
const base = '/api/business-entities';
const as = (token: string) => ({ authorization: `Bearer ${token}` });
const gstinFor = (stateCode: string, pan: string) => {
  const base = `${stateCode}${pan}1Z`;
  return `${base}${gstinCheckChar(base)}`;
};

const PAN = 'AAPCA1234F';
const acme: BusinessEntityInput = {
  legalName: 'Acme Widgets Private Limited',
  entityType: 'PRIVATE_LIMITED',
  pan: PAN,
  gstin: gstinFor('03', PAN),
  cin: 'U74999PB2020PTC012345',
  address: { line1: '12 Mall Road', city: 'Ludhiana', state: 'Punjab', pincode: '141001' },
};

async function register(n: number) {
  const res = await http
    .post('/api/auth/register')
    .send({ name: 'Business Test', mobile: `7${mobileRun}${String(n).padStart(2, '0')}`, email: `e2e-be-${run}-${n}@example.com`, password: 'secret123', consent: true })
    .expect(201);
  return res.body.accessToken as string;
}

const create = (token: string, body: unknown) => http.post(base).set(as(token)).send(body as object);

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = configureApp(moduleRef.createNestApplication<NestExpressApplication>());
  await app.init();
  http = request(app.getHttpServer()) as unknown as ReturnType<typeof request>;
  prisma = app.get(PrismaService);
  [alice, bob] = [await register(1), await register(2)];
});

afterAll(async () => {
  const users = { email: { startsWith: `e2e-be-${run}` } };
  await prisma.businessEntity.deleteMany({ where: { owner: users } });
  await prisma.user.deleteMany({ where: users });
  await app.close();
});

describe('business entities (M3.7)', () => {
  let entity: BusinessEntity;

  it('needs a login', async () => {
    await http.get(base).expect(401);
    await http.post(base).send(acme).expect(401);
  });

  it('saves a business and gives it back with the PAN readable', async () => {
    const res = await create(alice, { ...acme, pan: PAN.toLowerCase() }).expect(201);
    entity = businessEntitySchema.parse(res.body);
    expect(entity).toMatchObject({ legalName: acme.legalName, entityType: 'PRIVATE_LIMITED', pan: PAN, gstin: acme.gstin, cin: acme.cin, state: 'Punjab' });
    expect(entity.address).toEqual(acme.address);

    expect((await http.get(`${base}/${entity.id}`).set(as(alice)).expect(200)).body).toEqual(entity);
    const list = businessEntityListSchema.parse((await http.get(base).set(as(alice)).expect(200)).body);
    expect(list.items.map((e) => e.id)).toEqual([entity.id]);
  });

  it('stores the PAN encrypted', async () => {
    const row = await prisma.businessEntity.findUniqueOrThrow({ where: { id: entity.id } });
    expect(row.pan).toMatch(/^v1\./);
    expect(row.pan).not.toContain(PAN);
    const [raw] = await prisma.$queryRaw<{ pan: string }[]>`SELECT pan FROM "BusinessEntity" WHERE id = ${entity.id}`;
    expect(raw.pan).toBe(row.pan);
  });

  it("gives customer B a 404 for customer A's business, and changes nothing", async () => {
    const before = await prisma.businessEntity.findUniqueOrThrow({ where: { id: entity.id } });
    expect((await http.get(base).set(as(bob)).expect(200)).body).toEqual({ items: [] });
    const notFound = await http.get(`${base}/${entity.id}`).set(as(bob)).expect(404);
    expect(notFound.body.message).toBe('Business not found');
    await http.put(`${base}/${entity.id}`).set(as(bob)).send({ ...acme, legalName: 'Taken over' }).expect(404);
    await http.delete(`${base}/${entity.id}`).set(as(bob)).expect(404);
    // Same answer as an id that does not exist at all.
    expect((await http.get(`${base}/00000000-0000-4000-8000-000000000000`).set(as(bob)).expect(404)).body).toEqual(notFound.body);
    expect(await prisma.businessEntity.findUniqueOrThrow({ where: { id: entity.id } })).toEqual(before);
  });

  it('refuses an owner in the body', async () => {
    await create(bob, { ...acme, ownerId: 'someone' }).expect(400);
  });

  it('checks GSTIN and PAN with field errors', async () => {
    const res = await create(alice, { ...acme, pan: 'AAPPA1234F', gstin: '03AAPCA1234F1Z0' }).expect(400);
    expect(res.body.errors).toEqual(
      expect.arrayContaining([
        { field: 'pan', message: 'The 4th letter of the PAN of a company is C' },
        { field: 'gstin', message: 'This is not a valid GSTIN — check each character' },
      ]),
    );
    const otherPan = await create(alice, { ...acme, gstin: gstinFor('03', 'AAPCB9999F') }).expect(400);
    expect(otherPan.body.errors).toEqual([{ field: 'gstin', message: 'This GSTIN belongs to a different PAN' }]);
    const otherState = await create(alice, { ...acme, address: { ...acme.address!, state: 'Delhi' } }).expect(400);
    expect(otherState.body.errors).toEqual([{ field: 'gstin', message: 'This GSTIN is registered in Punjab, not Delhi' }]);
  });

  it('refuses the same GSTIN twice for one customer, not across customers', async () => {
    const dup = await create(alice, { ...acme, legalName: 'Acme again' }).expect(409);
    expect(dup.body.errors).toEqual([{ field: 'gstin', message: 'You have already saved a business with this GSTIN' }]);
    await create(bob, acme).expect(201);
  });

  it('replaces the whole business on PUT and re-encrypts the PAN', async () => {
    const before = await prisma.businessEntity.findUniqueOrThrow({ where: { id: entity.id } });
    const pan = 'AAPCZ5678K';
    const res = await http
      .put(`${base}/${entity.id}`)
      .set(as(alice))
      .send({ legalName: 'Acme Widgets Pvt Ltd', entityType: 'PRIVATE_LIMITED', pan, gstin: gstinFor('07', pan) })
      .expect(200);
    expect(res.body).toMatchObject({ id: entity.id, legalName: 'Acme Widgets Pvt Ltd', pan, cin: null, address: null, state: 'Delhi' });
    const after = await prisma.businessEntity.findUniqueOrThrow({ where: { id: entity.id } });
    expect(after.pan).not.toBe(before.pan);
    expect(after.pan).not.toContain(pan);

    // Keeping its own GSTIN is not a duplicate; clearing the PAN stores null.
    const cleared = await http.put(`${base}/${entity.id}`).set(as(alice)).send({ legalName: 'Acme Widgets Pvt Ltd', entityType: 'PRIVATE_LIMITED', gstin: gstinFor('07', pan) }).expect(200);
    expect(cleared.body.pan).toBeNull();
    expect((await prisma.businessEntity.findUniqueOrThrow({ where: { id: entity.id } })).pan).toBeNull();
  });

  it('removes a business (soft delete)', async () => {
    await http.delete(`${base}/${entity.id}`).set(as(alice)).expect(200);
    await http.get(`${base}/${entity.id}`).set(as(alice)).expect(404);
    await http.delete(`${base}/${entity.id}`).set(as(alice)).expect(404);
    expect((await http.get(base).set(as(alice)).expect(200)).body).toEqual({ items: [] });
    expect((await prisma.businessEntity.findUniqueOrThrow({ where: { id: entity.id } })).deletedAt).not.toBeNull();
    // Its GSTIN can be saved again.
    await create(alice, { legalName: 'Acme Widgets Pvt Ltd', entityType: 'PRIVATE_LIMITED', gstin: gstinFor('07', 'AAPCZ5678K') }).expect(201);
  });

  it(`keeps to ${MAX_BUSINESS_ENTITIES} businesses per customer, even when saved at once`, async () => {
    const carol = await register(3);
    const carolId = (await prisma.user.findUniqueOrThrow({ where: { email: `e2e-be-${run}-3@example.com` }, select: { id: true } })).id;
    // Seed the customer close to the cap directly so the simultaneous requests focus on the lock-protected limit.
    await prisma.businessEntity.createMany({
      data: Array.from({ length: MAX_BUSINESS_ENTITIES - 5 }, (_, i) => ({
        ownerId: carolId,
        legalName: `Existing Shop ${i} ${run}`,
        entityType: 'PROPRIETORSHIP' as const,
      })),
    });
    const results = await Promise.all(Array.from({ length: 10 }, (_, i) => create(carol, { legalName: `Shop ${i} ${run}`, entityType: 'PROPRIETORSHIP' })));
    expect(results.filter((r) => r.status === 201)).toHaveLength(5);
    expect(results.filter((r) => r.status === 400)).toHaveLength(5);
    expect((await http.get(base).set(as(carol)).expect(200)).body.items).toHaveLength(MAX_BUSINESS_ENTITIES);
  });
});
