import { Logger } from '@nestjs/common';
import { chromium, type Browser } from 'playwright-core';

export interface PdfOptions {
  /** Paper size; A4 unless the template sets its own with CSS `@page { size }`. */
  format?: 'A4' | 'A5' | 'Letter';
  landscape?: boolean;
  /** CSS lengths, e.g. `12mm`. Default 12mm all round; `@page { margin }` in the template wins. */
  margin?: { top?: string; right?: string; bottom?: string; left?: string };
}

/** A render that can't succeed however often it is tried (the template itself is broken). */
export class PdfRenderError extends Error {}

/**
 * HTML → PDF (M3.22, D49). Templates are self-contained: rendering runs **without JavaScript and without
 * network access** — images, fonts and styles must be inline (`data:` URLs, `<style>`) — so a value printed
 * on a page can never make the server fetch anything, and every render of the same HTML is the same.
 */
export abstract class PdfRenderer {
  abstract render(html: string, options?: PdfOptions): Promise<Buffer>;
  /** Frees the browser, if any. */
  async close(): Promise<void> {}
}

const RENDER_TIMEOUT_MS = 30_000;
const DEFAULT_MARGIN = '12mm';

/**
 * Headless Chromium through `playwright-core` (no bundled browser: install it once with
 * `playwright-core install chromium --only-shell`; the API image does). One browser is started on first use
 * and shared; each render gets a fresh context (no cookies or cache carried over) that is closed afterwards.
 * A crashed browser is started again on the next render.
 */
export class PlaywrightPdfRenderer extends PdfRenderer {
  private readonly log = new Logger('PdfRenderer');
  private browser: Promise<Browser> | null = null;

  private launch(): Promise<Browser> {
    if (!this.browser) {
      const launching = chromium.launch({ headless: true });
      this.browser = launching.then(
        (b) => {
          b.on('disconnected', () => {
            if (this.browser === launching) this.browser = null;
          });
          return b;
        },
        (err) => {
          this.browser = null;
          throw err;
        },
      );
    }
    return this.browser;
  }

  async render(html: string, options: PdfOptions = {}): Promise<Buffer> {
    const browser = await this.launch();
    const context = await browser.newContext({ javaScriptEnabled: false, offline: true });
    try {
      // Nothing leaves the page: every request (images, fonts, styles, iframes) is refused.
      await context.route('**/*', (route) => route.abort('blockedbyclient'));
      const page = await context.newPage();
      page.setDefaultTimeout(RENDER_TIMEOUT_MS);
      await page.setContent(html, { waitUntil: 'load' });
      const m = options.margin ?? {};
      return await page.pdf({
        format: options.format ?? 'A4',
        landscape: options.landscape ?? false,
        printBackground: true,
        preferCSSPageSize: true,
        margin: { top: m.top ?? DEFAULT_MARGIN, right: m.right ?? DEFAULT_MARGIN, bottom: m.bottom ?? DEFAULT_MARGIN, left: m.left ?? DEFAULT_MARGIN },
      });
    } finally {
      await context.close().catch((e) => this.log.warn(`Could not close a render context: ${e}`));
    }
  }

  async close() {
    const browser = this.browser;
    this.browser = null;
    if (browser) await (await browser.catch(() => null))?.close();
  }
}

/**
 * Development/test stand-in where Chromium isn't installed: a valid one-page PDF holding the page's text
 * (tags dropped), so the rest of the pipeline can be exercised. Refused in production (env check).
 */
export class StubPdfRenderer extends PdfRenderer {
  async render(html: string): Promise<Buffer> {
    if (!html.trim()) throw new PdfRenderError('Nothing to render');
    return textPdf(htmlText(html));
  }
}

/** Visible text of an HTML page, one line per block, for the stub. */
export function htmlText(html: string): string[] {
  return html
    .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, '')
    .replace(/<(br|\/p|\/div|\/tr|\/h\d|\/li)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

/** A minimal PDF 1.4: one A4 page, Helvetica, one line of text per entry (ASCII; anything else becomes `?`). */
export function textPdf(lines: string[]): Buffer {
  const esc = (s: string) => s.replace(/[^\x20-\x7e]/g, '?').replace(/([\\()])/g, '\\$1');
  const text = lines.slice(0, 60).map((l, i) => `BT /F1 10 Tf 40 ${800 - i * 13} Td (${esc(l.slice(0, 110))}) Tj ET`).join('\n');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(text, 'latin1')} >>\nstream\n${text}\nendstream`,
  ];
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((o, i) => {
    offsets.push(Buffer.byteLength(out, 'latin1'));
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out, 'latin1');
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}
