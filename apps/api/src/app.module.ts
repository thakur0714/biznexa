import { Controller, Get, Module, ServiceUnavailableException } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { env } from './config/env';
import { PrismaModule, PrismaService } from './prisma/prisma.service';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { CatalogueModule } from './catalogue/catalogue.module';
import { CertificatesModule } from './certificates/certificates.module';
import { LeadsModule } from './leads/leads.module';
import { MediaModule } from './media/media.module';
import { CmsModule } from './cms/cms.module';
import { QueueModule, QueueService } from './queue/queue.service';
import { EventsModule } from './events/event-bus';
import { FilesModule } from './files/files.module';
import { PdfModule } from './pdf/pdf.module';
import { BusinessEntitiesModule } from './business-entities/business-entities.module';
import { ApplicationsModule } from './applications/applications.module';
import { CouponsModule } from './coupons/coupons.module';
import { SettingsModule } from './settings/settings.module';
import { PaymentsModule } from './payments/payments.module';
import { InvoicesModule } from './invoices/invoices.module';
import { NotificationsModule } from './notifications/notifications.module';
import { CustomersModule } from './customers/customers.module';
import { AuthGuard } from './common/auth.guard';
import { Public } from './common/auth.decorators';
import { PrismaExceptionFilter } from './common/prisma-exception.filter';
import { SentryExceptionInterceptor } from './common/sentry-exception.interceptor';
import { DashboardModule } from './dashboard/dashboard.module';
import { RemindersModule } from './reminders/reminders.module';
import { TicketsModule } from './tickets/tickets.module';
import { ReportsModule } from './reports/reports.module';
import { ConsultantsModule } from './consultants/consultants.module';
import { BookingsModule } from './bookings/bookings.module';
import { PrivacyModule } from './privacy/privacy.module';
import { BlogModule } from './blog/blog.module';
import { ReviewsModule } from './reviews/reviews.module';

@ApiTags('health')
@Controller('health')
class HealthController {
  constructor(private readonly prisma: PrismaService, private readonly queues: QueueService) {}

  @Public()
  @Get()
  async health() {
    await this.prisma.$queryRaw`SELECT 1`;
    if (!(await this.queues.ping())) throw new ServiceUnavailableException('Redis is unreachable');
    return { status: 'ok', time: new Date().toISOString() };
  }

  @Public()
  @Get('ready')
  async readiness() {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      throw new ServiceUnavailableException('Database is unreachable');
    }
    if (!(await this.queues.ping())) throw new ServiceUnavailableException('Redis is unreachable');
    return { status: 'ready' };
  }
}

@ApiTags('mobile')
@Controller('mobile')
class MobileVersionController {
  constructor(private readonly prisma: PrismaService) {}

  @Public()
  @ApiOkResponse({ schema: { type: 'object', properties: { minSupportedVersion: { type: 'string' } }, required: ['minSupportedVersion'] } })
  @Get('version')
  async version() {
    const setting = await this.prisma.setting.findUnique({ where: { key: 'mobile.minSupportedVersion' }, select: { value: true } });
    const value = setting?.value;
    return { minSupportedVersion: typeof value === 'string' ? value : '1.0.0' };
  }
}

@Module({
  imports: [
    JwtModule.register({
      global: true,
      secret: env().JWT_ACCESS_SECRET,
      signOptions: { expiresIn: env().JWT_ACCESS_TTL as unknown as number, issuer: 'biznexa' },
      verifyOptions: { issuer: 'biznexa' },
    }),
    ThrottlerModule.forRoot({
      throttlers: [{ name: 'default', ttl: 60_000, limit: 120 }],
      // Automated tests make many auth calls from one IP. rate-limits.e2e-spec turns limits back on with
      // THROTTLE_IN_TESTS=1 to check them. E2E_DISABLE_THROTTLE lets the browser suite (API runs as development)
      // skip them too; never honoured in production.
      skipIf: () =>
        (process.env.NODE_ENV === 'test' && process.env.THROTTLE_IN_TESTS !== '1') ||
        (process.env.E2E_DISABLE_THROTTLE === '1' && process.env.NODE_ENV !== 'production'),
    }),
    ScheduleModule.forRoot(),
    PrismaModule,
    QueueModule,
    EventsModule,
    AuditModule,
    FilesModule,
    PdfModule,
    AuthModule,
    CatalogueModule,
    CertificatesModule,
    BusinessEntitiesModule,
    ApplicationsModule,
    CouponsModule,
    SettingsModule,
    PaymentsModule,
    InvoicesModule,
    NotificationsModule,
    CustomersModule,
    LeadsModule,
    CmsModule,
    MediaModule,
    DashboardModule,
    RemindersModule,
    TicketsModule,
    ReportsModule,
    ConsultantsModule,
    BookingsModule,
    PrivacyModule,
    BlogModule,
    ReviewsModule,
  ],
  controllers: [HealthController, MobileVersionController],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_FILTER, useClass: PrismaExceptionFilter },
    { provide: APP_INTERCEPTOR, useClass: SentryExceptionInterceptor },
  ],
})
export class AppModule {}
