/**
 * Turns off 2FA for a staff member who lost their authenticator app, and logs them out everywhere.
 * They must set up a new app at their next login. Check who is asking before running this.
 *
 *   EMAIL="..." pnpm --filter @biznexa/api reset-2fa
 */
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';

async function main() {
  const email = process.env.EMAIL?.trim().toLowerCase();
  if (!email) throw new Error('Set EMAIL to the staff member’s login email');

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) throw new Error(`No user with email ${email}`);
  await prisma.$transaction([
    prisma.user.update({
      where: { id: user.id },
      data: { totpSecret: null, totpEnabledAt: null, totpLastStep: null, totpFailures: 0, totpLockedUntil: null },
    }),
    prisma.refreshToken.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } }),
    prisma.auditLog.create({
      data: { actorId: null, action: 'user.2fa_reset', entityType: 'User', entityId: user.id, before: { enabled: !!user.totpEnabledAt }, after: { enabled: false } },
    }),
  ]);
  console.log(`✓ 2FA reset for ${email}; all their sessions were logged out. They will set up a new app at next login.`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
