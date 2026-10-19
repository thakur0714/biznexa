import Link from 'next/link';

/** Wordmark: a seal-like mark (filed, stamped, done) + name, with an optional tag such as "Admin". Placeholder until brand assets arrive. */
export function Logo({ inverted = false, tag, label }: { inverted?: boolean; tag?: string; label?: string }) {
  const mark = tag ? 28 : 30;
  return (
    <Link href="/" className="flex items-center gap-2" aria-label={label}>
      <svg width={mark} height={mark} viewBox="0 0 32 32" aria-hidden="true">
        <rect x="2" y="2" width="28" height="28" rx="8" fill={inverted ? '#ffffff' : '#1f2b7a'} />
        <path d="M11 9h6.2a4 4 0 0 1 0 8H11zm0 8h7.4a4 4 0 0 1 0 8H11z" fill="none" stroke={inverted ? '#1f2b7a' : '#ffffff'} strokeWidth="2.6" strokeLinejoin="round" />
        <circle cx="24.5" cy="24.5" r="3.5" fill="#f4b000" />
      </svg>
      <span className={`${tag ? 'text-[19px]' : 'text-[21px]'} font-bold tracking-[-0.02em] ${inverted ? 'text-white' : 'text-night'}`}>BizNexa</span>
      {tag && <span className="rounded-sm bg-marigold px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-night">{tag}</span>}
    </Link>
  );
}
