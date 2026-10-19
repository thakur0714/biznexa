import * as Sentry from '@sentry/nextjs';
import { scrubSentryEvent } from './src/lib/sentry-scrub';

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN ?? '';
Sentry.init({ dsn, enabled: dsn.length > 0, tracesSampleRate: 0, beforeSend: scrubSentryEvent });
