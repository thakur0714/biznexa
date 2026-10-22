import { Prisma } from '../generated/prisma/client';
import {
  anonymiseAccount,
  anonymisedBusiness,
  anonymisedProfile,
  anonymisedUser,
  deletionBlockers,
  DELETED_TEXT,
  DELETED_USER_NAME,
  IN_PROGRESS_STATUSES,
} from './account-anonymiser';

const NOW = new Date('2026-10-17T10:00:00Z');
const USER = 'user-1';

/** A transaction double that records every call as `model.method` with its arguments. */
function fakeTx(seed: { email?: string | null; mobile?: string | null; uploads?: string[]; exports?: string[] } = {}) {
  const calls: { op: string; args: Record<string, unknown> }[] = [];
  const results: Record<string, unknown> = {
    'user.findUniqueOrThrow': { email: 'email' in seed ? seed.email : 'asha@example.com', mobile: 'mobile' in seed ? seed.mobile : '9876543210' },
    'storedFile.findMany': (seed.uploads ?? ['aa/1', 'bb/2']).map((fileKey) => ({ fileKey })),
    'dataRequest.findMany': (seed.exports ?? ['cc/3']).map((fileKey) => ({ fileKey })),
  };
  const tx = new Proxy(
    {},
    {
      get: (_t, model: string) =>
        new Proxy(
          {},
          {
            get: (_m, method: string) => (args: Record<string, unknown>) => {
              calls.push({ op: `${model}.${method}`, args });
              return results[`${model}.${method}`] ?? { count: 1 };
            },
          },
        ),
    },
  ) as unknown as Prisma.TransactionClient;
  const find = (op: string) => calls.filter((c) => c.op === op);
  return { tx, calls, find };
}

describe('deletionBlockers', () => {
  it('is empty when nothing is open', () => {
    expect(deletionBlockers({ applicationsInProgress: 0, ordersWithBalance: 0, upcomingBookings: 0 })).toEqual([]);
  });

  it('names each reason with the right number', () => {
    expect(deletionBlockers({ applicationsInProgress: 1, ordersWithBalance: 2, upcomingBookings: 1 })).toEqual([
      '1 application is still in progress',
      '2 orders have a balance due',
      '1 consultation is coming up',
    ]);
  });

  it('treats only paid, unfinished work as in progress', () => {
    for (const s of ['DRAFT', 'PAYMENT_PENDING', 'COMPLETED', 'DELIVERED', 'CANCELLED']) expect(IN_PROGRESS_STATUSES).not.toContain(s);
    expect(IN_PROGRESS_STATUSES).toEqual(expect.arrayContaining(['SUBMITTED', 'IN_PROGRESS', 'ON_HOLD', 'DOCUMENTS_PENDING']));
  });
});

describe('anonymised values', () => {
  it('leave nothing that identifies or lets the person sign in', () => {
    const u = anonymisedUser(NOW);
    expect(u).toMatchObject({ name: DELETED_USER_NAME, email: null, mobile: null, passwordHash: null, googleId: null, avatarUrl: null, totpSecret: null, status: 'DELETED', deletedAt: NOW });
    expect(u.notificationPrefs).toBe(Prisma.DbNull);
    expect(Object.values(anonymisedProfile).every((v) => v === null)).toBe(true);
    expect(anonymisedBusiness).toMatchObject({ gstin: null, cin: null, pan: null, state: null });
  });
});

describe('anonymiseAccount', () => {
  it('anonymises the user, profile and businesses, revokes every session and returns the files to delete', async () => {
    const { tx, find } = fakeTx();
    const result = await anonymiseAccount(tx, USER, NOW);

    expect(result.fileKeys).toEqual(['aa/1', 'bb/2', 'cc/3']);
    expect(find('user.update')).toEqual([{ op: 'user.update', args: { where: { id: USER }, data: anonymisedUser(NOW) } }]);
    expect(find('customerProfile.updateMany')[0].args).toEqual({ where: { userId: USER }, data: anonymisedProfile });
    expect(find('businessEntity.updateMany').map((c) => c.args.where)).toEqual([{ ownerId: USER }, { ownerId: USER, deletedAt: null }]);
    for (const op of ['refreshToken.deleteMany', 'deviceToken.deleteMany', 'notification.deleteMany', 'notificationDelivery.deleteMany']) expect(find(op)[0].args).toEqual({ where: { userId: USER } });
    expect(find('otpCode.deleteMany')[0].args).toEqual({ where: { target: { in: ['asha@example.com', '9876543210'] } } });
    expect(find('lead.deleteMany')[0].args).toEqual({ where: { OR: [{ email: 'asha@example.com' }, { mobile: '9876543210' }] } });
  });

  it('clears what the person wrote or uploaded, scoped to them', async () => {
    const { tx, find } = fakeTx();
    await anonymiseAccount(tx, USER, NOW);
    expect(find('application.updateMany')[0].args).toEqual({ where: { customerId: USER }, data: { formData: {} } });
    expect(find('applicationDocument.updateMany')[0].args).toEqual({ where: { application: { customerId: USER } }, data: { fileName: null } });
    expect(find('storedFile.updateMany')[0].args).toEqual({ where: { ownerId: USER, deletedAt: null }, data: { originalName: 'deleted', deletedAt: NOW } });
    expect(find('message.updateMany')[0].args).toEqual({ where: { senderId: USER }, data: { body: DELETED_TEXT } });
    expect(find('ticket.updateMany')[0].args.where).toEqual({ customerId: USER });
    expect(find('booking.updateMany')[0].args).toEqual({ where: { customerId: USER }, data: { notes: null } });
    expect(find('review.updateMany')[0].args).toEqual({ where: { booking: { customerId: USER } }, data: { text: null } });
    expect(find('reminder.updateMany')[0].args).toEqual({ where: { userId: USER, status: 'SCHEDULED' }, data: { status: 'CANCELLED' } });
    expect(find('dataRequest.updateMany').map((c) => c.args.where)).toEqual([
      { userId: USER, fileKey: { not: null } },
      { userId: USER, type: 'EXPORT', status: { in: ['PENDING', 'PROCESSING'] } },
    ]);
  });

  it('never touches the records the law makes us keep', async () => {
    const { tx, calls } = fakeTx();
    await anonymiseAccount(tx, USER, NOW);
    const touched = new Set(calls.filter((c) => !/\.find/.test(c.op)).map((c) => c.op.split('.')[0]));
    for (const kept of ['invoice', 'creditNote', 'payment', 'refund', 'certificate', 'order', 'auditLog']) expect(touched).not.toContain(kept);
    expect(calls.some((c) => /\.delete$/.test(c.op) || c.op === 'user.deleteMany')).toBe(false);
  });

  it('skips the code and lead clean-up when the account had no email or mobile', async () => {
    const { tx, find } = fakeTx({ email: null, mobile: null });
    await anonymiseAccount(tx, USER, NOW);
    expect(find('otpCode.deleteMany')).toEqual([]);
    expect(find('lead.deleteMany')).toEqual([]);
  });
});
