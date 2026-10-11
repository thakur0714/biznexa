/**
 * Staff sessions for integration tests. Staff routes need 2FA (D27), and a TOTP code can be used once,
 * so each test file creates its own staff users instead of sharing the seeded demo accounts.
 */
import * as bcrypt from 'bcryptjs';
import type request from 'supertest';
import type { PrismaService } from '../src/prisma/prisma.service';
import { timeStep, totpCode } from '../src/auth/totp';

type Http = ReturnType<typeof request>;
export const STAFF_PASSWORD = 'Staff@12345';

/** Creates a user with `role` (e.g. ADMIN, OPERATIONS) and the given email; returns its id. */
export async function createStaff(prisma: PrismaService, role: string, email: string) {
  const { id: roleId } = await prisma.role.findUniqueOrThrow({ where: { key: role } });
  const user = await prisma.user.create({
    data: {
      name: `E2E ${role}`,
      email,
      passwordHash: await bcrypt.hash(STAFF_PASSWORD, 4),
      emailVerified: true,
      consentAt: new Date(),
      roles: { create: { roleId } },
    },
  });
  return user.id;
}

/** Logs in with the password, sets up 2FA and returns the verified access token and the TOTP secret. */
export async function staffSession(http: Http, prisma: PrismaService, role: string, email: string) {
  await createStaff(prisma, role, email);
  const login = await http.post('/api/auth/login').send({ email, password: STAFF_PASSWORD }).expect(200);
  const auth = `Bearer ${login.body.accessToken}`;
  const { secret } = (await http.post('/api/auth/2fa/setup').set('authorization', auth).expect(200)).body as { secret: string };
  const enabled = await http
    .post('/api/auth/2fa/enable')
    .set('authorization', auth)
    .send({ code: totpCode(secret, timeStep()) })
    .expect(200);
  return { accessToken: enabled.body.accessToken as string, secret };
}
