import { Module } from '@nestjs/common';
import { SettingsModule } from '../settings/settings.module';
import { InvoiceNumbersService } from './invoice-numbers.service';
import { InvoicePdfService } from './invoice-pdf.service';
import { InvoicesController } from './invoices.controller';
import { InvoicesService } from './invoices.service';

@Module({
  imports: [SettingsModule],
  controllers: [InvoicesController],
  providers: [InvoiceNumbersService, InvoicesService, InvoicePdfService],
  exports: [InvoiceNumbersService, InvoicesService, InvoicePdfService],
})
export class InvoicesModule {}
