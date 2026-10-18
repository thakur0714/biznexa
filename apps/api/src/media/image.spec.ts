import sharp from 'sharp';
import { richTextInput } from '../cms/rich-text';
import { detectImageType, MAX_SIDE, reencodeImage } from './image';

const solid = (width = 40, height = 30) => sharp({ create: { width, height, channels: 3, background: '#c33' } });

describe('detectImageType', () => {
  it('knows JPEG, PNG, WebP and GIF by their bytes', async () => {
    expect(detectImageType(await solid().jpeg().toBuffer())).toBe('image/jpeg');
    expect(detectImageType(await solid().png().toBuffer())).toBe('image/png');
    expect(detectImageType(await solid().webp().toBuffer())).toBe('image/webp');
    expect(detectImageType(await solid().gif().toBuffer())).toBe('image/gif');
  });

  it('refuses PDFs, SVG, HTML and short input', () => {
    expect(detectImageType(Buffer.from('%PDF-1.7\n'))).toBeNull();
    expect(detectImageType(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>'))).toBeNull();
    expect(detectImageType(Buffer.from('<html><script>alert(1)</script>'))).toBeNull();
    expect(detectImageType(Buffer.from([0xff, 0xd8]))).toBeNull();
  });
});

describe('reencodeImage', () => {
  it('drops EXIF and anything appended after the image', async () => {
    const tagged = await solid().jpeg().withExif({ IFD0: { Artist: 'Secret Person', Copyright: 'GPS 30.7,76.7' } }).toBuffer();
    expect((await sharp(tagged).metadata()).exif).toBeDefined();
    const input = Buffer.concat([tagged, Buffer.from('<script>alert(1)</script>')]);

    const out = await reencodeImage(input, 'image/jpeg');
    const meta = await sharp(out.data).metadata();
    expect(meta.format).toBe('jpeg');
    expect(meta.exif).toBeUndefined();
    expect(out.data.includes('Secret Person')).toBe(false);
    expect(out.data.includes('<script>')).toBe(false);
    expect(out).toMatchObject({ width: 40, height: 30 });
  });

  it('applies the EXIF orientation to the pixels', async () => {
    const rotated = await solid(40, 30).jpeg().withMetadata({ orientation: 6 }).toBuffer();
    const out = await reencodeImage(rotated, 'image/jpeg');
    expect(out).toMatchObject({ width: 30, height: 40 });
    expect((await sharp(out.data).metadata()).orientation).toBeUndefined();
  });

  it('scales big images down to MAX_SIDE and never enlarges small ones', async () => {
    const big = await reencodeImage(await solid(MAX_SIDE * 2, 100).png().toBuffer(), 'image/png');
    expect(big).toMatchObject({ width: MAX_SIDE, height: 50 });
    const small = await reencodeImage(await solid(10, 10).png().toBuffer(), 'image/png');
    expect(small).toMatchObject({ width: 10, height: 10 });
  });

  it('keeps every frame of an animated GIF', async () => {
    const frames = sharp({ create: { width: 8, height: 16, channels: 3, background: '#00f' } });
    const gif = await frames.gif().toBuffer();
    const animated = await sharp(gif, { pages: -1 }).gif({ loop: 0 }).toBuffer();
    const out = await reencodeImage(animated, 'image/gif');
    expect((await sharp(out.data).metadata()).format).toBe('gif');
  });

  it('throws on bytes that only look like an image', async () => {
    const fake = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(512, 7)]);
    await expect(reencodeImage(fake, 'image/png')).rejects.toThrow();
  });
});

describe('richTextInput', () => {
  it('stores only sanitised HTML', () => {
    expect(richTextInput.parse('<p onclick="x()">Hi<script>alert(1)</script></p>')).toBe('<p>Hi</p>');
  });

  it('refuses content over the length limit', () => {
    expect(richTextInput.safeParse('a'.repeat(200_001)).success).toBe(false);
  });
});
