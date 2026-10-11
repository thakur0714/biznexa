import { connect } from 'node:net';
import { once } from 'node:events';
import type { Readable } from 'node:stream';

export type ScanVerdict = { infected: false } | { infected: true; signature: string };

/**
 * Virus scanning for uploads (M2.5.7, D23). Drivers read a stream and say whether it is infected;
 * they throw when they cannot tell (scanner down, timeout), so the scan job retries and the file
 * stays PENDING — never downloadable — until a scanner gives an answer.
 */
export abstract class VirusScanner {
  abstract readonly name: string;
  abstract scan(data: Readable): Promise<ScanVerdict>;
}

/**
 * The EICAR anti-virus test file. Kept base64-encoded so the source file itself is not
 * quarantined by a developer's anti-virus.
 */
export const EICAR = Buffer.from('WDVPIVAlQEFQWzRcUFpYNTQoUF4pN0NDKTd9JEVJQ0FSLVNUQU5EQVJELUFOVElWSVJVUy1URVNULUZJTEUhJEgrSCo=', 'base64');
export const EICAR_SIGNATURE = 'Eicar-Test-Signature';

/**
 * Development and test only (refused in production by env validation): finds the EICAR string
 * anywhere in the file, including across chunk boundaries, and passes everything else.
 */
export class StubVirusScanner extends VirusScanner {
  readonly name = 'stub';

  async scan(data: Readable): Promise<ScanVerdict> {
    let tail = Buffer.alloc(0);
    for await (const chunk of data) {
      const window = Buffer.concat([tail, chunk as Buffer]);
      if (window.includes(EICAR)) {
        data.destroy();
        return { infected: true, signature: EICAR_SIGNATURE };
      }
      tail = window.subarray(Math.max(0, window.length - (EICAR.length - 1)));
    }
    return { infected: false };
  }
}

/** clamd answers `stream: OK`, `stream: <signature> FOUND`, or `<message> ERROR`. */
export function parseClamdReply(reply: string): ScanVerdict {
  const text = reply.split('\0')[0].trim();
  if (text === 'stream: OK') return { infected: false };
  const found = text.match(/^stream: (.+) FOUND$/);
  if (found) return { infected: true, signature: found[1] };
  throw new Error(`ClamAV could not scan the file: ${text || 'empty reply'}`);
}

/** clamd rejects chunks above its StreamMaxLength; 64 KB is far below any sane setting. */
const CHUNK = 64 * 1024;

/**
 * clamd over TCP with the INSTREAM command: `zINSTREAM\0`, then chunks prefixed with their
 * 4-byte big-endian length, then a zero-length chunk; the reply ends with `\0`.
 * The whole file must fit clamd's StreamMaxLength (default 25 MB, same as UPLOAD_MAX_MB's default).
 */
export class ClamAvScanner extends VirusScanner {
  readonly name = 'clamav';

  constructor(private readonly host: string, private readonly port: number, private readonly timeoutMs = 60_000) {
    super();
  }

  scan(data: Readable): Promise<ScanVerdict> {
    return new Promise((resolve, reject) => {
      const socket = connect({ host: this.host, port: this.port });
      let reply = '';
      let settled = false;
      const finish = (result: () => ScanVerdict) => {
        if (settled) return;
        settled = true;
        socket.destroy();
        data.destroy();
        try {
          resolve(result());
        } catch (err) {
          reject(err);
        }
      };
      const fail = (message: string) => finish(() => { throw new Error(message); });

      socket.setTimeout(this.timeoutMs, () => fail(`ClamAV did not answer within ${this.timeoutMs / 1000} s`));
      socket.on('error', (err) => fail(`ClamAV at ${this.host}:${this.port}: ${err.message}`));
      socket.on('data', (chunk) => {
        reply += chunk.toString('utf8');
        // clamd may answer early (e.g. size limit exceeded) while we are still sending.
        if (reply.includes('\0')) finish(() => parseClamdReply(reply));
      });
      socket.on('end', () => (reply ? finish(() => parseClamdReply(reply)) : fail('ClamAV closed the connection without an answer')));

      socket.on('connect', async () => {
        try {
          socket.write('zINSTREAM\0');
          for await (const chunk of data as AsyncIterable<Buffer>) {
            for (let i = 0; i < chunk.length && !settled; i += CHUNK) {
              const part = chunk.subarray(i, i + CHUNK);
              const size = Buffer.alloc(4);
              size.writeUInt32BE(part.length);
              if (!socket.write(Buffer.concat([size, part]))) await Promise.race([once(socket, 'drain'), once(socket, 'close')]);
            }
            if (settled) return;
          }
          socket.write(Buffer.alloc(4));
        } catch (err) {
          fail(`Could not send the file to ClamAV: ${(err as Error).message}`);
        }
      });
    });
  }
}
