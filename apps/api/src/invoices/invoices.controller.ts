import { Controller, Get, Header, HttpCode, Param, ParseUUIDPipe, Post, Query, StreamableFile } from '@nestjs/common';
import { ApiBearerAuth, ApiProduces, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { fileLinkSchema, invoiceListQuery, invoiceListSchema, type InvoiceListQuery } from '@biznexa/types';
import { AuthUser, CurrentUser, CustomerOnly, Public, SignedIn } from '../common/auth.decorators';
import { ApiZodResponse, ZodQuery } from '../common/openapi';
import { InvoicePdfService } from './invoice-pdf.service';

const linkQuery = z.object({
  disposition: z.enum(['attachment', 'inline']).default('attachment').describe('inline = open in the browser'),
});

/** The signed-in customer's invoices and their PDFs (M3.23). */
@ApiTags('invoices')
@Controller('invoices')
export class InvoicesController {
  constructor(private readonly invoices: InvoicePdfService) {}

  @ApiBearerAuth()
  @ApiZodResponse('InvoiceList', invoiceListSchema)
  @Get()
  @CustomerOnly()
  list(@ZodQuery(invoiceListQuery) q: InvoiceListQuery, @CurrentUser() user: AuthUser) {
    return this.invoices.list(user.id, q.applicationId);
  }

  /** The customer the invoice was issued to, or staff with `payments.view`. */
  @ApiBearerAuth()
  @ApiZodResponse('FileLink', fileLinkSchema)
  @ApiResponse({ status: 404, description: 'No such invoice among yours (another customer’s invoice looks the same)' })
  @ApiResponse({ status: 409, description: 'The PDF is still being generated — try again shortly' })
  @HttpCode(200)
  @Post(':id/link')
  @SignedIn()
  link(@Param('id', new ParseUUIDPipe()) id: string, @ZodQuery(linkQuery) q: z.infer<typeof linkQuery>, @CurrentUser() user: AuthUser) {
    return this.invoices.createLink(id, user, q.disposition);
  }

  /** The signed link itself: no login, the signature and expiry are the permission. */
  @Public()
  @ApiQuery({ name: 'e', description: 'Expiry (unix seconds)' })
  @ApiQuery({ name: 'd', required: false, enum: ['attachment', 'inline'] })
  @ApiQuery({ name: 's', description: 'Signature' })
  @ApiProduces('application/pdf')
  @Header('X-Content-Type-Options', 'nosniff')
  @Header('Cache-Control', 'private, no-store')
  @Header('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox")
  @Get(':id/download')
  async download(@Param('id', new ParseUUIDPipe()) id: string, @Query() q: { e?: string; d?: string; s?: string }) {
    const { stream, size, disposition } = await this.invoices.openLinked(id, q);
    return new StreamableFile(stream, { type: 'application/pdf', length: size, disposition });
  }
}
