import { Test } from '@nestjs/testing';
import { Logger } from '@nestjs/common';
import { AdminBlogService } from '../src/blog/blog.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { AuditService } from '../src/audit/audit.service';
import { QueueService } from '../src/queue/queue.service';
import { EventBus } from '../src/events/event-bus';
import { env } from '../src/config/env';

jest.mock('../src/config/env', () => {
  let _env = { REVALIDATE_SECRET: 'test-secret', PUBLIC_WEB_URL: 'http://web' };
  return {
    env: () => _env,
    _setEnv: (e: any) => { _env = e; }
  };
});

// The listener does not hold up emit(), so let its fetch run before checking.
const settle = () => new Promise((resolve) => setImmediate(resolve));

describe('Blog Revalidation', () => {
  let service: AdminBlogService;
  let events: EventBus;
  let prisma: any;
  let originalFetch: typeof global.fetch;

  beforeEach(async () => {
    prisma = {
      blogPost: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'post-1',
          slug: 'my-post',
          categories: [{ category: { slug: 'news' } }],
          tags: [{ slug: 'update' }]
        }),
        findMany: jest.fn().mockResolvedValue([]),
      }
    };

    const module = await Test.createTestingModule({
      providers: [
        AdminBlogService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditService, useValue: {} },
        { provide: QueueService, useValue: { process: jest.fn() } },
        EventBus
      ]
    }).compile();

    service = module.get(AdminBlogService);
    events = module.get(EventBus);
    originalFetch = global.fetch;
    global.fetch = jest.fn().mockResolvedValue({ ok: true });

    await service.onModuleInit();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    require('../src/config/env')._setEnv({ REVALIDATE_SECRET: 'test-secret', PUBLIC_WEB_URL: 'http://web' });
  });

  it('calls web revalidate endpoint when post is changed (rename both slugs)', async () => {
    await events.emit('blog.post_changed', { postId: 'post-1', slug: 'my-post', previousSlug: 'old-slug' });
    await settle();
    expect(global.fetch).toHaveBeenCalledWith('http://web/api/revalidate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-revalidate-secret': 'test-secret' },
      body: JSON.stringify({ slugs: ['my-post', 'old-slug'] }),
      signal: expect.any(AbortSignal)
    });
  });

  it('calls web revalidate endpoint when post deleted', async () => {
    await events.emit('blog.post_changed', { postId: 'post-1', slug: 'deleted-slug' });
    await settle();
    expect(global.fetch).toHaveBeenCalledWith('http://web/api/revalidate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-revalidate-secret': 'test-secret' },
      body: JSON.stringify({ slugs: ['deleted-slug'] }),
      signal: expect.any(AbortSignal)
    });
  });

  it('calls web revalidate endpoint when post scheduled publish', async () => {
    await events.emit('blog.post_changed', { postId: 'post-1', slug: 'scheduled-slug' });
    await settle();
    expect(global.fetch).toHaveBeenCalledWith('http://web/api/revalidate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-revalidate-secret': 'test-secret' },
      body: JSON.stringify({ slugs: ['scheduled-slug'] }),
      signal: expect.any(AbortSignal)
    });
  });

  it('skips if no secret is set', async () => {
    require('../src/config/env')._setEnv({ REVALIDATE_SECRET: '', PUBLIC_WEB_URL: 'http://web' });
    await events.emit('blog.post_changed', { postId: 'post-1', slug: 'my-post' });
    await settle();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('web call throws but the write still succeeds', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('Network error'));
    const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    await expect(events.emit('blog.post_changed', { postId: 'post-1', slug: 'my-post' })).resolves.not.toThrow();
    await settle();
    expect(warnSpy).toHaveBeenCalledWith('Failed to revalidate web: Network error');
    warnSpy.mockRestore();
  });
});
