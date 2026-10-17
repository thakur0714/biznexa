import { describe, expect, it } from 'vitest';
import { isMediaPath, MEDIA_ACCEPT, mediaTypeFromName, safeLinkHref } from './media';

describe('media helpers', () => {
  it('knows accepted image names', () => {
    expect(mediaTypeFromName('Photo.JPEG')).toBe('image/jpeg');
    expect(mediaTypeFromName('a.gif')).toBe('image/gif');
    expect(mediaTypeFromName('logo.svg')).toBeNull();
    expect(mediaTypeFromName('noext')).toBeNull();
    expect(MEDIA_ACCEPT).toContain('.webp');
  });

  it('only treats our own media paths as hosted images', () => {
    expect(isMediaPath('/api/media/ab/0123456789abcdef0123456789abcdef.png')).toBe(true);
    expect(isMediaPath('/api/media/ab/0123456789abcdef0123456789abcdef.svg')).toBe(false);
    expect(isMediaPath('https://x.example/api/media/ab/0123456789abcdef0123456789abcdef.png')).toBe(false);
  });
});

describe('safeLinkHref', () => {
  it.each([
    ['https://example.com/a?b=1', 'https://example.com/a?b=1'],
    ['  http://example.com  ', 'http://example.com'],
    ['example.com/pricing', 'https://example.com/pricing'],
    ['mailto:hello@biznexa.com', 'mailto:hello@biznexa.com'],
    ['tel:+911234567890', 'tel:+911234567890'],
    ['/services/gst', '/services/gst'],
    ['#faq', '#faq'],
  ])('accepts %s', (input, expected) => expect(safeLinkHref(input)).toBe(expected));

  it.each(['', 'javascript:alert(1)', 'data:text/html,x', '//evil.example', '/\\evil.example', 'java script:alert(1)', 'vbscript:x', 'hello world'])(
    'refuses %s',
    (input) => expect(safeLinkHref(input)).toBeNull(),
  );
});
