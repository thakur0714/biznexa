import Link from 'next/link';
import { formatINR, type PublicConsultantCard } from '@biznexa/types';

const categoryNames: Record<string, string> = {
  CA: 'Chartered Accountant', CS: 'Company Secretary', LAWYER: 'Lawyer', TAX_CONSULTANT: 'Tax consultant',
  TRADEMARK_CONSULTANT: 'Trademark consultant', ISO_CONSULTANT: 'ISO consultant',
  BUSINESS_CONSULTANT: 'Business consultant', TECHNOLOGY_CONSULTANT: 'Technology consultant',
};

export function ConsultantCard({ consultant }: Readonly<{ consultant: PublicConsultantCard }>) {
  return <article className="flex min-w-0 flex-col rounded-xl border border-rule bg-white p-4 shadow-xs sm:p-5">
    <div className="flex min-w-0 gap-3">
      {consultant.photoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- CMS/upload image, unknown host and size
        <img src={consultant.photoUrl} alt="" className="h-16 w-16 shrink-0 rounded-full object-cover" />
      ) : <div aria-hidden="true" className="grid h-16 w-16 shrink-0 place-items-center rounded-full bg-paper text-xl font-bold text-ink">{consultant.name.split(/\s+/).map((part) => part[0]).slice(0, 2).join('').toUpperCase()}</div>}
      <div className="min-w-0"><h2 className="break-words text-lg font-bold leading-tight">{consultant.name}</h2><p className="mt-1 text-sm text-muted">{categoryNames[consultant.category]}</p><p className="mt-1 break-words text-sm text-muted">{consultant.city}, {consultant.state}</p></div>
    </div>
    <p className="mt-4 line-clamp-2 min-h-10 text-sm text-muted">{consultant.expertise.join(' · ') || consultant.qualification}</p>
    <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm"><span aria-label={`${consultant.rating.toFixed(1)} out of 5 stars`}>★ {consultant.rating.toFixed(1)} <span className="text-muted">({consultant.reviewCount})</span></span><span className="text-muted">{consultant.sessionMinutes} min</span>{consultant.availableToday && <span className="rounded-full bg-green-50 px-2 py-1 text-xs font-semibold text-green-800">Available today</span>}</div>
    <div className="mt-4 flex items-end justify-between gap-3 border-t border-rule pt-4"><p className="min-w-0"><span className="block text-xs text-muted">Per session</span><strong className="text-lg">{formatINR(consultant.feePerSession)}</strong></p><Link href={`/consultants/${consultant.slug}`} className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-md bg-ink px-4 text-sm font-semibold text-white hover:opacity-90">View profile</Link></div>
  </article>;
}
