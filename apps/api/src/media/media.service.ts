import { Inject, Injectable, Logger, UnsupportedMediaTypeException } from '@nestjs/common';
import { Readable } from 'node:stream';
import { MEDIA_IMAGE_TYPES, MEDIA_PATH_PREFIX, mediaTypeFromName, type MediaImage } from '@biznexa/types';
import { AuditService } from '../audit/audit.service';
import { newFileKey, StorageService } from '../files/storage.service';
import { detectImageType, reencodeImage } from './image';

/** DI token for the public media store (a separate StorageService from the private uploads). */
export const MEDIA_STORAGE = Symbol('MEDIA_STORAGE');

/** `ab/<32 hex>.webp` — what follows MEDIA_PATH_PREFIX in a media URL. */
export const MEDIA_KEY_FORMAT = /^[0-9a-f]{2}\/[0-9a-f]{32}\.(?:jpg|png|webp|gif)$/;

const CONTENT_TYPES: Record<string, string> = Object.fromEntries(Object.entries(MEDIA_IMAGE_TYPES).map(([mime, t]) => [t.ext, mime]));
export const contentTypeForKey = (key: string) => CONTENT_TYPES[key.slice(key.lastIndexOf('.') + 1)];

@Injectable()
export class MediaService {
  private readonly logger = new Logger('Media');

  constructor(
    @Inject(MEDIA_STORAGE) private readonly storage: StorageService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Check the bytes really are the image the name claims, re-encode them (no metadata survives) and
   * store the result under a new random key. Only the re-encoded image is ever written.
   */
  async store(file: { originalname: string; buffer: Buffer }, actorId: string): Promise<MediaImage> {
    const claimed = mediaTypeFromName(file.originalname);
    if (!claimed || detectImageType(file.buffer) !== claimed) {
      const label = claimed ? MEDIA_IMAGE_TYPES[claimed].label : 'image';
      throw new UnsupportedMediaTypeException(`This file is not a real ${label} image. Please upload the original picture.`);
    }

    let image: Awaited<ReturnType<typeof reencodeImage>>;
    try {
      image = await reencodeImage(file.buffer, claimed);
    } catch (err) {
      this.logger.warn(`Could not re-encode ${claimed}: ${err instanceof Error ? err.message : err}`);
      throw new UnsupportedMediaTypeException('This image could not be read. It may be damaged or too large in pixels.');
    }

    const key = `${newFileKey()}.${MEDIA_IMAGE_TYPES[claimed].ext}`;
    await this.storage.write(key, Readable.from(image.data));
    const result: MediaImage = { url: MEDIA_PATH_PREFIX + key, mimeType: claimed, sizeBytes: image.data.length, width: image.width, height: image.height };
    await this.audit.log({ actorId, action: 'media.uploaded', entityType: 'MediaImage', entityId: key, after: result });
    return result;
  }

  /** Open a stored image; NotFoundException for a key that does not exist. */
  open(key: string) {
    return this.storage.read(key);
  }
}
