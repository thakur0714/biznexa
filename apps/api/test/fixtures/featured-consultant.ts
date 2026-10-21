import 'dotenv/config';
import * as bcrypt from 'bcryptjs';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../src/generated/prisma/client';

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });
const action = process.argv[2];
const runId = process.argv[3];

async function main() {
  if (!runId) throw new Error('A test run id is required');
  const slug = `e2e-featured-${runId}`;
  if (action === 'create') {
    const user = await prisma.user.create({ data: {
      name: `Featured E2E ${runId}`, email: `${slug}@example.com`, mobile: `8${runId.slice(-9).padStart(9, '0')}`,
      passwordHash: await bcrypt.hash('not-used-by-e2e', 4), emailVerified: true, mobileVerified: true, consentAt: new Date(),
    } });
    const consultant = await prisma.consultant.create({ data: {
      userId: user.id, slug, category: 'CA', qualification: 'Chartered Accountant', experienceYears: 10,
      expertise: ['GST'], languages: ['English', `E2E${runId.slice(-8)}`], city: 'Pune', state: 'Maharashtra',
      feePerSession: 150_000, consultationTypes: ['AUDIO'], verificationStatus: 'APPROVED', isFeatured: true,
      minNoticeMinutes: 0, sessionMinutes: 30,
    } });
    const day = new Date(Date.now() + 3 * 24 * 60 * 60_000).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
    await prisma.availabilitySlot.create({ data: {
      consultantId: consultant.id, date: new Date(`${day}T00:00:00.000Z`), startTime: '11:00', endTime: '12:00',
    } });
    process.stdout.write(JSON.stringify({ slug, language: `E2E${runId.slice(-8)}`, consultantId: consultant.id }));
    return;
  }
  if (action === 'delete') {
    const consultant = await prisma.consultant.findUnique({ where: { slug }, select: { id: true, userId: true } });
    if (!consultant) return;
    const bookings = await prisma.booking.findMany({ where: { consultantId: consultant.id }, select: { id: true } });
    const bookingIds = bookings.map((booking) => booking.id);
    const payments = await prisma.payment.findMany({ where: { bookingId: { in: bookingIds } }, select: { id: true } });
    const paymentIds = payments.map((payment) => payment.id);
    await prisma.$transaction([
      prisma.paymentWebhookEvent.deleteMany({ where: { paymentId: { in: paymentIds } } }),
      prisma.bookingStatusHistory.deleteMany({ where: { bookingId: { in: bookingIds } } }),
      prisma.payment.deleteMany({ where: { bookingId: { in: bookingIds } } }),
      prisma.booking.deleteMany({ where: { id: { in: bookingIds } } }),
      prisma.availabilitySlot.deleteMany({ where: { consultantId: consultant.id } }),
      prisma.consultant.delete({ where: { id: consultant.id } }),
      prisma.user.delete({ where: { id: consultant.userId } }),
    ]);
    return;
  }
  throw new Error('Action must be create or delete');
}

void main().finally(() => prisma.$disconnect());
