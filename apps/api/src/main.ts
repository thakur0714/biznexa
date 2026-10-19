import 'reflect-metadata';
import 'dotenv/config';
import * as Sentry from '@sentry/nestjs';
import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule, type OpenAPIObject } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { env } from './config/env';
import { addZodComponents } from './common/openapi';
import { RedactingLogger, redactString } from './common/redacting-logger';
import { corsOrigins, helmetOptions, refreshCookieOriginCheck } from './common/security';
import { REFRESH_COOKIE } from './auth/auth.controller';

export function configureApp(app: NestExpressApplication) {
  const cfg = env();
  app.setGlobalPrefix('api');
  app.set('trust proxy', 1); // behind load balancer / Next.js rewrite: use X-Forwarded-For for rate limits
  const origins = corsOrigins(cfg.CORS_ORIGINS);
  app.use(helmet(helmetOptions(cfg.NODE_ENV)));
  app.use((req: Request, res: Response, next: NextFunction) => {
    const requestId = randomUUID();
    const started = Date.now();
    res.setHeader('X-Request-Id', requestId);
    // One line per request; not in tests, where it would print thousands of lines.
    if (cfg.NODE_ENV !== 'test') res.on('finish', () => {
      process.stdout.write(`${JSON.stringify({ timestamp: new Date().toISOString(), level: 'info', message: 'http_request', requestId, method: req.method, path: redactString(req.path), statusCode: res.statusCode, durationMs: Date.now() - started })}\n`);
    });
    next();
  });
  app.use(cookieParser());
  app.use('/api/auth', refreshCookieOriginCheck(REFRESH_COOKIE, origins));
  app.enableCors({ origin: origins, credentials: true });
  app.enableShutdownHooks();
  return app;
}

/** The OpenAPI document served at /api/docs and written to packages/api-client by `pnpm --filter @biznexa/api openapi`. */
export function buildOpenApiDocument(app: NestExpressApplication): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle('BizNexa API')
    .setDescription('Business services & compliance platform. All amounts are in paise.')
    .setVersion('0.1.0')
    .addBearerAuth()
    .build();
  return addZodComponents(SwaggerModule.createDocument(app, config));
}

async function bootstrap() {
  const cfg = env();
  Sentry.init({
    dsn: cfg.SENTRY_DSN,
    enabled: cfg.SENTRY_DSN.length > 0,
    tracesSampleRate: 0,
    integrations: [Sentry.nestIntegration()],
    beforeSend(event) {
      event.user = undefined;
      if (event.request) {
        event.request = { ...event.request, url: event.request.url ? redactString(event.request.url.split('?')[0]) : undefined, headers: undefined, cookies: undefined, data: undefined, query_string: undefined };
      }
      event.breadcrumbs = undefined;
      event.extra = undefined;
      event.tags = undefined;
      event.contexts = undefined;
      event.message = event.message ? redactString(event.message) : undefined;
      event.transaction = event.transaction ? redactString(event.transaction) : undefined;
      for (const exception of event.exception?.values ?? []) {
        if (exception.value) exception.value = redactString(exception.value);
      }
      return event;
    },
  });
  // rawBody keeps the exact request bytes on `req.rawBody`: payment webhook signatures are checked over them.
  // RedactingLogger scrubs emails, mobiles, PANs and tokens from every log line (M12.2); JSON lines in production (M12.8).
  const logger = new RedactingLogger({ json: cfg.NODE_ENV === 'production' });
  const app = configureApp(await NestFactory.create<NestExpressApplication>(AppModule, { rawBody: true, logger }));

  if (cfg.NODE_ENV !== 'production') SwaggerModule.setup('api/docs', app, buildOpenApiDocument(app));

  await app.listen(cfg.PORT);
  Logger.log(`API ready on http://localhost:${cfg.PORT}/api  (docs: /api/docs)`, 'Bootstrap');
}

if (require.main === module) bootstrap();
