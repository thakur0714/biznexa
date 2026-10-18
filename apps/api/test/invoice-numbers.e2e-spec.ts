/**
 * Invoice numbering (M3.20, D47): one gap-free counter per financial year. Concurrent transactions get
 * consecutive numbers, a rolled-back one hands its number to the next, and 1 April (IST) starts at 1.
 * Each run uses far-future years of its own so it never touches real counters or another run's.
 */
import { Test } from '@nestjs/testing';
import { financialYear, INVOICE_NUMBER_PATTERN } from '@biznexa/types';
import { AppModule } from '../src/app.module';
import { InvoiceNumbersService, type InvoiceNumber } from '../src/invoices/invoice-numbers.service';
import { PrismaService } from '../src/prisma/prisma.service';

let prisma: PrismaService;
let numbers: InvoiceNumbersService;
let close: () => Promise<void>;

// A calendar year between 2200 and 2829 (invoice-pdf and invoice-record use 3000+); each test takes its own so they
// can share one run.
const base = 2200 + Math.floor(Math.random() * 600);
let used = 0;
const year = () => base + 10 * used++;
/** Midsummer of `y`, i.e. inside FY y-(y+1). */
const inYear = (y: number) => new Date(`${y}-07-01T06:00:00Z`);
const years: string[] = [];

class Rollback extends Error {}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const txOptions = { maxWait: 20_000, timeout: 20_000 };

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication();
  await app.init();
  close = () => app.close();
  prisma = app.get(PrismaService);
  numbers = app.get(InvoiceNumbersService);
});

afterAll(async () => {
  await prisma.invoiceSequence.deleteMany({ where: { financialYear: { in: years } } });
  await close();
});

const track = (at: Date) => {
  years.push(financialYear(at));
  return at;
};

it('starts each year at 1 and counts up, formatted for GST', async () => {
  const at = track(inYear(year()));
  const fy = financialYear(at);
  const a = await prisma.$transaction((tx) => numbers.next(tx, null, at));
  const b = await prisma.$transaction((tx) => numbers.next(tx, 'BNXA', at));
  expect(a).toEqual({ financialYear: fy, sequence: 1, number: `BN/${fy.slice(2, 4)}${fy.slice(5)}/000001` });
  expect(b.sequence).toBe(2);
  expect(b.number).toMatch(INVOICE_NUMBER_PATTERN);
  expect(b.number).toHaveLength(16);
});

it('hands a rolled-back number to the next invoice', async () => {
  const at = track(inYear(year()));
  await prisma.$transaction((tx) => numbers.next(tx, null, at));
  await expect(
    prisma.$transaction(async (tx) => {
      expect((await numbers.next(tx, null, at)).sequence).toBe(2);
      throw new Rollback();
    }),
  ).rejects.toBeInstanceOf(Rollback);
  expect((await prisma.$transaction((tx) => numbers.next(tx, null, at))).sequence).toBe(2);
});

it('stays gap-free under concurrency, even when some transactions roll back', async () => {
  const at = track(inYear(year()));
  const runs = 20;
  const results = await Promise.allSettled(
    Array.from({ length: runs }, (_, i) =>
      prisma.$transaction(async (tx) => {
        const n = await numbers.next(tx, null, at);
        // Hold the lock a little while the others queue up behind it; every 4th one then fails.
        await sleep(5 + (i % 3) * 5);
        if (i % 4 === 3) throw new Rollback();
        return n;
      }, txOptions),
    ),
  );
  const committed = results.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []));
  const failed = results.flatMap((r) => (r.status === 'rejected' ? [r.reason as unknown] : []));
  expect(failed).toHaveLength(runs / 4);
  for (const e of failed) expect(e).toBeInstanceOf(Rollback);

  const seqs = committed.map((n: InvoiceNumber) => n.sequence).sort((x, y) => x - y);
  expect(seqs).toEqual(Array.from({ length: committed.length }, (_, i) => i + 1));
  expect(new Set(committed.map((n) => n.number)).size).toBe(committed.length);
  const row = await prisma.invoiceSequence.findUniqueOrThrow({ where: { financialYear: financialYear(at) } });
  expect(row.lastNumber).toBe(committed.length);
});

it('restarts at 1 on 1 April IST', async () => {
  const y = year();
  // 31-Mar 23:59:59 IST and 01-Apr 00:00 IST — both 31 March in UTC.
  const lastMoment = track(new Date(`${y}-03-31T18:29:59Z`));
  const firstMoment = track(new Date(`${y}-03-31T18:30:00Z`));
  const old1 = await prisma.$transaction((tx) => numbers.next(tx, null, lastMoment));
  const old2 = await prisma.$transaction((tx) => numbers.next(tx, null, lastMoment));
  const fresh = await prisma.$transaction((tx) => numbers.next(tx, null, firstMoment));
  const yy = (n: number) => String(n % 100).padStart(2, '0');

  expect([old1.financialYear, old2.sequence]).toEqual([`${y - 1}-${yy(y)}`, 2]);
  expect(fresh).toEqual({ financialYear: `${y}-${yy(y + 1)}`, sequence: 1, number: `BN/${yy(y)}${yy(y + 1)}/000001` });
});
