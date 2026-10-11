/**
 * Writes the OpenAPI document to packages/api-client/openapi.json without a database:
 * `preview` builds the module graph and route metadata but never instantiates providers.
 */
import 'reflect-metadata';
import 'dotenv/config';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from '../src/app.module';
import { buildOpenApiDocument, configureApp } from '../src/main';

async function main() {
  const app = configureApp(await NestFactory.create<NestExpressApplication>(AppModule, { preview: true, logger: ['error'] }));
  const out = resolve(__dirname, '../../../packages/api-client/openapi.json');
  writeFileSync(out, JSON.stringify(buildOpenApiDocument(app), null, 2) + '\n');
  await app.close();
  console.log(`OpenAPI document written to ${out}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
