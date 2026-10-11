/**
 * Creates the first admin in an environment where demo users are not seeded (production).
 *
 *   ADMIN_NAME="..." ADMIN_EMAIL="..." ADMIN_MOBILE="98xxxxxxxx" ADMIN_PASSWORD="..." pnpm --filter @biznexa/api create-admin
 */
import 'dotenv/config';
import * as bcrypt from 'bcryptjs';
import { PrismaPg } from '@prisma/adapter-pg';
import { passwordSchema, mobileSchema } from '@biznexa/types';
import { PrismaClient } from '../src/generated/prisma/client';

async function main() {
  const { ADMIN_NAME, ADMIN_EMAIL, ADMIN_MOBILE, ADMIN_PASSWORD } = process.env;
  if (!ADMIN_NAME || !ADMIN_EMAIL || !ADMIN_MOBILE || !ADMIN_PASSWORD) throw new Error('Set ADMIN_NAME, ADMIN_EMAIL, ADMIN_MOBILE and ADMIN_PASSWORD');
  mobileSchema.parse(ADMIN_MOBILE);
  passwordSchema.parse(ADMIN_PASSWORD);
  if (ADMIN_PASSWORD.length < 12) throw new Error('Use at least 12 characters for an admin password');

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });
  const role = await prisma.role.findUniqueOrThrow({ where: { key: 'ADMIN' } });
  const user = await prisma.user.upsert({
    where: { email: ADMIN_EMAIL.toLowerCase() },
    update: {},
    create: {
      name: ADMIN_NAME,
      email: ADMIN_EMAIL.toLowerCase(),
      mobile: ADMIN_MOBILE,
      passwordHash: await bcrypt.hash(ADMIN_PASSWORD, 12),
      emailVerified: true,
      mobileVerified: true,
      consentAt: new Date(),
    },
  });
  await prisma.userRole.upsert({ where: { userId_roleId: { userId: user.id, roleId: role.id } }, update: {}, create: { userId: user.id, roleId: role.id } });
  console.log(`✓ Admin ready: ${user.email}`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
