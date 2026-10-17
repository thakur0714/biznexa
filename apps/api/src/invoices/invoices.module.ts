import { Module } from '@nestjs/common';
import { SettingsModule } from '../settings/settings.module';
import { CreditNotePdfService } from './credit-note-pdf.service';
import { CreditNotesController } from './credit-notes.controller';
import { CreditNotesService } from './credit-notes.service';
import { InvoiceNumbersService } from './invoice-numbers.service';
import { InvoicePdfService } from './invoice-pdf.service';
import { InvoicesController } from './invoices.controller';
import { InvoicesService } from './invoices.service';

@Module({
  imports: [SettingsModule],
  controllers: [InvoicesController, CreditNotesController],
  providers: [InvoiceNumbersService, InvoicesService, InvoicePdfService, CreditNotesService, CreditNotePdfService],
  exports: [InvoiceNumbersService, InvoicesService, InvoicePdfService, CreditNotesService, CreditNotePdfService],
})
export class InvoicesModule {}
