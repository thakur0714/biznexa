import type { ComponentProps, ReactNode } from 'react';

/** Bordered table that scrolls sideways on narrow screens. Write `<thead>`/`<tbody>` as children. */
export function Table({ caption, minWidth = 540, className = '', children, ...rest }: ComponentProps<'table'> & { caption?: ReactNode; minWidth?: number }) {
  return (
    <section
      className="overflow-x-auto rounded-lg border border-rule bg-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
      tabIndex={0}
      aria-label={typeof caption === 'string' ? caption : 'Table'}
    >
      <table className={`num w-full text-left text-sm ${className}`} style={{ minWidth }} {...rest}>
        {caption && <caption className="sr-only">{caption}</caption>}
        {children}
      </table>
    </section>
  );
}

export function Th({ className = '', scope = 'col', ...rest }: ComponentProps<'th'>) {
  return <th scope={scope} className={`p-4 font-medium text-muted ${className}`} {...rest} />;
}

export function Td({ className = '', ...rest }: ComponentProps<'td'>) {
  return <td className={`p-4 ${className}`} {...rest} />;
}
