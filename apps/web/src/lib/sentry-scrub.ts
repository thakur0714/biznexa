import type { Event } from '@sentry/nextjs';

const clean = (value: string) => value
  .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[email]')
  .replace(/(?<![\w-])(?:\+?91[ -]?)?[6-9]\d{9}(?![\w-])/g, '[mobile]')
  .replace(/\beyJ[\w-]+\.[\w-]+\.[\w-]+/g, '[token]');

export function scrubSentryEvent<T extends Event>(event: T): T | null {
  event.user = undefined;
  event.extra = undefined;
  event.tags = undefined;
  event.contexts = undefined;
  event.transaction = event.transaction ? clean(event.transaction) : undefined;
  event.message = event.message ? clean(event.message) : undefined;
  if (event.request) {
    event.request = {
      url: event.request.url ? clean(event.request.url.split('?')[0].split('#')[0]) : undefined,
      method: event.request.method,
    };
  }
  for (const exception of event.exception?.values ?? []) {
    if (exception.value) exception.value = clean(exception.value);
  }
  event.breadcrumbs = undefined;
  return event;
}
