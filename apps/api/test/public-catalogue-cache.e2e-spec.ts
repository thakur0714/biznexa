import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/main';
import { EventBus } from '../src/events/event-bus';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Public catalogue cache', () => {
  const slug = `cache-service-${randomUUID()}`;
  let app: INestApplication;
  let prisma: PrismaService;
  let serviceId: string;

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(module.createNestApplication<NestExpressApplication>());
    await app.init();
    prisma = app.get(PrismaService);
    const category = await prisma.category.findUniqueOrThrow({ where: { slug: 'company-registration' } });
    const service = await prisma.service.create({
      data: { slug, categoryId: category.id, name: 'Cache Test Service', shortDescription: 'Before event' },
    });
    serviceId = service.id;
  });

  afterAll(async () => {
    await prisma.service.deleteMany({ where: { id: serviceId } });
    await app.close();
  });

  it('serves cached service detail and refreshes it after catalogue.changed', async () => {
    const findFirst = jest.spyOn(prisma.service, 'findFirst');
    const path = `/api/catalogue/services/${slug}`;
    const first = await request(app.getHttpServer()).get(path).expect(200);
    const second = await request(app.getHttpServer()).get(path).expect(200);
    expect(second.body).toEqual(first.body);
    expect(findFirst).toHaveBeenCalledTimes(1);

    await prisma.service.update({ where: { id: serviceId }, data: { shortDescription: 'After event' } });
    await app.get(EventBus).emit('catalogue.changed', { entityType: 'service' });
    const refreshed = await request(app.getHttpServer()).get(path).expect(200);
    expect(refreshed.body.shortDescription).toBe('After event');
    expect(findFirst).toHaveBeenCalledTimes(2);
    findFirst.mockRestore();
  });
});
