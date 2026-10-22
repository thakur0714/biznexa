import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { htmlText, PdfRenderError, PlaywrightPdfRenderer, StubPdfRenderer, textPdf } from './pdf-renderer';

/** Page objects in a PDF (`/Type /Page`, not `/Pages`). */
const pageCount = (pdf: Buffer) => (pdf.toString('latin1').match(/\/Type\s*\/Page(?!s)/g) ?? []).length;

describe('PlaywrightPdfRenderer (headless Chromium)', () => {
  const renderer = new PlaywrightPdfRenderer();
  let server: Server;
  let origin: string;
  const hits: string[] = [];

  beforeAll(async () => {
    server = createServer((req, res) => {
      hits.push(req.url ?? '');
      res.end('x');
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await renderer.close();
    await new Promise((r) => server.close(r));
  });

  it('renders an A4 PDF, with inline styles and data: images', async () => {
    const pixel = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
    const pdf = await renderer.render(`<!doctype html><style>h1{color:#0a5}</style><h1>Tax Invoice</h1><img src="${pixel}" width="20">`);
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.toString('latin1').trimEnd().endsWith('%%EOF')).toBe(true);
    expect(pageCount(pdf)).toBe(1);
    // A4 is 595 × 842 points.
    expect(pdf.toString('latin1')).toMatch(/\/MediaBox \[0 0 595\.\d+ 841\.\d+\]|\/MediaBox \[0 0 595\.\d+ 842\.\d+\]/);
  });

  it('honours the paper options and long content spills onto more pages', async () => {
    const rows = Array.from({ length: 200 }, (_, i) => `<p>Line ${i}</p>`).join('');
    const pdf = await renderer.render(`<!doctype html>${rows}`, { landscape: true });
    expect(pageCount(pdf)).toBeGreaterThan(2);
    expect(pdf.toString('latin1')).toMatch(/\/MediaBox \[0 0 84\d\.\d+ 59\d\.\d+\]/);
  });

  it('runs no JavaScript and makes no network requests', async () => {
    const started = Date.now();
    const pdf = await renderer.render(`<!doctype html>
      <link rel="stylesheet" href="${origin}/style.css">
      <style>@import url('${origin}/import.css'); body { background: url('${origin}/bg.png') }</style>
      <img src="${origin}/image.png"><iframe src="${origin}/frame"></iframe>
      <script>fetch('${origin}/fetch'); new Image().src = '${origin}/script-image'; while (true) {}</script>
      <p>Still rendered</p>`);
    expect(pageCount(pdf)).toBe(1);
    // The endless loop would have hung the render had scripts run.
    expect(Date.now() - started).toBeLessThan(20_000);
    expect(hits).toEqual([]);
  });

  it('starts the browser again after it went away', async () => {
    await renderer.close();
    expect(pageCount(await renderer.render('<p>Again</p>'))).toBe(1);
    // Concurrent renders share one browser.
    const many = await Promise.all([1, 2, 3].map((n) => renderer.render(`<p>Copy ${n}</p>`)));
    expect(many.map((item) => pageCount(item))).toEqual([1, 1, 1]);
  });
});

describe('StubPdfRenderer', () => {
  it('writes a valid one-page PDF with the page text', async () => {
    const pdf = await new StubPdfRenderer().render('<style>p{}</style><h1>Tax &amp; Invoice</h1><p>₹1,180 (paid)</p>');
    const text = pdf.toString('latin1');
    expect(text.startsWith('%PDF-1.4')).toBe(true);
    expect(text).toContain('(Tax & Invoice) Tj');
    expect(text).toContain(String.raw`(?1,180 \(paid\)) Tj`);
    expect(pageCount(pdf)).toBe(1);
    // Every xref offset points at its object.
    const offsets = [...text.matchAll(/^(\d{10}) 00000 n $/gm)].map((m) => Number(m[1]));
    offsets.forEach((o, i) => expect(text.slice(o).startsWith(`${i + 1} 0 obj`)).toBe(true));
    expect(Number(/startxref\n(\d+)/.exec(text)![1])).toBe(text.indexOf('xref\n'));
  });

  it('refuses an empty page as a template error', async () => {
    await expect(new StubPdfRenderer().render('  ')).rejects.toBeInstanceOf(PdfRenderError);
  });

  it('extracts block text', () => {
    expect(htmlText('<head><title>x</title></head><div>A</div><p>B <b>C</b></p><br>D')).toEqual(['A', 'B C', 'D']);
    expect(textPdf([]).toString('latin1')).toContain('/Count 1');
  });
});
