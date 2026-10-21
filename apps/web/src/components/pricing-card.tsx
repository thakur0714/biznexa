'use client';

import Link from 'next/link';
import { useState } from 'react';
import { formatINR } from '@biznexa/types';
import { Icon } from './icons';
import { Badge, buttonClass } from '@biznexa/ui';
import type { ServicePackage } from '@/lib/api';

/** Sticky package picker: right rail on desktop, bottom bar on mobile. */
export function PricingCard({ serviceSlug, packages }: Readonly<{ serviceSlug: string; packages: ServicePackage[] }>) {
  const initial = packages.find((p) => p.isMostPopular) ?? packages[0];
  const [selectedId, setSelectedId] = useState(initial?.id);
  const pkg = packages.find((p) => p.id === selectedId) ?? initial;
  if (!pkg) return null;
  const startHref = `/apply/${serviceSlug}?package=${pkg.id}`;

  return (
    <>
      <div className="rounded-xl border-2 border-night bg-white p-5 shadow-[6px_6px_0_0_#121a45]">
        <fieldset>
          <legend className="text-sm font-semibold">Choose a package</legend>
          <div className="mt-3 grid gap-2">
            {packages.map((p) => (
              <label
                key={p.id}
                className={`flex cursor-pointer items-center justify-between gap-3 rounded-md border px-3.5 py-3 transition-colors ${p.id === pkg.id ? 'border-ink bg-ink-050' : 'border-rule hover:border-ink/50'}`}
              >
                <span className="flex items-center gap-2.5">
                  <input type="radio" name="package" value={p.id} checked={p.id === pkg.id} onChange={() => setSelectedId(p.id)} className="accent-ink" />
                  <span className="font-medium">{p.name}</span>
                  {p.isMostPopular && <Badge tone="accent">Most chosen</Badge>}
                </span>
                <span className="num font-semibold">{formatINR(p.professionalFee)}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <dl className="num mt-5 space-y-2 border-t border-dashed border-rule pt-4 text-sm">
          <div className="flex justify-between">
            <dt className="text-muted">Professional fee</dt>
            <dd>{formatINR(pkg.price.professionalFee)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-muted">GST ({pkg.gstRate}%)</dt>
            <dd>{formatINR(pkg.price.totalTax)}</dd>
          </div>
          {pkg.governmentFee > 0 && (
            <div className="flex justify-between">
              <dt className="text-muted">Government fee</dt>
              <dd>{formatINR(pkg.governmentFee)}</dd>
            </div>
          )}
          <div className="flex justify-between border-t border-rule pt-2 text-base font-semibold">
            <dt>Total payable</dt>
            <dd>{formatINR(pkg.price.total)}</dd>
          </div>
        </dl>
        {pkg.allowPartial && pkg.advancePercent && (
          <p className="mt-2 text-xs text-muted">
            {pkg.governmentFee > 0
              ? `Pay the government fee and ${pkg.advancePercent}% of our fee now, the rest on delivery.`
              : `Pay ${pkg.advancePercent}% now and the rest on delivery.`}
          </p>
        )}

        <Link href={startHref} className={buttonClass('primary', 'lg', 'mt-5 w-full')}>
          Get started
        </Link>
        <a href="#expert" className={buttonClass('ghost', 'md', 'mt-2 w-full')}>
          <Icon name="phone" size={18} /> Talk to an expert
        </a>

        <div className="mt-4 border-t border-rule pt-4">
          <p className="text-sm font-semibold">{pkg.name} includes</p>
          <ul className="mt-2 space-y-1.5 text-sm">
            {pkg.inclusions.map((i) => (
              <li key={i} className="flex gap-2">
                <Icon name="check" size={16} className="mt-0.5 shrink-0 text-seal" />
                {i}
              </li>
            ))}
          </ul>
          {pkg.estimatedTime && (
            <p className="mt-3 flex items-center gap-1.5 text-sm text-muted">
              <Icon name="clock" size={16} /> {pkg.estimatedTime}
            </p>
          )}
        </div>
        <p className="mt-4 flex items-center gap-1.5 text-xs text-muted">
          <Icon name="lock" size={14} /> Secure payment by UPI, card or net banking
        </p>
      </div>

      {/* Mobile bottom bar */}
      <div className="fixed inset-x-0 bottom-0 z-30 flex items-center justify-between gap-3 border-t border-rule bg-white px-4 py-3 lg:hidden">
        <div className="leading-tight">
          <p className="text-xs text-muted">{pkg.name} · incl. GST & govt fee</p>
          <p className="num text-lg font-semibold">{formatINR(pkg.price.total)}</p>
        </div>
        <Link href={startHref} className={buttonClass('primary', 'md')}>
          Get started
        </Link>
      </div>
    </>
  );
}
