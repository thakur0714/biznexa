import Link from 'next/link';
import { Container } from '@biznexa/ui';
import { formatINR, type PublicConsultantProfile, type PublicConsultantSlots } from '@biznexa/types';

const categoryName = (category: string) => category.replaceAll('_', ' ').toLowerCase();
const when = (iso: string) => new Intl.DateTimeFormat('en-IN', {
  timeZone: 'Asia/Kolkata', weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
}).format(new Date(iso));

export function ConsultantProfileView({ profile, slots }: Readonly<{ profile: PublicConsultantProfile; slots: PublicConsultantSlots | null }>) {
  const personId = `https://biznexa.com/consultants/${profile.slug}#person`;
  const serviceId = `https://biznexa.com/consultants/${profile.slug}#service`;
  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Person', '@id': personId, name: profile.name, jobTitle: profile.qualification,
        description: profile.bio || undefined, image: profile.photoUrl || undefined,
        knowsLanguage: profile.languages, address: { '@type': 'PostalAddress', addressLocality: profile.city, addressRegion: profile.state, addressCountry: 'IN' },
        url: `https://biznexa.com/consultants/${profile.slug}`,
      },
      {
        '@type': 'ProfessionalService', '@id': serviceId, name: `${profile.name} · ${profile.qualification}`,
        provider: { '@id': personId }, areaServed: profile.area ? `${profile.area}, ${profile.city}` : profile.city,
        priceRange: formatINR(profile.feePerSession), aggregateRating: { '@type': 'AggregateRating', ratingValue: profile.ratingSummary.average, reviewCount: profile.ratingSummary.reviewCount },
      },
    ],
  };

  return <>
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replaceAll('<', String.raw`\u003c`) }} />
    <Container className="py-8 sm:py-12">
      <nav aria-label="Breadcrumb" className="text-sm text-muted"><Link href="/consultants" className="underline underline-offset-2">Consultants</Link><span aria-hidden="true"> / </span><span>{profile.name}</span></nav>
      <div className="mt-5 grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <main className="min-w-0 space-y-6">
          <section className="rounded-xl border border-rule bg-white p-5 sm:p-7">
            <div className="flex flex-col gap-5 min-[420px]:flex-row">
              {profile.photoUrl ? <img src={profile.photoUrl} alt={profile.name} className="h-24 w-24 shrink-0 rounded-full object-cover" /> : <div aria-hidden="true" className="grid h-24 w-24 shrink-0 place-items-center rounded-full bg-paper text-2xl font-bold">{profile.name.split(/\s+/).map((s) => s[0]).slice(0, 2).join('').toUpperCase()}</div>}
              <div className="min-w-0"><h1 className="break-words text-3xl font-bold tracking-tight">{profile.name}</h1><p className="mt-1 text-lg text-muted">{profile.qualification} · {categoryName(profile.category)}</p><p className="mt-2 text-muted">{profile.area ? `${profile.area}, ` : ''}{profile.city}, {profile.state}</p><p className="mt-2 text-sm text-muted">{profile.experienceYears} years of experience · {profile.languages.join(', ')}</p></div>
            </div>
            {profile.bio && <p className="mt-6 whitespace-pre-line leading-relaxed">{profile.bio}</p>}
          </section>

          <section className="rounded-xl border border-rule bg-white p-5 sm:p-7" aria-labelledby="expertise-heading">
            <h2 id="expertise-heading" className="text-xl font-bold">Expertise</h2>
            <ul className="mt-3 flex flex-wrap gap-2">{profile.expertise.map((item) => <li key={item} className="rounded-full bg-paper px-3 py-1.5 text-sm font-medium">{item}</li>)}</ul>
            {profile.services.length > 0 && <><h3 className="mt-6 font-semibold">Services</h3><ul className="mt-2 grid gap-2 sm:grid-cols-2">{profile.services.map((service) => <li key={service.id} className="rounded-md border border-rule p-3"><span className="font-medium">{service.name}</span><span className="mt-1 block text-xs text-muted">{service.category}</span></li>)}</ul></>}
          </section>

          <section className="rounded-xl border border-rule bg-white p-5 sm:p-7" aria-labelledby="reviews-heading">
            <h2 id="reviews-heading" className="text-xl font-bold">Reviews</h2>
            <div className="mt-3 flex flex-wrap items-baseline gap-x-2"><span className="text-3xl font-bold">{profile.ratingSummary.average.toFixed(1)}</span><span aria-label={`${profile.ratingSummary.average.toFixed(1)} out of 5 stars`} className="text-amber-600">★★★★★</span><span className="text-sm text-muted">{profile.ratingSummary.reviewCount} verified reviews</span></div>
            <div className="mt-4 max-w-md space-y-2">{[5, 4, 3, 2, 1].map((star) => <div key={star} className="grid grid-cols-[2rem_1fr_2rem] items-center gap-2 text-sm"><span>{star} star</span><div className="h-2 rounded-full bg-paper"><div className="h-2 rounded-full bg-amber-500" style={{ width: `${profile.ratingSummary.reviewCount ? profile.ratingSummary.breakdown[String(star) as keyof typeof profile.ratingSummary.breakdown] / profile.ratingSummary.reviewCount * 100 : 0}%` }} /></div><span className="text-right text-muted">{profile.ratingSummary.breakdown[String(star) as keyof typeof profile.ratingSummary.breakdown]}</span></div>)}</div>
            {profile.verifiedReviews.length === 0 && <p className="mt-5 text-sm text-muted">No written reviews yet.</p>}
            {profile.verifiedReviews.map((review) => <article key={review.id} className="mt-4 border-t border-rule pt-4"><p>★ {review.rating}/5</p>{review.text && <p className="mt-1">{review.text}</p>}<time className="mt-1 block text-xs text-muted" dateTime={review.createdAt}>{new Date(review.createdAt).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' })}</time></article>)}
          </section>
        </main>

        <aside className="self-start rounded-xl border border-rule bg-white p-5 lg:sticky lg:top-5" aria-label="Book a consultation">
          <p className="text-sm text-muted">Consultation fee</p><p className="mt-1 text-2xl font-bold">{formatINR(profile.feePerSession)} <span className="text-sm font-normal text-muted">/ {profile.sessionMinutes} min</span></p>
          <p className="mt-3 text-sm text-muted">{profile.consultationTypes.map((type) => type.toLowerCase()).join(' · ')}</p>
          <Link href={`/consultants/${profile.slug}/book`} className="mt-5 inline-flex min-h-11 w-full items-center justify-center rounded-md bg-ink px-4 font-semibold text-white hover:opacity-90">Book a consultation</Link>
          <h2 className="mt-6 font-semibold">Next available slots</h2>
          {slots?.slots.length ? <ul className="mt-3 space-y-2">{slots.slots.slice(0, 6).map((slot) => <li key={slot.startAt} className="rounded-md bg-paper px-3 py-2 text-sm"><time dateTime={slot.startAt}>{when(slot.startAt)}</time></li>)}</ul> : <p className="mt-2 text-sm text-muted">{slots ? 'No slots are available in the next few days.' : 'Availability is temporarily unavailable.'}</p>}
          <Link href={`/consultants/${profile.slug}/book`} className="mt-3 inline-flex min-h-11 w-full items-center justify-center rounded-md border border-rule px-4 text-sm font-semibold hover:bg-paper">See all slots</Link>
        </aside>
      </div>
    </Container>
  </>;
}
