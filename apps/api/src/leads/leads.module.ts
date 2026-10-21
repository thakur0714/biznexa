import { Controller, Get, Injectable, Module, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { z } from 'zod';
import { leadInputSchema, leadListResponseSchema, leadQuerySchema, type LeadQuery } from '@biznexa/types';
import type { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PERMS, Public, RequirePermissions } from '../common/auth.decorators';
import { ApiZodResponse, ZodBody, ZodQuery } from '../common/openapi';

@Injectable()
export class LeadsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(input: z.infer<typeof leadInputSchema>) {
    await this.prisma.lead.create({ data: input });
    return { message: 'Thanks! An expert will call you within one working day.' };
  }

  async list(query: LeadQuery) {
    const { q, source, from, to, page, limit } = query;
    const where: Prisma.LeadWhereInput = {};

    if (source) {
      where.source = source;
    }
    if (from || to) {
      where.createdAt = {};
      if (from) where.createdAt.gte = new Date(from);
      if (to) where.createdAt.lte = new Date(to);
    }
    if (q) {
      where.OR = [
        { name: { contains: q, mode: 'insensitive' } },
        { mobile: { contains: q, mode: 'insensitive' } },
      ];
    }

    const [items, total] = await Promise.all([
      this.prisma.lead.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.lead.count({ where }),
    ]);

    // Attach service names
    const serviceIds = items.map((i) => i.serviceId).filter(Boolean) as string[];
    const services = serviceIds.length
      ? await this.prisma.service.findMany({
          where: { id: { in: serviceIds } },
          select: { id: true, name: true },
        })
      : [];
    const serviceMap = new Map(services.map((s) => [s.id, s.name]));

    return {
      items: items.map((item) => ({
        ...item,
        createdAt: item.createdAt.toISOString(),
        serviceName: item.serviceId ? serviceMap.get(item.serviceId) ?? null : null,
      })),
      total,
      page,
      limit,
    };
  }
}

@ApiTags('leads')
@Controller()
export class LeadsController {
  constructor(private readonly leads: LeadsService) {}

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('leads')
  create(@ZodBody(leadInputSchema) body: z.infer<typeof leadInputSchema>) {
    return this.leads.create(body);
  }

  @ApiBearerAuth()
  @RequirePermissions(PERMS.LEADS_VIEW)
  @ApiZodResponse('LeadListResponse', leadListResponseSchema)
  @Get('admin/leads')
  list(@ZodQuery(leadQuerySchema) query: LeadQuery) {
    return this.leads.list(query);
  }
}

@Module({ controllers: [LeadsController], providers: [LeadsService] })
export class LeadsModule {}
