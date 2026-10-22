/** Queue infrastructure against a real Redis (QUEUE_PREFIX=bn-test-<checkout>-<worker>). No database needed. */
import { Test, TestingModule } from '@nestjs/testing';
import { UnrecoverableError, type Job } from 'bullmq';
import { DEAD_LETTER_QUEUE, QUEUE_OPTIONS, QueueModule, QueueService } from '../src/queue/queue.service';

let mod: TestingModule;
let queues: QueueService;
const run = Date.now().toString(36);
const used: string[] = [];
const qname = (label: string) => {
  const name = `test-${label}-${run}`;
  used.push(name);
  return name;
};
/** Fast retries for tests; production uses DEFAULT_JOB_OPTIONS (exponential from 5 s). */
const fast = { backoff: { type: 'fixed', delay: 20 } } as const;

async function waitFor<T>(check: () => Promise<T | undefined>, ms = 8000): Promise<T> {
  const until = Date.now() + ms;
  for (;;) {
    const value = await check(); // NOSONAR: test steps run in order
    if (value !== undefined) return value;
    if (Date.now() > until) throw new Error('Timed out waiting for condition');
    await new Promise((r) => setTimeout(r, 25)); // NOSONAR: test steps run in order
  }
}
const deadLetterFor = (queue: string) => () => queues.deadLetters().then((all) => all.find((d) => d.queue === queue));

beforeAll(async () => {
  mod = await Test.createTestingModule({ imports: [QueueModule] }).compile();
  queues = mod.get(QueueService);
  expect(await queues.ping()).toBe(true);
});

afterAll(async () => {
  for (const name of [...used, DEAD_LETTER_QUEUE]) await queues.queue(name).obliterate({ force: true }); // NOSONAR: test steps run in order
  await mod.close();
});

it('runs a job that fails once, retries, and succeeds', async () => {
  const name = qname('retry');
  const attempts: number[] = [];
  const worker = queues.process<{ n: number }, number>(name, (job) => {
    attempts.push(job.attemptsMade);
    if (job.attemptsMade === 0) return Promise.reject(new Error('Temporary glitch'));
    return Promise.resolve(job.data.n * 2);
  });
  const completed = new Promise<[Job, number]>((resolve) => worker.on('completed', (job, result) => resolve([job, result])));

  const job = await queues.queue<{ n: number }>(name, fast).add('double', { n: 21 });
  expect(job.opts.attempts).toBe(5); // defaults still apply alongside the override

  const [done, result] = await completed;
  expect(result).toBe(42);
  expect(attempts).toEqual([0, 1]);
  expect(done.failedReason).toBe('Temporary glitch');
  expect(await (await queues.queue(name).getJob(job.id!))!.getState()).toBe('completed');
  expect(await deadLetterFor(name)()).toBeUndefined();
});

it('moves a job that fails every attempt to the dead-letter queue, and can requeue it', async () => {
  const name = qname('dead');
  let healthy = false;
  let calls = 0;
  const worker = queues.process<{ invoice: string }>(name, (job) => {
    calls++;
    if (!healthy) return Promise.reject(new Error(`Gateway down for ${job.data.invoice}`));
    return Promise.resolve('sent');
  });

  await queues.queue(name, { ...fast, attempts: 3 }).add('send', { invoice: 'INV-1' });
  const dead = await waitFor(deadLetterFor(name));
  expect(calls).toBe(3);
  expect(dead).toMatchObject({ queue: name, name: 'send', data: { invoice: 'INV-1' }, failedReason: 'Gateway down for INV-1', attemptsMade: 3 });
  expect(dead.stacktrace.length).toBeGreaterThan(0);

  healthy = true;
  const completed = new Promise<string>((resolve) => worker.on('completed', (_job, result) => resolve(result as string)));
  const requeued = await queues.requeueDeadLetter(dead.id);
  expect(requeued?.data).toEqual({ invoice: 'INV-1' });
  expect(await completed).toBe('sent');
  expect(await deadLetterFor(name)()).toBeUndefined();
  expect(await queues.requeueDeadLetter(dead.id)).toBeNull();
});

it('does not retry an UnrecoverableError', async () => {
  const name = qname('fatal');
  let calls = 0;
  queues.process(name, () => {
    calls++;
    return Promise.reject(new UnrecoverableError('Customer deleted'));
  });
  await queues.queue(name, fast).add('notify', {});
  const dead = await waitFor(deadLetterFor(name));
  expect(calls).toBe(1);
  expect(dead).toMatchObject({ failedReason: 'Customer deleted', attemptsMade: 1 });
});

it('reports Redis as unreachable instead of hanging', async () => {
  const down = await Test.createTestingModule({ providers: [QueueService, { provide: QUEUE_OPTIONS, useValue: { redisUrl: 'redis://127.0.0.1:1' } }] }).compile();
  down.useLogger(false);
  const svc = down.get(QueueService);
  const started = Date.now();
  expect(await svc.ping(300)).toBe(false);
  expect(Date.now() - started).toBeLessThan(2000);
  await down.close();
  // close() returns at once, but ioredis keeps one reconnect timer (backoff capped at 2 s) before it notices; let it lapse.
  await new Promise((r) => setTimeout(r, 2100));
});
