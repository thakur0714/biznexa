/**
 * The one allow-list for rich text (M9.4, D59). The API runs `sanitizeRichText` before saving CMS
 * pages and blog posts, and the website runs it again before rendering, so a row written some other
 * way (seed, SQL, an old version) still cannot inject markup.
 */
import sanitizeHtml, { type IOptions } from 'sanitize-html';
import { isMediaPath } from '@biznexa/types';

export const RICH_TEXT_ALLOW_LIST = {
  tags: [
    'p', 'br', 'h2', 'h3', 'h4', 'strong', 'b', 'em', 'i', 'u', 's', 'code', 'pre',
    'a', 'ul', 'ol', 'li', 'blockquote', 'hr', 'img',
    'table', 'thead', 'tbody', 'tr', 'th', 'td',
  ],
  /** No `class`, `style` or `on*` anywhere. `rel` on links is always set by the sanitiser itself. */
  attributes: {
    a: ['href', 'title', 'target', 'rel'],
    img: ['src', 'alt', 'title'],
    th: ['colspan', 'rowspan'],
    td: ['colspan', 'rowspan'],
    ol: ['start'],
  },
  /** Link schemes; relative links are allowed too (but not `//host` ones). */
  linkSchemes: ['http', 'https', 'mailto', 'tel'],
  /** Images must be ones we host (`/api/media/...`); any other `src`, including `data:`, drops the image. */
  imageSources: 'media-only',
} as const;

/** Tags removed together with everything inside them. */
const DROP_WITH_CONTENT = ['script', 'style', 'textarea', 'option', 'select', 'noscript', 'svg', 'math', 'iframe', 'object', 'embed', 'template', 'title', 'xmp', 'noembed', 'noframes'];

const ABSOLUTE = /^(?:https?:)?[\\/]{2}/i;
/** `//host`, `/\host` and `\\host` all leave the site in a browser. */
const PROTOCOL_RELATIVE = /^[\\/]{2}/;
const NUMBER = /^[1-9][0-9]{0,2}$/;

const OPTIONS: IOptions = {
  allowedTags: [...RICH_TEXT_ALLOW_LIST.tags],
  allowedAttributes: Object.fromEntries(Object.entries(RICH_TEXT_ALLOW_LIST.attributes).map(([tag, attrs]) => [tag, [...attrs]])),
  allowedSchemes: [...RICH_TEXT_ALLOW_LIST.linkSchemes],
  allowedSchemesByTag: { img: [] },
  allowedSchemesAppliedToAttributes: ['href', 'src'],
  allowProtocolRelative: false,
  allowedClasses: {},
  allowedStyles: {},
  parseStyleAttributes: false,
  allowVulnerableTags: false,
  disallowedTagsMode: 'discard',
  nonTextTags: DROP_WITH_CONTENT,
  transformTags: {
    h1: 'h2',
    h5: 'h4',
    h6: 'h4',
    a: (_tag, attribs) => {
      const out: Record<string, string> = {};
      const href = (attribs.href ?? '').trim();
      if (href && !PROTOCOL_RELATIVE.test(href)) out.href = href;
      if (attribs.title) out.title = attribs.title;
      if (attribs.target === '_blank') out.target = '_blank';
      if (out.target || ABSOLUTE.test(href)) out.rel = 'noopener noreferrer';
      return { tagName: 'a', attribs: out };
    },
    td: keepSpans('td'),
    th: keepSpans('th'),
    ol: (_tag, attribs): sanitizeHtml.Tag => ({ tagName: 'ol', attribs: NUMBER.test(attribs.start ?? '') ? { start: attribs.start } : {} }),
  },
  exclusiveFilter: (frame) => frame.tag === 'img' && !isMediaPath(frame.attribs.src ?? ''),
};

function keepSpans(tagName: 'td' | 'th') {
  return (_tag: string, attribs: sanitizeHtml.Attributes) => {
    const out: Record<string, string> = {};
    for (const key of ['colspan', 'rowspan'] as const) {
      if (NUMBER.test(attribs[key] ?? '') && attribs[key] !== '1') out[key] = attribs[key];
    }
    return { tagName, attribs: out };
  };
}

/** Clean HTML that only uses RICH_TEXT_ALLOW_LIST. Safe to run more than once (same result). */
export function sanitizeRichText(html: string): string {
  return sanitizeHtml(html, OPTIONS).trim();
}

/** True when the HTML has no text and no image, e.g. an editor left at `<p></p>`. */
export function isRichTextEmpty(html: string): boolean {
  const clean = sanitizeRichText(html);
  if (/<img\s/i.test(clean)) return false;
  return sanitizeHtml(clean, { allowedTags: [], allowedAttributes: {} }).replace(/&nbsp;|\s/g, '') === '';
}
