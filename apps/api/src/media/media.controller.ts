import {
  BadRequestException,
  Controller,
  Get,
  Injectable,
  NotFoundException,
  Param,
  Post,
  Req,
  Res,
  StreamableFile,
  UnsupportedMediaTypeException,
  UseInterceptors,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiProduces, ApiTags } from '@nestjs/swagger';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import multer from 'multer';
import { MEDIA_MAX_MB, mediaImageSchema, mediaTypeFromName, PERMS } from '@biznexa/types';
import { AuthUser, CurrentUser, Public, RequirePermissions } from '../common/auth.decorators';
import { ApiZodResponse } from '../common/openapi';
import { UPLOAD_LIMIT } from '../common/rate-limits';
import { env } from '../config/env';
import { toHttpError } from '../files/upload.interceptor';
import { contentTypeForKey, MEDIA_KEY_FORMAT, MediaService } from './media.service';

type MediaUploadRequest = Request & { file?: Express.Multer.File };

/**
 * One image in the `file` field, through multer like the document uploads (M2.5.6): the extension
 * must be an accepted image type (the browser's Content-Type is ignored) and the size is capped
 * while streaming. The file is kept in memory — at most a few MB — because it is re-encoded before
 * anything is stored.
 */
@Injectable()
export class MediaUploadInterceptor implements NestInterceptor {
  private readonly maxBytes = Math.min(MEDIA_MAX_MB, env().UPLOAD_MAX_MB) * 1024 * 1024;
  private readonly upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: this.maxBytes, files: 1, fields: 5, fieldSize: 1024, parts: 6 },
    fileFilter: (_req, file, cb) => {
      if (mediaTypeFromName(file.originalname)) return cb(null, true);
      cb(new UnsupportedMediaTypeException('Only JPG, PNG, WebP or GIF images are allowed'));
    },
  }).single('file');

  async intercept(ctx: ExecutionContext, next: CallHandler) {
    const req = ctx.switchToHttp().getRequest<MediaUploadRequest>();
    const res = ctx.switchToHttp().getResponse<Response>();
    await new Promise<void>((resolve, reject) =>
      this.upload(req, res, (err?: unknown) => (err ? reject(toHttpError(err, { maxBytes: this.maxBytes })) : resolve())),
    );
    if (!req.file) throw new BadRequestException('Choose an image to upload');
    return next.handle();
  }
}

@ApiTags('media')
@Controller()
export class MediaController {
  constructor(private readonly media: MediaService) {}

  /** Website image for CMS pages and blog posts. Returns its public URL. */
  @ApiBearerAuth()
  @RequirePermissions(PERMS.CMS_MANAGE)
  @Throttle(UPLOAD_LIMIT)
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', required: ['file'], properties: { file: { type: 'string', format: 'binary' } } } })
  @ApiZodResponse('MediaImage', mediaImageSchema, 201)
  @UseInterceptors(MediaUploadInterceptor)
  @Post('admin/media/images')
  upload(@Req() req: MediaUploadRequest, @CurrentUser() user: AuthUser) {
    return this.media.store(req.file!, user.id);
  }

  /**
   * Public image bytes. Keys are random and never reused, so they can be cached for a year. Only the
   * media store is read here; private uploads live in another folder with another key format.
   */
  @Public()
  @SkipThrottle()
  @ApiProduces('image/jpeg', 'image/png', 'image/webp', 'image/gif')
  @Get('media/:shard/:name')
  async get(@Param('shard') shard: string, @Param('name') name: string, @Res({ passthrough: true }) res: Response) {
    const key = `${shard}/${name}`;
    if (!MEDIA_KEY_FORMAT.test(key)) throw new NotFoundException('Image not found');
    const { stream, size } = await this.media.open(key);
    // Set only once the image exists, so a 404 is never cached for a year.
    res.set({
      'Cache-Control': 'public, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
      'Cross-Origin-Resource-Policy': 'cross-origin',
    });
    return new StreamableFile(stream, { type: contentTypeForKey(key), length: size, disposition: 'inline' });
  }
}
