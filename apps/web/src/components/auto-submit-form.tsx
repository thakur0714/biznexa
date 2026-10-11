'use client';

import { useRouter } from 'next/navigation';
import { useRef } from 'react';

/** A GET form that applies itself whenever a field changes (falls back to a submit button without JS). */
export function AutoSubmitForm({ action, className, children }: { action: string; className?: string; children: React.ReactNode }) {
  const router = useRouter();
  const ref = useRef<HTMLFormElement>(null);

  function apply() {
    if (!ref.current) return;
    const qs = new URLSearchParams();
    for (const [k, v] of new FormData(ref.current).entries()) {
      if (typeof v === 'string' && v && v !== '-') qs.set(k, v);
    }
    const s = qs.toString();
    router.push(s ? `${action}?${s}` : action, { scroll: false });
  }

  return (
    <form
      ref={ref}
      action={action}
      method="get"
      className={className}
      onChange={apply}
      onSubmit={(e) => {
        e.preventDefault();
        apply();
      }}
    >
      {children}
    </form>
  );
}
