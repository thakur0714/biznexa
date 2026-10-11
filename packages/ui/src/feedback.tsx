import type { ReactNode } from 'react';

export type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'danger' | 'accent';

export function Notice({ tone = 'info', children }: { tone?: 'info' | 'error' | 'success'; children: ReactNode }) {
  const cls = {
    info: 'bg-ink-050 text-ink border-ink/15',
    error: 'bg-danger-050 text-danger border-danger/20',
    success: 'bg-seal-050 text-seal border-seal/20',
  }[tone];
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} className={`rounded-md border px-4 py-3 text-sm ${cls}`}>
      {children}
    </div>
  );
}

const badgeTones: Record<Tone, string> = {
  neutral: 'bg-paper text-muted ring-1 ring-rule',
  info: 'bg-ink-050 text-ink',
  success: 'bg-seal-050 text-seal',
  warning: 'bg-amber-050 text-amber',
  danger: 'bg-danger-050 text-danger',
  accent: 'bg-marigold text-night',
};

/** Small pill for statuses and labels. Map domain statuses to a tone at the call site. */
export function Badge({ tone = 'neutral', className = '', children }: { tone?: Tone; className?: string; children: ReactNode }) {
  return <span className={`inline-flex shrink-0 items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${badgeTones[tone]} ${className}`}>{children}</span>;
}

/** Placeholder for lists and sections with nothing to show yet. Use `titleAs`/`titleId` when the title should be a heading. */
export function EmptyState({
  title,
  description,
  action,
  icon,
  titleAs: Title = 'p',
  titleId,
  className = '',
}: {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  icon?: ReactNode;
  titleAs?: 'p' | 'h2' | 'h3';
  titleId?: string;
  className?: string;
}) {
  return (
    <div className={`rounded-lg border border-dashed border-rule bg-white p-8 text-center ${className}`}>
      {icon && <div className="mb-3 flex justify-center">{icon}</div>}
      <Title id={titleId} className={Title === 'p' ? 'font-semibold' : 'text-lg font-semibold'}>
        {title}
      </Title>
      {description && <p className="mx-auto mt-1 max-w-[46ch] text-muted">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
