import { Global, Injectable, Logger, Module } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { AnyDomainEvent, DomainEvent, DomainEventName, DomainEventPayloads } from '@biznexa/types';

export type DomainEventListener<K extends DomainEventName> = (event: DomainEvent<K>) => unknown;
export type AnyDomainEventListener = (event: AnyDomainEvent) => unknown;

/**
 * In-process domain event bus (PROMPT §10). Event names and payloads are typed in `@biznexa/types`.
 *
 *   await events.emit('certificate.status_changed', { … });       // in a service, after the DB write
 *   events.on('certificate.status_changed', async (e) => …);      // in a listener's onModuleInit
 *
 * `emit` waits for every listener, but a listener that throws is logged and never fails the
 * emitter or the other listeners. Listeners run inside the request, so keep them quick: for slow,
 * retryable or must-not-be-lost work (emails, PDFs, webhooks) enqueue a job (QueueService) and
 * return. Events are not persisted — if the process dies after the DB write, the event is gone.
 */
@Injectable()
export class EventBus {
  private readonly logger = new Logger('Events');
  private readonly listeners = new Map<DomainEventName, Set<DomainEventListener<never>>>();
  private readonly anyListeners = new Set<AnyDomainEventListener>();

  /** Subscribe to one event. Returns an unsubscribe function. */
  on<K extends DomainEventName>(name: K, listener: DomainEventListener<K>): () => void {
    let set = this.listeners.get(name);
    if (!set) this.listeners.set(name, (set = new Set()));
    set.add(listener as DomainEventListener<never>);
    return () => set.delete(listener as DomainEventListener<never>);
  }

  /** Subscribe to every event (automation rules, forwarding to webhooks). Returns an unsubscribe function. */
  onAny(listener: AnyDomainEventListener): () => void {
    this.anyListeners.add(listener);
    return () => this.anyListeners.delete(listener);
  }

  /** Publish an event and wait for all listeners to settle. Never throws because of a listener. */
  async emit<K extends DomainEventName>(name: K, payload: DomainEventPayloads[K]): Promise<DomainEvent<K>> {
    const event: DomainEvent<K> = { name, id: randomUUID(), occurredAt: new Date().toISOString(), payload };
    const targets = [...(this.listeners.get(name) ?? []), ...this.anyListeners] as ((e: DomainEvent<K>) => unknown)[];
    const results = await Promise.allSettled(targets.map(async (listener) => listener(event)));
    for (const r of results) {
      if (r.status === 'rejected') {
        const err = r.reason instanceof Error ? r.reason : new Error(String(r.reason));
        this.logger.error(`Listener for ${name} (${event.id}) failed: ${err.message}`, err.stack);
      }
    }
    return event;
  }
}

@Global()
@Module({ providers: [EventBus], exports: [EventBus] })
export class EventsModule {}
