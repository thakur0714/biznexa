/**
 * PDF generation service (M3.22): a registered document kind is rendered by the `pdf` queue worker, stored
 * through `StorageService` and attached to its record once, however often it is queued. Uses a kind of its
 * own with records kept in memory, and the configured renderer (headless Chromium unless PDF_RENDERER=stub).
 */
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { UnrecoverableError } from 'bullmq';
import type { AnyDomainEvent } from '@biznexa/types';
import { AppModule } from '../src/app.module';
import { EventBus } from '../src/events/event-bus';
import { StorageService } from '../src/files/storage.service';
import { PdfRenderError, PdfRenderer } from '../src/pdf/pdf-renderer';
import { PdfService, type PdfDocument } from '../src/pdf/pdf.service';

let app: INestApplication;
let pdfs: PdfService;
let storage: StorageService;
let renderer: PdfRenderer;
let events: AnyDomainEvent[] = [];

const KIND = `e2e-${Date.now().toString(36)}`;
/** The records: id → stored PDF key (null until attached). Missing id = deleted record. */
const records = new Map<string, string | null>();
const written: string[] = [];

const doc: PdfDocument = {
  existing: async (id) => records.get(id) ?? null,
  source: async (id) => (records.has(id) ? { html: `<!doctype html><h1>Record ${id}</h1><p>Total ₹1,180</p>` } : null),
  attach: async (id, fileKey) => {
    if (!records.has(id) || records.get(id)) return false;
    records.set(id, fileKey);
    return true;
  },
  missing: async () => [...records].filter(([, key]) => !key).map(([id]) => id),
};

async function bytes(key: string) {
  const { stream } = await storage.read(key);
  const chunks: Buffer[] = [];
  for await (const c of stream) chunks.push(c as Buffer);
  return Buffer.concat(chunks);
}

/** Waits for the worker (polling the record), up to `ms`. */
async function attached(id: string, ms = 20_000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (records.get(id)) return records.get(id)!;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`No PDF attached to ${id} within ${ms} ms`);
}

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  pdfs = app.get(PdfService);
  storage = app.get(StorageService);
  renderer = app.get(PdfRenderer);
  // Registered before start-up, like a feature module's onModuleInit: this record has no PDF yet.
  records.set('left-over', null);
  pdfs.register(KIND, doc);
  const write = storage.write.bind(storage);
  jest.spyOn(storage, 'write').mockImplementation(async (key, data) => {
    written.push(key);
    return write(key, data);
  });
  // Only this suite's kind: invoices without a PDF (M3.23) are queued at start-up too.
  app.get(EventBus).onAny((e) => void ((e.name !== 'pdf.generated' || e.payload.kind === KIND) && events.push(e)));
  await app.init();
});

beforeEach(() => {
  events = [];
});

afterAll(async () => {
  jest.restoreAllMocks();
  for (const key of written) await storage.remove(key);
  await app.close();
});

describe('PDF generation (M3.22)', () => {
  it('queues records still without a PDF when the app starts', async () => {
    const key = await attached('left-over');
    expect((await bytes(key)).subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('a queued record is rendered, stored and attached, then announced', async () => {
    records.set('a', null);
    pdfs.enqueue(KIND, 'a');
    const key = await attached('a');
    const pdf = await bytes(key);
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    await new Promise((r) => setTimeout(r, 50));
    expect(events.filter((e) => e.name === 'pdf.generated').map((e) => e.payload)).toContainEqual({ kind: KIND, id: 'a', fileKey: key, sizeBytes: pdf.length });
  });

  it('is idempotent: queued many times, one file; a record with its PDF is skipped', async () => {
    records.set('b', null);
    for (let i = 0; i < 5; i++) pdfs.enqueue(KIND, 'b');
    const key = await attached('b');
    await new Promise((r) => setTimeout(r, 500));
    expect(records.get('b')).toBe(key);
    expect(events.filter((e) => e.name === 'pdf.generated' && e.payload.id === 'b')).toHaveLength(1);
    const before = written.length;
    expect(await pdfs.generate(KIND, 'b')).toBe('exists');
    expect(written.length).toBe(before);
  });

  it('a run that loses the race deletes the file it made', async () => {
    records.set('c', null);
    const race = jest.spyOn(doc, 'attach').mockImplementationOnce(async (id) => {
      records.set(id, 'aa/00000000000000000000000000000000'); // someone else's key, attached first
      return false;
    });
    expect(await pdfs.generate(KIND, 'c')).toBe('exists');
    race.mockRestore();
    await expect(storage.read(written.at(-1)!)).rejects.toThrow('File not found');
    expect(events).toEqual([]);
  });

  it('a deleted record ends quietly; renderer failures retry, broken templates do not', async () => {
    expect(await pdfs.generate(KIND, 'gone')).toBe('missing');

    records.set('d', null);
    const render = jest.spyOn(renderer, 'render');
    render.mockRejectedValueOnce(new Error('Browser crashed'));
    await expect(pdfs.generate(KIND, 'd')).rejects.toThrow('Browser crashed');
    render.mockRejectedValueOnce(new PdfRenderError('Nothing to render'));
    await expect(pdfs.generate(KIND, 'd')).rejects.toBeInstanceOf(UnrecoverableError);
    expect(records.get('d')).toBeNull();
    render.mockRestore();
    expect(await pdfs.generate(KIND, 'd')).toBe('generated');

    await expect(pdfs.generate('no-such-kind', 'x')).rejects.toBeInstanceOf(UnrecoverableError);
    expect(() => pdfs.enqueue('no-such-kind', 'x')).toThrow('Unknown PDF kind');
    expect(() => pdfs.register(KIND, doc)).toThrow('already registered');
    expect(() => pdfs.register('Bad Kind', doc)).toThrow();
  });
});
