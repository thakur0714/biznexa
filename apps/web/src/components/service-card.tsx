import Link from 'next/link';
import { formatINR } from '@biznexa/types';
import { Icon } from './icons';
import type { ServiceCard as Card } from '@/lib/api';

/** A service as a fee-schedule entry: what it is, how long, what it costs. */
export function ServiceCard({ service, showCategory = false }: { service: Card; showCategory?: boolean }) {
  const href = `/services/${service.category.slug}/${service.slug}`;
  return (
    <article className="group relative flex flex-col rounded-lg border border-rule bg-white p-5 transition-colors hover:border-ink">
      <div className="flex items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-md bg-ink-050 text-ink">
          <Icon name={service.icon ?? 'file'} />
        </span>
        <div className="min-w-0">
          {showCategory && <p className="text-xs text-muted">{service.category.name}</p>}
          <h3 className="font-semibold leading-snug text-night">
            <Link href={href} className="after:absolute after:inset-0 focus-visible:outline-none group-focus-within:underline">
              {service.name}
            </Link>
          </h3>
        </div>
      </div>
      <p className="mt-3 line-clamp-2 text-sm text-muted">{service.shortDescription}</p>
      <div className="mt-auto flex items-end justify-between gap-3 pt-5">
        <p className="flex items-center gap-1.5 text-sm text-muted">
          <Icon name="clock" size={16} />
          {service.estimatedTime}
        </p>
        {service.startingPrice != null && (
          <p className="text-right leading-tight">
            <span className="block whitespace-nowrap text-xs text-muted">Starting from</span>
            <span className="num text-lg font-semibold text-night">{formatINR(service.startingPrice)}</span>
          </p>
        )}
      </div>
      <span className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-ink">
        View details <Icon name="chevronRight" size={16} className="transition-transform group-hover:translate-x-0.5" />
      </span>
    </article>
  );
}
