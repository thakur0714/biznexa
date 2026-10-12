import { Global, Module } from '@nestjs/common';
import { env } from '../config/env';
import { PdfRenderer, PlaywrightPdfRenderer, StubPdfRenderer } from './pdf-renderer';
import { PdfService } from './pdf.service';

/** HTML → PDF as a queue job (M3.22, D49). Global so invoices (M3.23) and certificates (M7.3) register their kinds. */
@Global()
@Module({
  providers: [{ provide: PdfRenderer, useFactory: () => (env().PDF_RENDERER === 'stub' ? new StubPdfRenderer() : new PlaywrightPdfRenderer()) }, PdfService],
  exports: [PdfService, PdfRenderer],
})
export class PdfModule {}
