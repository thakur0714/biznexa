import Link from 'next/link';
import { formatINR, type ConsultationType, type PublicConsultantCard } from '@biznexa/types';
import { Icon } from '@/components/icons';

export const categoryNames: Record<string, string> = {
  CA: 'Chartered Accountant', CS: 'Company Secretary', LAWYER: 'Lawyer', TAX_CONSULTANT: 'Tax consultant',
  TRADEMARK_CONSULTANT: 'Trademark consultant', ISO_CONSULTANT: 'ISO consultant',
  BUSINESS_CONSULTANT: 'Business consultant', TECHNOLOGY_CONSULTANT: 'Technology consultant',
};

const consultationTypeNames: Record<ConsultationType, string> = { AUDIO: 'Audio', VIDEO: 'Video', CHAT: 'Chat', MEETING: 'Meeting' };

const SHOWN_LANGUAGES = 3;

export function ConsultantCard({ consultant }: Readonly<{ consultant: PublicConsultantCard }>) {
  const moreLanguages = consultant.languages.length - SHOWN_LANGUAGES;
  return <article className="flex min-w-0 flex-col rounded-xl border border-rule bg-white p-4 shadow-xs sm:p-5">
    <div className="flex min-w-0 gap-3">
      {consultant.photoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- CMS/upload image, unknown host and size
        <img src={consultant.photoUrl} alt="" className="h-16 w-16 shrink-0 rounded-full object-cover" />
      ) : <div aria-hidden="true" className="grid h-16 w-16 shrink-0 place-items-center rounded-full bg-paper text-xl font-bold text-ink">{consultant.name.split(/\s+/).map((part) => part[0]).slice(0, 2).join('').toUpperCase()}</div>}
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1"><h2 className="min-w-0 break-words text-lg font-bold leading-tight">{consultant.name}</h2><span role="img" aria-label="Verified consultant" className="inline-flex shrink-0 items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-xs font-semibold text-blue-800"><Icon name="badge" size={14} />Verified</span></div>
        <p className="mt-1 text-sm text-muted">{categoryNames[consultant.category]} · {consultant.experienceYears} yrs experience</p>
        <p className="mt-1 break-words text-sm text-muted">{consultant.city}, {consultant.state}</p>
      </div>
    </div>
    <p className="mt-4 line-clamp-2 min-h-10 text-sm text-muted">{consultant.expertise.join(' · ') || consultant.qualification}</p>
    {consultant.languages.length > 0 && <p className="mt-2 break-words text-sm"><span className="text-muted">Speaks </span>{consultant.languages.slice(0, SHOWN_LANGUAGES).join(', ')}{moreLanguages > 0 && <span className="text-muted"> +{moreLanguages}</span>}</p>}
    {consultant.consultationTypes.length > 0 && <ul aria-label="Consultation types" className="mt-3 flex flex-wrap gap-1.5">{consultant.consultationTypes.map((type) => <li key={type} className="rounded border border-rule px-2 py-0.5 text-xs text-muted">{consultationTypeNames[type]}</li>)}</ul>}
    <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm"><span aria-label={`${consultant.rating.toFixed(1)} out of 5 stars`}>★ {consultant.rating.toFixed(1)} <span className="text-muted">({consultant.reviewCount})</span></span><span className="text-muted">{consultant.sessionMinutes} min</span>{consultant.isOnline
      ? <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-green-800"><span aria-hidden="true" className="h-2 w-2 rounded-full bg-green-600" />Online</span>
      : consultant.availableToday && <span className="rounded-full bg-green-50 px-2 py-1 text-xs font-semibold text-green-800">Available today</span>}</div>
    <div className="mt-auto border-t border-rule pt-4">
      <p className="min-w-0"><span className="block text-xs text-muted">Per session</span><strong className="text-lg">{formatINR(consultant.feePerSession)}</strong></p>
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2"><Link href={`/consultants/${consultant.slug}/book`} className="inline-flex min-h-11 flex-1 items-center justify-center whitespace-nowrap rounded-md bg-ink px-4 text-sm font-semibold text-white hover:opacity-90">Book consultation</Link><Link href={`/consultants/${consultant.slug}`} className="inline-flex min-h-11 shrink-0 items-center text-sm font-semibold text-ink underline-offset-4 hover:underline">View profile</Link></div>
    </div>
  </article>;
}
