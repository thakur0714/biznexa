import { Module } from '@nestjs/common';
import { env } from '../config/env';
import { LocalDiskStorage } from '../files/storage.service';
import { MediaController, MediaUploadInterceptor } from './media.controller';
import { MEDIA_KEY_FORMAT, MEDIA_STORAGE, MediaService } from './media.service';

/** Public website images (M9.4, D60): upload with `cms.manage`, served from MEDIA_DIR — never UPLOAD_DIR. */
@Module({
  controllers: [MediaController],
  providers: [
    MediaService,
    MediaUploadInterceptor,
    { provide: MEDIA_STORAGE, useFactory: () => new LocalDiskStorage(env().MEDIA_DIR, MEDIA_KEY_FORMAT) },
  ],
})
export class MediaModule {}
