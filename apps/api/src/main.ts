import 'reflect-metadata';
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule, type OpenAPIObject } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { env } from './config/env';
import { addZodComponents } from './common/openapi';

export function configureApp(app: NestExpressApplication) {
  const cfg = env();
  app.setGlobalPrefix('api');
  app.set('trust proxy', 1); // behind load balancer / Next.js rewrite: use X-Forwarded-For for rate limits
  app.use(helmet({ contentSecurityPolicy: cfg.NODE_ENV === 'production' ? undefined : false }));
  app.use(cookieParser());
  app.enableCors({ origin: cfg.CORS_ORIGINS.split(',').map((o) => o.trim()), credentials: true });
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
  // rawBody keeps the exact request bytes on `req.rawBody`: payment webhook signatures are checked over them.
  const app = configureApp(await NestFactory.create<NestExpressApplication>(AppModule, { rawBody: true }));

  if (cfg.NODE_ENV !== 'production') SwaggerModule.setup('api/docs', app, buildOpenApiDocument(app));

  await app.listen(cfg.PORT);
  Logger.log(`API ready on http://localhost:${cfg.PORT}/api  (docs: /api/docs)`, 'Bootstrap');
}

if (require.main === module) bootstrap();
