import { crc32, inflateRawSync } from 'node:zlib';

/** Reads a ZIP through its central directory (tests only): name → bytes, checking each CRC. */
export function readZip(zip: Buffer): Map<string, Buffer> {
  const end = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (end < 0) throw new Error('No end of central directory');
  const count = zip.readUInt16LE(end + 10);
  let p = zip.readUInt32LE(end + 16);
  const files = new Map<string, Buffer>();
  for (let i = 0; i < count; i++) {
    if (zip.readUInt32LE(p) !== 0x02014b50) throw new Error('Bad central directory header');
    const method = zip.readUInt16LE(p + 10);
    const crc = zip.readUInt32LE(p + 16);
    const packedSize = zip.readUInt32LE(p + 20);
    const nameLen = zip.readUInt16LE(p + 28);
    const extraLen = zip.readUInt16LE(p + 30);
    const commentLen = zip.readUInt16LE(p + 32);
    const local = zip.readUInt32LE(p + 42);
    const name = zip.toString('utf8', p + 46, p + 46 + nameLen);
    const dataStart = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
    const packed = zip.subarray(dataStart, dataStart + packedSize);
    const data = method === 8 ? inflateRawSync(packed) : packed;
    if (crc32(data) !== crc) throw new Error(`CRC mismatch for ${name}`);
    files.set(name, data);
    p += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}
