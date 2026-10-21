import { Global, Injectable, Module, OnModuleDestroy } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, Prisma } from '../generated/prisma/client';
import { env } from '../config/env';

type QueryLogOptions = Prisma.PrismaClientOptions & { log: [] | [{ emit: 'event'; level: 'query' }] };

@Injectable()
export class PrismaService extends PrismaClient<QueryLogOptions, 'query'> implements OnModuleDestroy {
  constructor() {
    const timing = process.env.PRISMA_QUERY_TIMING === 'true';
    super({
      adapter: new PrismaPg({ connectionString: env().DATABASE_URL }),
      log: timing ? [{ emit: 'event', level: 'query' }] : [],
    });
    if (timing) {
      this.$on('query', (event) => {
        // Query text contains SQL placeholders but not parameter values. Never log event.params.
        process.stdout.write(`${JSON.stringify({ level: 'prisma_query', durationMs: event.duration, query: event.query.replaceAll(/\s+/g, ' ').trim() })}\n`);
      });
    }
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}

@Global()
@Module({ providers: [PrismaService], exports: [PrismaService] })
export class PrismaModule {}
