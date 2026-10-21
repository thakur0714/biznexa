import sharp from 'sharp';
import type { MediaImageType } from '@biznexa/types';
import { detectFileType } from '../files/file-type';

/** Longest side after re-encoding; bigger images are scaled down. */
export const MAX_SIDE = 2400;
/** Refuse decompression bombs: a small file that decodes to a huge bitmap. */
export const MAX_INPUT_PIXELS = 40_000_000;

/** The image type the bytes really are (JPEG/PNG/WebP by the shared signatures, plus GIF). */
export function detectImageType(head: Uint8Array): MediaImageType | null {
  const ascii = Buffer.from(head.subarray(0, 6)).toString('latin1');
  if (ascii === 'GIF87a' || ascii === 'GIF89a') return 'image/gif';
  const type = detectFileType(head);
  return type === 'image/jpeg' || type === 'image/png' || type === 'image/webp' ? type : null;
}

export interface EncodedImage {
  data: Buffer;
  width: number;
  height: number;
}

/**
 * Decode and encode again in the same format: EXIF (GPS, camera), XMP, ICC comments and anything
 * appended after the image data are dropped, the orientation is applied to the pixels, and the
 * longest side is capped at MAX_SIDE. Animated GIF/WebP keep their frames. Throws if sharp cannot
 * decode the file.
 */
export async function reencodeImage(input: Buffer, type: MediaImageType): Promise<EncodedImage> {
  const animated = type === 'image/gif' || type === 'image/webp';
  let img = sharp(input, { animated, limitInputPixels: MAX_INPUT_PIXELS, failOn: 'error' });
  if (!animated) img = img.autoOrient();
  img = img.resize({ width: MAX_SIDE, height: MAX_SIDE, fit: 'inside', withoutEnlargement: true });
  if (type === 'image/jpeg') img = img.jpeg({ quality: 85, mozjpeg: true });
  else if (type === 'image/png') img = img.png();
  else if (type === 'image/webp') img = img.webp({ quality: 85 });
  else img = img.gif();
  const { data, info } = await img.toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.pageHeight ?? info.height };
}
