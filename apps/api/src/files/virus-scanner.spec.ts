import { createServer, type Server, type Socket } from 'node:net';
import type { AddressInfo } from 'node:net';
import { Readable } from 'node:stream';
import { ClamAvScanner, EICAR, parseClamdReply, StubVirusScanner } from './virus-scanner';

const PDF = Buffer.from('%PDF-1.7\n');

describe('StubVirusScanner', () => {
  const stub = new StubVirusScanner();

  it('flags the EICAR test file, also inside a file and split across chunks', async () => {
    expect(await stub.scan(Readable.from([EICAR]))).toEqual({ infected: true, signature: 'Eicar-Test-Signature' });
    const inside = Buffer.concat([PDF, EICAR, PDF]);
    for (const at of [1, 10, 40, 77]) {
      expect((await stub.scan(Readable.from([inside.subarray(0, at), inside.subarray(at)]))).infected).toBe(true);
    }
  });

  it('passes everything else', async () => {
    expect(await stub.scan(Readable.from([PDF, Buffer.alloc(100_000, 0x20)]))).toEqual({ infected: false });
    expect(await stub.scan(Readable.from([EICAR.subarray(0, 67)]))).toEqual({ infected: false });
  });
});

describe('parseClamdReply', () => {
  it('reads clean, infected and error replies', () => {
    expect(parseClamdReply('stream: OK\0')).toEqual({ infected: false });
    expect(parseClamdReply('stream: Win.Test.EICAR_HDB-1 FOUND\0')).toEqual({ infected: true, signature: 'Win.Test.EICAR_HDB-1' });
    expect(() => parseClamdReply('INSTREAM size limit exceeded. ERROR\0')).toThrow(/size limit exceeded/);
    expect(() => parseClamdReply('')).toThrow(/empty reply/);
  });
});

/** A fake clamd: decodes INSTREAM and answers with `reply(fileBytes)`. */
function fakeClamd(reply: (file: Buffer) => string | null): Promise<{ server: Server; port: number; received: Buffer[] }> {
  const received: Buffer[] = [];
  const server = createServer((socket: Socket) => {
    let buf = Buffer.alloc(0);
    const chunks: Buffer[] = [];
    let headerSeen = false;
    socket.on('data', (data) => {
      buf = Buffer.concat([buf, data]);
      if (!headerSeen) {
        if (buf.length < 10) return;
        expect(buf.subarray(0, 10).toString()).toBe('zINSTREAM\0');
        buf = buf.subarray(10);
        headerSeen = true;
      }
      while (buf.length >= 4) {
        const len = buf.readUInt32BE(0);
        if (buf.length < 4 + len) return;
        if (len > 64 * 1024) throw new Error('chunk too big');
        if (len === 0) {
          const file = Buffer.concat(chunks);
          received.push(file);
          const answer = reply(file);
          if (answer === null) return; // never answer
          socket.end(answer + '\0');
          return;
        }
        chunks.push(buf.subarray(4, 4 + len));
        buf = buf.subarray(4 + len);
      }
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, port: (server.address() as AddressInfo).port, received })));
}

describe('ClamAvScanner', () => {
  let server: Server | undefined;
  afterEach(() => new Promise<void>((r) => (server ? server.close(() => r()) : r())));

  it('streams the file with INSTREAM framing and reads the verdict', async () => {
    const clamd = await fakeClamd((file) => (file.includes(EICAR) ? 'stream: Eicar-Signature FOUND' : 'stream: OK'));
    server = clamd.server;
    const scanner = new ClamAvScanner('127.0.0.1', clamd.port);

    const big = Buffer.concat([PDF, Buffer.alloc(300_000, 7)]); // several 64 KB chunks
    expect(await scanner.scan(Readable.from([big]))).toEqual({ infected: false });
    expect(clamd.received[0].equals(big)).toBe(true);
    expect(await scanner.scan(Readable.from([PDF, EICAR]))).toEqual({ infected: true, signature: 'Eicar-Signature' });
  });

  it('throws when clamd reports an error, is unreachable or does not answer', async () => {
    const clamd = await fakeClamd((file) => (file.length > 10 ? 'INSTREAM size limit exceeded. ERROR' : null));
    server = clamd.server;
    await expect(new ClamAvScanner('127.0.0.1', clamd.port).scan(Readable.from([Buffer.alloc(20)]))).rejects.toThrow(/size limit/);
    await expect(new ClamAvScanner('127.0.0.1', clamd.port, 200).scan(Readable.from([PDF]))).rejects.toThrow(/did not answer/);
    await expect(new ClamAvScanner('127.0.0.1', 1).scan(Readable.from([PDF]))).rejects.toThrow(/ClamAV at 127.0.0.1:1/);
  });
});
