import { describe, expect, it } from 'vitest';
import { isRichTextEmpty, sanitizeRichText } from './index';

const IMG = '/api/media/ab/0123456789abcdef0123456789abcdef.webp';

describe('sanitizeRichText keeps editor output', () => {
  it('keeps headings, marks, lists, quotes, tables and our images', () => {
    const html =
      '<h2>Title</h2><h3>Sub</h3><p><strong>b</strong> <em>i</em> <u>u</u> <s>s</s> <code>c</code></p>' +
      '<ul><li><p>one</p></li></ul><ol start="3"><li>three</li></ol><blockquote><p>q</p></blockquote><hr>' +
      '<table><tbody><tr><th colspan="2">h</th></tr><tr><td>a</td><td>b</td></tr></tbody></table>' +
      `<p><img src="${IMG}" alt="Office"></p><pre><code>x &lt; y</code></pre>`;
    expect(sanitizeRichText(html)).toBe(html.replace('<hr>', '<hr />').replace('alt="Office">', 'alt="Office" />'));
  });

  it('turns h1/h5/h6 into allowed heading levels', () => {
    expect(sanitizeRichText('<h1>A</h1><h5>B</h5><h6>C</h6>')).toBe('<h2>A</h2><h4>B</h4><h4>C</h4>');
  });

  it('is idempotent', () => {
    const once = sanitizeRichText('<p onclick="x()">Hi <a href="https://example.com" target="_blank">there</a><script>1</script></p>');
    expect(sanitizeRichText(once)).toBe(once);
  });
});

describe('links', () => {
  it('adds rel="noopener noreferrer" to external links and keeps target=_blank only', () => {
    expect(sanitizeRichText('<a href="https://example.com" target="_top" rel="opener">x</a>')).toBe(
      '<a href="https://example.com" rel="noopener noreferrer">x</a>',
    );
    expect(sanitizeRichText('<a href="/services" target="_blank">x</a>')).toBe('<a href="/services" target="_blank" rel="noopener noreferrer">x</a>');
  });

  it('leaves internal, mailto and tel links without rel', () => {
    expect(sanitizeRichText('<a href="/about">a</a> <a href="mailto:a@b.co">m</a> <a href="tel:+911234">t</a>')).toBe(
      '<a href="/about">a</a> <a href="mailto:a@b.co">m</a> <a href="tel:+911234">t</a>',
    );
  });

  it.each([
    'javascript:alert(1)',
    'JaVaScRiPt:alert(1)',
    ' javascript:alert(1)',
    'java\tscript:alert(1)',
    'java&#x09;script:alert(1)',
    'javascript&colon;alert(1)',
    '&#106;avascript:alert(1)',
    'vbscript:msgbox(1)',
    'data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==',
    '//evil.example',
    '/\\evil.example',
    '\\\\evil.example',
  ])('drops a dangerous href: %s', (href) => {
    const out = sanitizeRichText(`<a href="${href}">x</a>`);
    expect(out).not.toMatch(/href/);
    expect(out).toContain('>x</a>');
  });
});

describe('XSS payloads', () => {
  it.each([
    ['script tag', '<script>alert(1)</script><p>ok</p>', '<p>ok</p>'],
    ['script with src', '<script src="https://evil.example/x.js"></script>ok', 'ok'],
    ['img onerror', '<img src=x onerror=alert(1)>', ''],
    ['our image with onerror', `<img src="${IMG}" onerror="alert(1)">`, `<img src="${IMG}" />`],
    ['svg onload', '<svg onload=alert(1)><circle /></svg>ok', 'ok'],
    ['svg script', '<svg><script>alert(1)</script></svg>', ''],
    ['math href', '<math><mtext><a href="javascript:alert(1)">x</a></mtext></math>', ''],
    ['style tag', '<style>body{background:url(javascript:alert(1))}</style>ok', 'ok'],
    ['style attribute', '<p style="background:url(javascript:alert(1))">ok</p>', '<p>ok</p>'],
    ['class attribute', '<p class="hidden">ok</p>', '<p>ok</p>'],
    ['iframe', '<iframe src="https://evil.example"></iframe>ok', 'ok'],
    ['iframe srcdoc', '<iframe srcdoc="<script>alert(1)</script>"></iframe>', ''],
    ['object/embed', '<object data="x.swf"></object><embed src="x.swf">ok', 'ok'],
    ['form', '<form action="https://evil.example"><input name="pw"><button>Go</button></form>', 'Go'],
    ['meta refresh', '<meta http-equiv="refresh" content="0;url=https://evil.example">ok', 'ok'],
    ['base tag', '<base href="https://evil.example/">ok', 'ok'],
    ['link stylesheet', '<link rel="stylesheet" href="https://evil.example/x.css">ok', 'ok'],
    ['body onload', '<body onload=alert(1)>ok</body>', 'ok'],
    ['details ontoggle', '<details open ontoggle=alert(1)>ok</details>', 'ok'],
    ['template', '<template><img src=x onerror=alert(1)></template>ok', 'ok'],
    ['noscript mXSS', '<noscript><p title="</noscript><img src=x onerror=alert(1)>">', ''],
    ['textarea mXSS', '<textarea><img src=x onerror=alert(1)></textarea>', ''],
    ['split script', '<scr<script>ipt>alert(1)</scr</script>ipt>', 'ipt&gt;alert(1)ipt&gt;'],
    ['comment', '<!-- <img src=x onerror=alert(1)> -->ok', 'ok'],
    ['cdata', '<![CDATA[<script>alert(1)</script>]]>ok', 'ok'],
    ['unclosed attribute', '<p title="x><img src=x onerror=alert(1)>">ok</p>', '<p>ok</p>'],
  ])('%s', (_name, input, expected) => {
    const out = sanitizeRichText(input);
    expect(out).toBe(expected);
    expect(out).not.toMatch(/<(script|svg|iframe|style|object|embed|form|meta|base|link)\b|on\w+=|javascript:/i);
  });

  it.each([
    'https://evil.example/a.png',
    'data:image/png;base64,iVBORw0KGgo=',
    'data:image/svg+xml,<svg onload=alert(1)>',
    'javascript:alert(1)',
    '/api/files/123/download',
    '/api/media/ab/0123456789abcdef0123456789abcdef.svg',
    '/api/media/../files/x.png',
    `https://evil.example${IMG}`,
    `${IMG}?x=1`,
  ])('drops an image we do not host: %s', (src) => {
    expect(sanitizeRichText(`<p><img src="${src}" alt="a"></p>`)).toBe('<p></p>');
  });

  it('keeps only sane table spans and list starts', () => {
    expect(sanitizeRichText('<table><tbody><tr><td colspan="1" rowspan="x">a</td><td colspan="3">b</td></tr></tbody></table><ol start="1;alert(1)"><li>x</li></ol>')).toBe(
      '<table><tbody><tr><td>a</td><td colspan="3">b</td></tr></tbody></table><ol><li>x</li></ol>',
    );
  });

  it('escapes text so it cannot become markup', () => {
    expect(sanitizeRichText('<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>')).toBe('<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>');
    expect(sanitizeRichText('<a href="https://x.example" title="&quot; onmouseover=&quot;alert(1)">x</a>')).toBe(
      '<a href="https://x.example" title="&quot; onmouseover=&quot;alert(1)" rel="noopener noreferrer">x</a>',
    );
  });
});

describe('isRichTextEmpty', () => {
  it('treats empty paragraphs and whitespace as empty', () => {
    expect(isRichTextEmpty('<p></p>')).toBe(true);
    expect(isRichTextEmpty('<p> &nbsp; </p><p><br></p>')).toBe(true);
    expect(isRichTextEmpty('<script>alert(1)</script>')).toBe(true);
  });

  it('is not empty with text or one of our images', () => {
    expect(isRichTextEmpty('<p>x</p>')).toBe(false);
    expect(isRichTextEmpty(`<p><img src="${IMG}"></p>`)).toBe(false);
  });
});
