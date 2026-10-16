import { Controller, Get, Module, ServiceUnavailableException } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { ApiTags } from '@nestjs/swagger';
import { env } from './config/env';
import { PrismaModule, PrismaService } from './prisma/prisma.service';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { CatalogueModule } from './catalogue/catalogue.module';
import { CertificatesModule } from './certificates/certificates.module';
import { LeadsModule } from './leads/leads.module';
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
import { DashboardModule } from './dashboard/dashboard.module';

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
      // Automated tests make many auth calls from one IP; rate limits are covered by OTP rules and staging tests.
      skipIf: () => process.env.NODE_ENV === 'test',
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
    DashboardModule,
  ],
  controllers: [HealthController],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_FILTER, useClass: PrismaExceptionFilter },
  ],
})
export class AppModule {}
