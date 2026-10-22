/**
 * Rate limits on sensitive routes (M12.1). Other suites run with the throttler off (app.module.ts);
 * this one turns it on to see a limit bite, and checks every sensitive route declares one.
 */
import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/main';
import { AuthController } from '../src/auth/auth.controller';
import { CheckoutController } from '../src/payments/checkout.controller';
import { MockCheckoutController } from '../src/payments/mock-checkout.controller';
import { BookingsController } from '../src/bookings/bookings.controller';
import { FilesController } from '../src/files/files.controller';
import { MediaController } from '../src/media/media.controller';
import { LeadsController } from '../src/leads/leads.module';
import { PrivacyController } from '../src/privacy/privacy.controller';
import { PublicCertificatesController } from '../src/certificates/certificates.controller';

/** Route handlers that must have their own per-IP limit, tighter than the global 120/min. */
const SENSITIVE: [{ prototype: object; name: string }, string[]][] = [
  [AuthController, ['register', 'login', 'requestOtp', 'verifyOtp', 'resetPassword', 'google', 'refresh', 'changePassword', 'setupTwoFactor', 'enableTwoFactor', 'verifyTwoFactor']],
  [CheckoutController, ['start', 'callback']],
  [BookingsController, ['pay', 'callback']],
  [MockCheckoutController, ['pay']],
  [FilesController, ['upload']],
  [MediaController, ['upload']],
  [LeadsController, ['create']],
  [PrivacyController, ['create', 'otp']],
  [PublicCertificatesController, ['search', 'downloadPublic']],
];

describe('every sensitive route has its own limit', () => {
  it.each(SENSITIVE.flatMap(([c, methods]) => methods.map((m) => [`${c.name}.${m}`, c, m] as const)))('%s', (_label, controller, method) => {
    const handler = (controller.prototype as Record<string, object>)[method];
    expect(handler).toBeDefined();
    const limit = Reflect.getMetadata('THROTTLER:LIMITdefault', handler);
    expect(limit).toBeGreaterThan(0);
    expect(limit).toBeLessThanOrEqual(60);
  });

  it('public certificate verify has its own two-tier limiter instead (partners get more)', () => {
    expect(Reflect.getMetadata('THROTTLER:SKIPdefault', PublicCertificatesController.prototype.verify)).toBe(true);
  });
});

describe('with the throttler on', () => {
  let app: NestExpressApplication;
  let http: ReturnType<typeof request>;

  beforeAll(async () => {
    process.env.THROTTLE_IN_TESTS = '1';
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(moduleRef.createNestApplication<NestExpressApplication>());
    await app.init();
    http = request(app.getHttpServer()) as unknown as ReturnType<typeof request>;
  });

  afterAll(async () => {
    delete process.env.THROTTLE_IN_TESTS;
    await app.close();
  });

  it('refuses the 11th login attempt in a minute with 429', async () => {
    const attempt = () => http.post('/api/auth/login').send({ email: `nobody-${Date.now()}@example.com`, password: 'wrong-password' });
    for (let i = 0; i < 10; i++) expect((await attempt()).status).toBe(401); // NOSONAR: test steps run in order
    const blocked = await attempt();
    expect(blocked.status).toBe(429);
    expect(blocked.headers['retry-after']).toBeDefined();
  });

  it('counts each route separately', async () => {
    // Login is used up above; refresh still answers normally.
    expect((await http.post('/api/auth/refresh')).status).toBe(401);
  });
});
