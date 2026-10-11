'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Icon } from './icons';
import { buttonClass } from '@biznexa/ui';

const noSubscribe = () => () => {};
const detectSupport = () => 'BarcodeDetector' in window && !!navigator.mediaDevices?.getUserMedia;

interface Detector {
  detect(source: HTMLVideoElement): Promise<{ rawValue: string }[]>;
}

/**
 * Scans a certificate QR with the device camera where the browser supports BarcodeDetector
 * (Chrome on Android, recent desktop Chrome). Elsewhere, the phone's camera app opens the link directly.
 */
export function QrScanner() {
  const router = useRouter();
  // false on the server and during hydration, then the real value on the client.
  const supported = useSyncExternalStore(noSubscribe, detectSupport, () => false);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (!open) return;
    let stream: MediaStream | undefined;
    let stopped = false;
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        if (!videoRef.current) return;
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        const Ctor = (window as unknown as { BarcodeDetector: new (o: { formats: string[] }) => Detector }).BarcodeDetector;
        const detector = new Ctor({ formats: ['qr_code'] });
        while (!stopped) {
          const codes = await detector.detect(videoRef.current).catch(() => []);
          const raw = codes[0]?.rawValue;
          if (raw) {
            try {
              const u = new URL(raw);
              const m = u.pathname.match(/\/verify\/([A-Za-z0-9]+)/);
              if (m) {
                router.push(`/verify/${m[1]}${u.search}`);
                setOpen(false);
                return;
              }
            } catch {}
            setError('That QR code is not a BizNexa certificate code.');
          }
          await new Promise((r) => setTimeout(r, 300));
        }
      } catch {
        setError('Camera access was blocked. Allow camera access in your browser settings, or type the certificate number instead.');
      }
    })();
    return () => {
      stopped = true;
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [open, router]);

  if (!supported) {
    return (
      <p className="flex items-start gap-2 text-sm text-muted">
        <Icon name="qr" size={18} className="mt-0.5 shrink-0" />
        Have the printed certificate? Point your phone camera at its QR code — it opens the verified result here.
      </p>
    );
  }

  return (
    <div>
      {!open ? (
        <button type="button" onClick={() => { setError(''); setOpen(true); }} className={buttonClass('outline', 'md')}>
          <Icon name="qr" size={18} /> Scan QR code
        </button>
      ) : (
        <div className="space-y-3">
          <video ref={videoRef} muted playsInline className="aspect-square w-full max-w-[320px] rounded-lg bg-night object-cover" />
          <button type="button" onClick={() => setOpen(false)} className={buttonClass('ghost', 'sm')}>
            Stop scanning
          </button>
        </div>
      )}
      {error && <p className="mt-2 text-sm text-danger">{error}</p>}
    </div>
  );
}
