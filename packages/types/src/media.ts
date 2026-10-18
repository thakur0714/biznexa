/**
 * Public website images (M9.4): uploaded by staff with `cms.manage`, re-encoded by the API (metadata
 * stripped) and stored apart from the private documents (D17). They are served without a login from
 * `/api/media/...` with long cache headers, so only put images here that anyone may see.
 */
import { z } from 'zod';

export const MEDIA_IMAGE_TYPES = {
  'image/jpeg': { label: 'JPG', extensions: ['jpg', 'jpeg'], ext: 'jpg' },
  'image/png': { label: 'PNG', extensions: ['png'], ext: 'png' },
  'image/webp': { label: 'WebP', extensions: ['webp'], ext: 'webp' },
  'image/gif': { label: 'GIF', extensions: ['gif'], ext: 'gif' },
} as const satisfies Record<string, { label: string; extensions: readonly string[]; ext: string }>;

export type MediaImageType = keyof typeof MEDIA_IMAGE_TYPES;
export const MEDIA_MAX_MB = 5;

/** Where media is served, relative to the site origin (web and admin both rewrite /api to the API). */
export const MEDIA_PATH_PREFIX = '/api/media/';

/** `/api/media/ab/<32 hex>.webp` — the only image source the rich-text sanitiser keeps. */
const MEDIA_PATH = /^\/api\/media\/[0-9a-f]{2}\/[0-9a-f]{32}\.(?:jpg|png|webp|gif)$/;
export const isMediaPath = (src: string) => MEDIA_PATH.test(src);

/** The media type a file name claims by its extension, or null when it is not an accepted image. */
export function mediaTypeFromName(name: string): MediaImageType | null {
  const ext = name.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1];
  if (!ext) return null;
  const hit = Object.entries(MEDIA_IMAGE_TYPES).find(([, t]) => (t.extensions as readonly string[]).includes(ext));
  return (hit?.[0] as MediaImageType | undefined) ?? null;
}

/** Value for an `<input type="file" accept>` attribute. */
export const MEDIA_ACCEPT = Object.entries(MEDIA_IMAGE_TYPES)
  .flatMap(([mime, t]) => [mime, ...t.extensions.map((e) => `.${e}`)])
  .join(',');

export const mediaImageSchema = z.object({
  url: z.string().describe('Path under the site origin, e.g. /api/media/ab/<id>.webp — public, cached for a year'),
  mimeType: z.enum(Object.keys(MEDIA_IMAGE_TYPES) as [MediaImageType, ...MediaImageType[]]),
  sizeBytes: z.number().int(),
  width: z.number().int(),
  height: z.number().int(),
});
export type MediaImage = z.infer<typeof mediaImageSchema>;

/**
 * What an editor typed into the link box, as an href the sanitiser will keep — http(s), mailto, tel,
 * a site path (`/about`, not `//host`) or `#anchor`; a bare `example.com` gets `https://` — else null.
 */
export function safeLinkHref(input: string): string | null {
  const href = input.trim();
  // eslint-disable-next-line no-control-regex
  if (!href || /[\s\u0000-\u001f\u007f\\]/.test(href)) return null;
  if (/^(?:https?:\/\/[^/]|mailto:.|tel:\+?[0-9])/i.test(href)) return href;
  if (/^\/(?!\/)/.test(href) || href.startsWith('#')) return href;
  if (/^[a-z0-9-]+(?:\.[a-z0-9-]+)+(?:[/?#:].*)?$/i.test(href)) return `https://${href}`;
  return null;
}

/** Longest rich-text HTML a CMS page or blog post may store. */
export const RICH_TEXT_MAX_LENGTH = 200_000;
export const richTextSchema = z.string().max(RICH_TEXT_MAX_LENGTH, 'This content is too long');
