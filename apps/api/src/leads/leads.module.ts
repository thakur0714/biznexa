import { Controller, Get, Injectable, Module, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { z } from 'zod';
import { mobileSchema } from '@biznexa/types';
import { PrismaService } from '../prisma/prisma.service';
import { PERMS, Public, RequirePermissions } from '../common/auth.decorators';
import { ZodBody } from '../common/openapi';

export const leadInput = z.object({
  name: z.string().trim().min(2, 'Enter your name').max(100),
  mobile: mobileSchema,
  email: z.string().trim().email('Enter a valid email').optional().or(z.literal('').transform(() => undefined)),
  city: z.string().trim().max(80).optional(),
  serviceId: z.string().uuid().optional(),
  message: z.string().trim().max(1000).optional(),
  source: z.enum(['service_page', 'contact', 'home', 'consultants']).default('contact'),
});

@Injectable()
export class LeadsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(input: z.infer<typeof leadInput>) {
    await this.prisma.lead.create({ data: input });
    return { message: 'Thanks! An expert will call you within one working day.' };
  }

  list(page: number) {
    return this.prisma.lead.findMany({ orderBy: { createdAt: 'desc' }, skip: (page - 1) * 50, take: 50 });
  }
}

@ApiTags('leads')
@Controller()
export class LeadsController {
  constructor(private readonly leads: LeadsService) {}

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('leads')
  create(@ZodBody(leadInput) body: z.infer<typeof leadInput>) {
    return this.leads.create(body);
  }

  @ApiBearerAuth()
  @RequirePermissions(PERMS.LEADS_VIEW)
  @ApiQuery({ name: 'page', required: false, type: Number })
  @Get('admin/leads')
  list(@Query('page') page = '1') {
    return this.leads.list(Math.max(1, Number(page) || 1));
  }
}

@Module({ controllers: [LeadsController], providers: [LeadsService] })
export class LeadsModule {}
