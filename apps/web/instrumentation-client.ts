import { scrubSentryEvent } from './src/lib/sentry-scrub';

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN ?? '';
if (dsn.length > 0) {
  void import('@sentry/nextjs').then((Sentry) => {
    Sentry.init({ dsn, enabled: true, tracesSampleRate: 0, beforeSend: scrubSentryEvent });
  });
}
