/**
 * Authorization sweep (M12.4): every route × every role. Routes are discovered from the running app (Nest's
 * DiscoveryService plus each handler's route metadata), so a route added later is covered without editing this
 * file. What each role should get is worked out from the route's access decorator and the role → permission seed
 * (seed-access.ts); the request is then made for real and the guard's answer compared with it.
 *
 * Only the guard's decision is checked: the test wraps AuthGuard.canActivate to stamp its verdict on the response
 * (x-guard header), so a handler's own 401/403 (bad login, expired signed link) is not mistaken for it, and a
 * route the guard never saw shows up as "missing".
 *
 * A route with no access decorator fails the first test (and the guard refuses it for everyone, D63).
 */
import { randomInt, randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { DiscoveryService, MetadataScanner, Reflector } from '@nestjs/core';
import { type ExecutionContext, HttpException, RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/main';
import { PrismaService } from '../src/prisma/prisma.service';
import { ACCESS, ANY_PERMISSIONS, IS_PUBLIC, PERMISSIONS, type Access } from '../src/common/auth.decorators';
import { AuthGuard } from '../src/common/auth.guard';
import { PERMISSIONS as ALL_PERMISSIONS, ROLES } from '../prisma/seed-access';
import { createStaff, STAFF_PASSWORD, staffSession } from './staff';

let app: NestExpressApplication;
let http: ReturnType<typeof request>;
let prisma: PrismaService;

// Random, not time-based: other suites build mobiles from Date.now() and may start in the same millisecond.
const run = randomUUID().slice(0, 8);
const ids: string[] = [];
const ANY_ID = '00000000-0000-4000-8000-000000000000';

type Route = {
  method: string;
  path: string;
  handler: string;
  isPublic: boolean;
  access?: Access;
  all: string[];
  any: string[];
};
type Actor = { name: string; token?: string; roles: string[]; perms: string[]; twoFactorPending?: boolean };
type Outcome = 'allowed' | '401' | '403';

let routes: Route[] = [];
const actors: Actor[] = [];

/** Every handler of every controller, with the access metadata the guard reads (handler first, then class). */
function discoverRoutes(): Route[] {
  const discovery = app.get(DiscoveryService);
  const scanner = app.get(MetadataScanner);
  const reflector = app.get(Reflector);
  const found: Route[] = [];
  for (const wrapper of discovery.getControllers()) {
    const cls = wrapper.metatype as object;
    const proto = Object.getPrototypeOf(wrapper.instance);
    const bases = [Reflect.getMetadata(PATH_METADATA, cls) ?? ''].flat() as string[];
    for (const name of scanner.getAllMethodNames(proto)) {
      const handler = proto[name];
      const paths = Reflect.getMetadata(PATH_METADATA, handler);
      if (paths === undefined) continue;
      const method = RequestMethod[Reflect.getMetadata(METHOD_METADATA, handler) as RequestMethod];
      const targets = [handler, cls];
      const meta = {
        isPublic: reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets) ?? false,
        access: reflector.getAllAndOverride<Access | undefined>(ACCESS, targets),
        all: reflector.getAllAndOverride<string[]>(PERMISSIONS, targets) ?? [],
        any: reflector.getAllAndOverride<string[]>(ANY_PERMISSIONS, targets) ?? [],
      };
      for (const base of bases) {
        for (const p of [paths].flat() as string[]) {
          const path = `/api/${base}/${p}`.replaceAll(/\/+/g, '/').replace(/(.)\/$/, '$1');
          found.push({ method, path, handler: `${wrapper.name}.${name}`, ...meta });
        }
      }
    }
  }
  return found;
}

/** What the guard should answer this actor on this route. */
function expected(route: Route, actor: Actor): Outcome {
  if (route.isPublic) return 'allowed';
  if (!actor.token) return '401';
  // Same order as the guard: the access marker first, then any permissions the route also declares.
  if (route.access === 'customer' && !actor.roles.includes('CUSTOMER')) return '403';
  const held = actor.twoFactorPending ? [] : actor.perms;
  if (!route.all.length && !route.any.length) return route.access ? 'allowed' : '403'; // undeclared: refused for everyone
  if (!route.all.every((p) => held.includes(p))) return '403';
  if (route.any.length && !route.any.some((p) => held.includes(p))) return '403';
  return 'allowed';
}

/** Records the guard's verdict on the response; the request itself goes on unchanged. */
function stampGuardVerdicts() {
  const original = AuthGuard.prototype.canActivate;
  jest.spyOn(AuthGuard.prototype, 'canActivate').mockImplementation(function (this: AuthGuard, ctx: ExecutionContext) {
    const res = ctx.switchToHttp().getResponse();
    try {
      const ok = original.call(this, ctx);
      res.setHeader('x-guard', 'allowed');
      return ok;
    } catch (e) {
      res.setHeader('x-guard', e instanceof HttpException ? String(e.getStatus()) : 'error');
      throw e;
    }
  });
}

function outcome(res: request.Response): Outcome | 'missing' {
  const verdict = res.headers['x-guard'];
  if (verdict === 'allowed') return 'allowed';
  if (verdict === '401' || verdict === '403') return verdict;
  return 'missing';
}

function call(route: Route, actor: Actor) {
  const url = route.path.replaceAll(/:[A-Za-z]+/g, ANY_ID);
  let req = http[route.method.toLowerCase() as 'get' | 'post' | 'put' | 'patch' | 'delete'](url);
  if (actor.token) req = req.set('authorization', `Bearer ${actor.token}`);
  return ['GET', 'DELETE'].includes(route.method) ? req : req.send({});
}

function permsOf(roleKeys: string[]) {
  const perms = new Set<string>();
  for (const key of roleKeys) {
    const role = ROLES.find((r) => r.key === key)!;
    for (const p of role.perms === 'ALL' ? Object.keys(ALL_PERMISSIONS) : role.perms) perms.add(p);
  }
  return [...perms];
}

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = configureApp(moduleRef.createNestApplication<NestExpressApplication>({ rawBody: true }));
  stampGuardVerdicts();
  await app.init();
  http = request(app.getHttpServer()) as unknown as ReturnType<typeof request>;
  prisma = app.get(PrismaService);
  routes = discoverRoutes();

  actors.push({ name: 'anonymous', roles: [], perms: [] });
  for (const role of ROLES) {
    const email = `e2e-acl-${run}-${role.key.toLowerCase()}@example.com`;
    if (role.key === 'CUSTOMER') {
      const res = await http // NOSONAR: test steps run in order
        .post('/api/auth/register')
        .send({ name: 'ACL customer', mobile: `9${randomInt(100_000_000, 1_000_000_000)}`, email, password: 'secret123', consent: true })
        .expect(201);
      ids.push(res.body.user.id);
      actors.push({ name: 'customer', token: res.body.accessToken, roles: ['CUSTOMER'], perms: [] });
    } else {
      // A consultant is a customer who was given the CONSULTANT role on approval.
      const roles = role.key === 'CONSULTANT' ? ['CUSTOMER', 'CONSULTANT'] : [role.key];
      const { accessToken } = await staffSession(http, prisma, roles, email); // NOSONAR: test steps run in order
      ids.push((await prisma.user.findUniqueOrThrow({ where: { email } })).id); // NOSONAR: test steps run in order
      actors.push({ name: role.key.toLowerCase(), token: accessToken, roles, perms: permsOf(roles) });
    }
  }
  // An operations executive who signed in with the password but has not entered the 2FA code yet (D27).
  const pendingEmail = `e2e-acl-${run}-pending@example.com`;
  ids.push(await createStaff(prisma, 'OPERATIONS', pendingEmail));
  const login = await http.post('/api/auth/login').send({ email: pendingEmail, password: STAFF_PASSWORD }).expect(200);
  actors.push({ name: 'operations (2FA pending)', token: login.body.accessToken, roles: ['OPERATIONS'], perms: permsOf(['OPERATIONS']), twoFactorPending: true });
});

afterAll(async () => {
  const mine = { userId: { in: ids } };
  await prisma.notification.deleteMany({ where: mine });
  await prisma.deviceToken.deleteMany({ where: mine });
  await prisma.dataRequest.deleteMany({ where: mine });
  await prisma.refreshToken.deleteMany({ where: mine });
  await prisma.auditLog.deleteMany({ where: { actorId: { in: ids } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
  await app.close();
});

describe('route access matrix (M12.4)', () => {
  it('finds the routes, and every one declares who may call it', () => {
    expect(routes.length).toBeGreaterThan(150);
    const undeclared = routes.filter((r) => !r.isPublic && !r.access && !r.all.length && !r.any.length);
    // Add @Public(), @SignedIn(), @CustomerOnly(), @RequirePermissions() or @RequireAnyPermission() to these:
    expect(undeclared.map((r) => `${r.method} ${r.path} (${r.handler})`)).toEqual([]);
  });

  it('discovers exactly the routes the HTTP server serves (nothing registered around the guard)', () => {
    const router = app.getHttpAdapter().getInstance().router as { stack: { route?: { path: string; methods: Record<string, boolean> } }[] };
    const served = router.stack
      .filter((l) => l.route)
      .flatMap((l) => Object.keys(l.route!.methods).filter((m) => m !== '_all').map((m) => `${m.toUpperCase()} ${l.route!.path}`));
    const discovered = routes.map((r) => `${r.method} ${r.path}`);
    expect([...new Set(served)].toSorted((a, b) => a.localeCompare(b))).toEqual([...new Set(discovered)].toSorted((a, b) => a.localeCompare(b)));
  });

  it('only names permissions that exist in the seed', () => {
    const known = new Set(Object.keys(ALL_PERMISSIONS));
    const unknown = routes.flatMap((r) => [...r.all, ...r.any].filter((p) => !known.has(p)).map((p) => `${r.method} ${r.path}: ${p}`));
    expect(unknown).toEqual([]);
  });

  it('answers every role on every route as its decorators and the role seed say', async () => {
    expect(actors.map((a) => a.name)).toEqual(
      expect.arrayContaining(['anonymous', 'customer', 'consultant', 'admin', 'operations', 'support', 'operations (2FA pending)']),
    );
    const wrong: string[] = [];
    for (const actor of actors) {
      for (let i = 0; i < routes.length; i += 8) {
        await Promise.all( // NOSONAR: test steps run in order
          routes.slice(i, i + 8).map(async (route) => {
            const want = expected(route, actor);
            const res = await call(route, actor);
            const got = outcome(res);
            if (got !== want) wrong.push(`${actor.name}: ${route.method} ${route.path} → expected ${want}, got ${got} (${res.status})`);
          }),
        );
      }
    }
    expect(wrong).toEqual([]);
  }, 180_000);

  it('limits operations staff to what their permissions allow, and keeps customers out of the admin API', async () => {
    const ops = actors.find((a) => a.name === 'operations')!;
    const customer = actors.find((a) => a.name === 'customer')!;
    const at = (method: string, path: string) => routes.find((r) => r.method === method && r.path === path)!;
    const deniedToOps = [
      at('GET', '/api/admin/payments'),
      at('POST', '/api/admin/payments/:id/refunds'),
      at('PUT', '/api/admin/settings/seller'),
      at('GET', '/api/admin/coupons'),
      at('GET', '/api/admin/audit'),
      at('GET', '/api/admin/reports/dashboard'),
      at('PATCH', '/api/admin/customers/:id/status'),
      at('POST', '/api/admin/applications/bulk-assign'),
      at('GET', '/api/admin/catalogue/services'),
      at('POST', '/api/admin/certificates'),
      at('GET', '/api/admin/leads'),
      at('GET', '/api/admin/tickets'),
      at('GET', '/api/admin/privacy/requests'),
      // Staff accounts do not use the customer self-service API.
      at('POST', '/api/applications'),
      at('POST', '/api/bookings'),
    ];
    for (const route of deniedToOps) expect([`${route.method} ${route.path}`, outcome(await call(route, ops))]).toEqual([`${route.method} ${route.path}`, '403']); // NOSONAR: test steps run in order
    for (const route of [at('GET', '/api/admin/applications'), at('POST', '/api/admin/documents/:id/approve'), at('GET', '/api/admin/customers')]) {
      expect([`${route.method} ${route.path}`, outcome(await call(route, ops))]).toEqual([`${route.method} ${route.path}`, 'allowed']); // NOSONAR: test steps run in order
    }
    const adminRoutes = routes.filter((r) => r.path.startsWith('/api/admin/') && !r.isPublic);
    expect(adminRoutes.length).toBeGreaterThan(50);
    for (const route of adminRoutes) expect([`${route.method} ${route.path}`, outcome(await call(route, customer))]).toEqual([`${route.method} ${route.path}`, '403']); // NOSONAR: test steps run in order
  });
});
