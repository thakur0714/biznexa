import { Logger } from '@nestjs/common';
import type { AnyDomainEvent, DomainEvent } from '@biznexa/types';
import { EventBus } from './event-bus';

const payload = { certificateId: 'c1', certificateNumber: 'BNC-1', from: 'ACTIVE', to: 'SUSPENDED', actorId: 'u1', reason: 'Audit due' } as const;

describe('EventBus', () => {
  let bus: EventBus;
  beforeEach(() => {
    bus = new EventBus();
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  it('delivers an event with id and timestamp to listeners of that name only', async () => {
    const got: DomainEvent<'certificate.status_changed'>[] = [];
    const other = jest.fn();
    bus.on('certificate.status_changed', (e) => void got.push(e));
    bus.on('certificate.issued', other);

    const sent = await bus.emit('certificate.status_changed', payload);

    expect(got).toEqual([sent]);
    expect(sent).toMatchObject({ name: 'certificate.status_changed', payload });
    expect(sent.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(Number.isNaN(Date.parse(sent.occurredAt))).toBe(false);
    expect(other).not.toHaveBeenCalled();
  });

  it('waits for async listeners before emit resolves', async () => {
    let done = false;
    bus.on('certificate.status_changed', async () => {
      await new Promise((r) => setTimeout(r, 10));
      done = true;
    });
    await bus.emit('certificate.status_changed', payload);
    expect(done).toBe(true);
  });

  it('sends every event to onAny listeners', async () => {
    const names: string[] = [];
    bus.onAny((e: AnyDomainEvent) => void names.push(e.name));
    await bus.emit('certificate.issued', { certificateId: 'c1', certificateNumber: 'BNC-1', status: 'ACTIVE', actorId: 'u1' });
    await bus.emit('certificate.status_changed', payload);
    expect(names).toEqual(['certificate.issued', 'certificate.status_changed']);
  });

  it('isolates a failing listener: logged, emitter and other listeners unaffected', async () => {
    const ok = jest.fn();
    bus.on('certificate.status_changed', () => {
      throw new Error('sync boom');
    });
    bus.on('certificate.status_changed', () => Promise.reject(new Error('async boom')));
    bus.on('certificate.status_changed', ok);

    await expect(bus.emit('certificate.status_changed', payload)).resolves.toBeDefined();
    expect(ok).toHaveBeenCalledTimes(1);
    expect(Logger.prototype.error).toHaveBeenCalledTimes(2);
  });

  it('stops delivering after unsubscribe', async () => {
    const listener = jest.fn();
    const off = bus.on('certificate.status_changed', listener);
    const offAny = bus.onAny(listener);
    off();
    offAny();
    await bus.emit('certificate.status_changed', payload);
    expect(listener).not.toHaveBeenCalled();
  });
});
