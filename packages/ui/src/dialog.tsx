'use client';

import { useEffect, useId, useRef, type ReactNode } from 'react';

/**
 * Modal dialog on the native `<dialog>` element: the browser traps focus, closes on Escape
 * and returns focus to the trigger. Clicking the backdrop also closes it.
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  footer,
  children,
}: Readonly<{
  open: boolean;
  onClose: () => void;
  title: string;
  description?: ReactNode;
  footer?: ReactNode;
  children?: ReactNode;
}>) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descId = useId();

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    else if (!open && el.open) el.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={description ? descId : undefined}
      // Fires for Escape and for el.close(); only report it while the parent still thinks we are open.
      onClose={() => open && onClose()}
      onClick={(e) => e.target === e.currentTarget && onClose()}
      className="m-auto w-[calc(100%-2rem)] max-w-lg rounded-lg border border-rule bg-white p-0 text-night shadow-xl backdrop:bg-night/50"
    >
      <div className="p-6">
        <h2 id={titleId} className="text-lg font-semibold">
          {title}
        </h2>
        {description && (
          <p id={descId} className="mt-1 text-sm text-muted">
            {description}
          </p>
        )}
        {children && <div className="mt-4">{children}</div>}
        {footer && <div className="mt-6 flex flex-wrap justify-end gap-2">{footer}</div>}
      </div>
    </dialog>
  );
}
