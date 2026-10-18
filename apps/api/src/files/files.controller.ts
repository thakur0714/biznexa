import { Controller, Get, Header, HttpCode, Param, ParseUUIDPipe, Post, Query, Req, StreamableFile, UseInterceptors } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiProduces, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { z } from 'zod';
import { fileLinkSchema, storedFileSchema } from '@biznexa/types';
import { AuthUser, CurrentUser, Public } from '../common/auth.decorators';
import { ApiZodResponse, ZodQuery } from '../common/openapi';
import { UPLOAD_LIMIT } from '../common/rate-limits';
import { FilesService } from './files.service';
import { UploadInterceptor, type UploadRequest } from './upload.interceptor';

const linkQuery = z.object({
  disposition: z.enum(['attachment', 'inline']).default('attachment').describe('inline = preview in the browser (PDF/image)'),
});

@ApiTags('files')
@Controller('files')
export class FilesController {
  constructor(private readonly files: FilesService) {}

  @ApiBearerAuth()
  @Throttle(UPLOAD_LIMIT)
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', required: ['file'], properties: { file: { type: 'string', format: 'binary' } } } })
  @ApiQuery({ name: 'requirementId', required: false, description: 'Document requirement whose file types and size limit apply (default: PDF/JPG/PNG, 10 MB)' })
  @ApiZodResponse('StoredFile', storedFileSchema, 201)
  @UseInterceptors(UploadInterceptor)
  @Post()
  upload(@Req() req: UploadRequest, @CurrentUser() user: AuthUser) {
    return this.files.record(req.upload.file, user.id, req.upload.policy);
  }

  @ApiBearerAuth()
  @ApiZodResponse('StoredFile', storedFileSchema)
  @Get(':id')
  get(@Param('id', new ParseUUIDPipe()) id: string, @CurrentUser() user: AuthUser) {
    return this.files.get(id, user);
  }

  /** 409 while the virus scan is pending, 410 when the file was infected. */
  @ApiBearerAuth()
  @ApiZodResponse('FileLink', fileLinkSchema)
  @ApiResponse({ status: 409, description: 'Virus scan still pending — try again shortly' })
  @ApiResponse({ status: 410, description: 'A virus was found; the file was deleted' })
  @HttpCode(200)
  @Post(':id/link')
  link(@Param('id', new ParseUUIDPipe()) id: string, @ZodQuery(linkQuery) q: z.infer<typeof linkQuery>, @CurrentUser() user: AuthUser) {
    return this.files.createLink(id, user, q.disposition);
  }

  /** The signed link itself: no login, the signature and expiry are the permission. */
  @Public()
  @ApiQuery({ name: 'e', description: 'Expiry (unix seconds)' })
  @ApiQuery({ name: 'd', required: false, enum: ['attachment', 'inline'] })
  @ApiQuery({ name: 's', description: 'Signature' })
  @ApiProduces('application/pdf', 'image/jpeg', 'image/png', 'image/webp')
  @Header('X-Content-Type-Options', 'nosniff')
  @Header('Cache-Control', 'private, no-store')
  @Header('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox")
  @Get(':id/download')
  async download(@Param('id', new ParseUUIDPipe()) id: string, @Query() q: { e?: string; d?: string; s?: string }) {
    const { file, stream, size, disposition } = await this.files.openLinked(id, q);
    return new StreamableFile(stream, { type: file.mimeType, length: size, disposition });
  }
}
