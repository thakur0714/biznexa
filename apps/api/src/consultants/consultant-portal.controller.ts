import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PERMS, consultantPortalApplicationsSchema, consultantPortalBookingsSchema, consultantPortalConversationsSchema, consultantPortalEarningsSchema } from '@biznexa/types';
import { AuthUser, CurrentUser, RequirePermissions } from '../common/auth.decorators';
import { ApiZodResponse } from '../common/openapi';
import { PrismaService } from '../prisma/prisma.service';

@ApiTags('consultant portal')
@ApiBearerAuth()
@Controller('consultants/me/portal')
@RequirePermissions(PERMS.ADMIN_ACCESS)
export class ConsultantPortalController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('bookings')
  @ApiZodResponse('ConsultantPortalBookings', consultantPortalBookingsSchema)
  async bookings(@CurrentUser() user: AuthUser) {
    const now = new Date();
    const items = await this.prisma.booking.findMany({
      where: { consultant: { userId: user.id } }, orderBy: [{ startAt: 'desc' }, { id: 'asc' }], take: 100,
      select: { id: true, code: true, status: true, type: true, startAt: true, endAt: true, meetingLink: true, fee: true, customer: { select: { name: true } } },
    });
    return { items: items.map((b) => ({ ...b, startAt: b.startAt.toISOString(), endAt: b.endAt.toISOString(), upcoming: b.endAt >= now && !['CANCELLED', 'NO_SHOW', 'COMPLETED', 'EXPIRED'].includes(b.status), customerName: b.customer.name })) };
  }

  @Get('applications')
  @ApiZodResponse('ConsultantPortalApplications', consultantPortalApplicationsSchema)
  async applications(@CurrentUser() user: AuthUser) {
    const items = await this.prisma.application.findMany({
      where: { assignedToId: user.id }, orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }], take: 100,
      select: { id: true, code: true, status: true, createdAt: true, service: { select: { name: true } }, customerId: true },
    });
    const users = await this.prisma.user.findMany({ where: { id: { in: [...new Set(items.map((i) => i.customerId))] } }, select: { id: true, name: true } });
    const names = new Map(users.map((u) => [u.id, u.name]));
    return { items: items.map((i) => ({ id: i.id, code: i.code, status: i.status, createdAt: i.createdAt.toISOString(), serviceName: i.service.name, customerName: names.get(i.customerId) ?? 'Customer' })) };
  }

  @Get('conversations')
  @ApiZodResponse('ConsultantPortalConversations', consultantPortalConversationsSchema)
  async conversations(@CurrentUser() user: AuthUser) {
    const apps = await this.prisma.application.findMany({
      where: { assignedToId: user.id, conversation: { isNot: null } }, orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }], take: 100,
      select: { id: true, code: true, service: { select: { name: true } }, customerId: true, conversation: { select: { id: true } } },
    });
    const conversationIds = apps.flatMap((a) => a.conversation ? [a.conversation.id] : []);
    const customerIds = [...new Set(apps.map((a) => a.customerId))];
    const unread = conversationIds.length ? await this.prisma.message.groupBy({
      by: ['conversationId'], where: { conversationId: { in: conversationIds }, senderId: { in: customerIds }, readAt: null }, _count: { _all: true },
    }) : [];
    const unreadByConversation = new Map(unread.map((m) => [m.conversationId, m._count._all]));
    return { items: apps.map((a) => ({ applicationId: a.id, applicationCode: a.code, serviceName: a.service.name, unreadCount: a.conversation ? (unreadByConversation.get(a.conversation.id) ?? 0) : 0 })) };
  }

  @Get('earnings')
  @ApiZodResponse('ConsultantPortalEarnings', consultantPortalEarningsSchema)
  async earnings(@CurrentUser() user: AuthUser) {
    const consultant = await this.prisma.consultant.findUnique({ where: { userId: user.id }, select: { id: true, commissionPercent: true } });
    if (!consultant) return { commissionPercent: 0, items: [], monthlyTotals: [] };
    const bookings = await this.prisma.booking.findMany({
      where: { consultantId: consultant.id, status: 'COMPLETED' }, orderBy: [{ startAt: 'desc' }, { id: 'asc' }], take: 500,
      select: { id: true, code: true, fee: true, history: { where: { toStatus: 'COMPLETED' }, orderBy: { createdAt: 'desc' }, take: 1, select: { createdAt: true } } },
    });
    const items = bookings.map((b) => {
      const completedAt = b.history[0]?.createdAt ?? new Date(0);
      const commission = Math.round((b.fee * consultant.commissionPercent) / 100);
      return { bookingId: b.id, code: b.code, completedAt: completedAt.toISOString(), fee: b.fee, commission, net: b.fee - commission };
    });
    const monthOf = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit' }).format(d);
    const totals = new Map<string, { fee: number; commission: number; net: number; bookings: number }>();
    for (const item of items) {
      const month = monthOf(new Date(item.completedAt));
      const row = totals.get(month) ?? { fee: 0, commission: 0, net: 0, bookings: 0 };
      row.fee += item.fee; row.commission += item.commission; row.net += item.net; row.bookings++;
      totals.set(month, row);
    }
    return { commissionPercent: consultant.commissionPercent, items, monthlyTotals: [...totals].map(([month, value]) => ({ month, ...value })) };
  }
}
