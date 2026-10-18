import Link from 'next/link';
import { SearchBox } from '@/components/search-box';
import { ServiceCard } from '@/components/service-card';
import { LeadForm } from '@/components/lead-form';
import { Icon } from '@/components/icons';
import { Badge, Container, LinkButton } from '@biznexa/ui';
import { api, type CategorySummary, type ServiceCard as Card } from '@/lib/api';
import { RichText } from '@/components/rich-text';

export const revalidate = 300;

const JOURNEY: { stage: string; verb: string; line: string }[] = [
  { stage: 'START', verb: 'Start', line: 'Register your business' },
  { stage: 'PROTECT', verb: 'Protect', line: 'Secure your brand' },
  { stage: 'CERTIFY', verb: 'Certify', line: 'Prove your quality' },
  { stage: 'COMPLY', verb: 'Comply', line: 'Tax, filings & licenses' },
  { stage: 'CONSULT', verb: 'Consult', line: 'Ask a professional' },
  { stage: 'GROW', verb: 'Grow', line: 'Websites, apps & marketing' },
];

const STEPS = [
  { title: 'Choose a service', body: 'Pick what you need and the package that fits.' },
  { title: 'Submit details', body: 'Fill one short online form — no paperwork.' },
  { title: 'Upload documents', body: 'Add scans or phone photos from any device.' },
  { title: 'Make payment', body: 'Pay securely by UPI, card or net banking.' },
  { title: 'Track progress', body: 'See every stage and message your expert.' },
  { title: 'Get your documents', body: 'Download the certificate or filing from your account.' },
];

async function load() {
  const [categories, popular, cms] = await Promise.all([
    api<CategorySummary[]>('/catalogue/categories').catch(() => []),
    api<Card[]>('/catalogue/popular').catch(() => []),
    api<{ banners: { id: string; title: string; subtitle: string | null; imageUrl: string | null; linkUrl: string | null }[]; testimonials: { id: string; name: string; company: string | null; quote: string; rating: number }[]; stats: { label: string; value: string }[]; faq: { question: string; answer: string }[] }>('/cms/homepage').catch(() => ({ banners: [], testimonials: [], stats: [], faq: [] })),
  ]);
  return { categories, popular, cms };
}

/** Example of what a customer sees after buying — the core promise of the product. */
function TrackerPreview() {
  const stages = [
    { name: 'Application submitted', date: '02-Oct', state: 'done' },
    { name: 'Documents approved', date: '03-Oct', state: 'done' },
    { name: 'Name approval', date: '06-Oct', state: 'done' },
    { name: 'Incorporation filing', date: 'In progress', state: 'current' },
    { name: 'Certificate of incorporation', date: '', state: 'next' },
  ];
  return (
    <figure className="relative rounded-xl border border-rule bg-white p-6 shadow-[0_30px_60px_-30px_rgba(18,26,69,0.45)]">
      <figcaption className="sr-only">Example of an application timeline in the BizNexa dashboard</figcaption>
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm text-muted">Private Limited Company Registration</p>
          <p className="num mt-0.5 text-lg font-semibold">BN10025</p>
        </div>
        <Badge tone="warning">In progress</Badge>
      </div>
      <ol className="mt-6 space-y-0">
        {stages.map((s, i) => (
          <li key={s.name} className="relative flex gap-3 pb-5 last:pb-0">
            {i < stages.length - 1 && <span aria-hidden="true" className={`absolute left-[9px] top-5 h-[calc(100%-12px)] w-0.5 ${s.state === 'done' ? 'bg-seal' : 'bg-rule'}`} />}
            <span
              className={`relative z-10 mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full ${
                s.state === 'done' ? 'bg-seal text-white' : s.state === 'current' ? 'border-2 border-marigold bg-white' : 'border-2 border-rule bg-white'
              }`}
            >
              {s.state === 'done' && <Icon name="check" size={12} strokeWidth={3} />}
              {s.state === 'current' && <span className="h-2 w-2 rounded-full bg-marigold" />}
            </span>
            <div className="flex flex-1 justify-between gap-3 text-sm">
              <span className={s.state === 'next' ? 'text-muted' : 'font-medium'}>{s.name}</span>
              <span className="num shrink-0 text-muted">{s.date}</span>
            </div>
          </li>
        ))}
      </ol>
      <div className="mt-6 flex items-center gap-3 rounded-md bg-paper p-3 text-sm">
        <span className="grid h-8 w-8 place-items-center rounded-full bg-ink text-xs font-semibold text-white">RK</span>
        <p className="text-muted">
          <span className="font-medium text-night">Your expert</span> uploaded the filing receipt.
        </p>
      </div>
      <p className="absolute -bottom-3 right-6 rounded bg-night px-2 py-0.5 text-xs text-white">Example</p>
    </figure>
  );
}

export default async function HomePage() {
  const { categories, popular, cms } = await load();
  const cmsIsEmpty = !cms.banners.length && !cms.testimonials.length && !cms.stats.length && !cms.faq.length;
  const byStage = (stage: string) => categories.filter((c) => c.journeyStage === stage);

  return (
    <>
      {/* Hero */}
      {cmsIsEmpty && <section className="border-b border-rule bg-white">
        <Container className="grid grid-cols-1 items-center gap-12 pb-14 pt-12 lg:grid-cols-[1.15fr_0.85fr] lg:pb-20 lg:pt-16">
          <div className="min-w-0">
            <h1 className="max-w-[16ch] text-[40px] font-bold leading-[1.05] tracking-[-0.03em] text-night sm:text-[56px]">
              Everything your business needs, in one place.
            </h1>
            <p className="mt-5 max-w-[52ch] text-lg text-muted">
              Register your company, protect your brand, file GST and taxes, get ISO certified and stay compliant — with a dedicated expert and a live tracker for every application.
            </p>
            <div className="mt-8 max-w-[620px]">
              <SearchBox />
              <div className="mt-4 flex flex-wrap items-center gap-2 text-sm">
                <span className="text-muted">Popular:</span>
                {popular.slice(0, 4).map((service) => (
                  <Link key={service.id} href={`/services/${service.category.slug}/${service.slug}`} className="rounded-full border border-rule px-3 py-1 hover:border-ink hover:text-ink">
                    {service.name}
                  </Link>
                ))}
              </div>
            </div>
          </div>
          <div className="mx-auto w-full max-w-[420px] lg:mx-0 lg:justify-self-end">
            <TrackerPreview />
          </div>
        </Container>

        {/* Journey rail — the business lifecycle as navigation */}
        <Container className="pb-12">
          <h2 className="sr-only">Services for every stage of your business</h2>
          <div className="relative">
            <div aria-hidden="true" className="rail-line absolute left-[12px] right-[calc((100%-120px)/6-12px)] top-[11px] hidden h-0.5 bg-night md:block" />
            <ol className="relative grid grid-cols-2 gap-x-6 gap-y-8 sm:grid-cols-3 md:grid-cols-6">
              {JOURNEY.map((j, i) => {
                const cats = byStage(j.stage);
                const href = j.stage === 'CONSULT' ? '/consultants' : cats[0] ? `/services/${cats[0].slug}` : '/services';
                return (
                  <li key={j.stage} className="rail-stop" style={{ animationDelay: `${300 + i * 90}ms` }}>
                    <span aria-hidden="true" className="relative z-10 grid h-6 w-6 place-items-center rounded-full border-2 border-night bg-marigold" />
                    <Link href={href} className="mt-3 block text-xl font-bold tracking-[-0.01em] hover:text-ink">
                      {j.verb}
                    </Link>
                    <p className="text-sm text-muted">{j.line}</p>
                    {cats.length > 0 && (
                      <ul className="mt-2 space-y-1 text-sm">
                        {cats.map((c) => (
                          <li key={c.slug}>
                            <Link href={`/services/${c.slug}`} className="font-medium text-ink hover:underline">
                              {c.name}
                            </Link>
                          </li>
                        ))}
                      </ul>
                    )}
                    {j.stage === 'CONSULT' && (
                      <Link href="/consultants" className="mt-2 block text-sm font-medium text-ink hover:underline">
                        CA, CS, lawyers & more
                      </Link>
                    )}
                  </li>
                );
              })}
            </ol>
          </div>
        </Container>
      </section>}

      {cms.banners.length > 0 && <section aria-label="Featured"><Container className="grid gap-4 py-10 sm:grid-cols-2">{cms.banners.map((banner) => <a key={banner.id} href={banner.linkUrl || '/services'} className="overflow-hidden rounded-xl border border-rule bg-white">{banner.imageUrl && <img src={banner.imageUrl} alt="" className="h-44 w-full object-cover" />}<div className="p-5"><h2 className="text-xl font-bold">{banner.title}</h2>{banner.subtitle && <p className="mt-2 text-muted">{banner.subtitle}</p>}</div></a>)}</Container></section>}
      {cms.stats.length > 0 && <section className="border-y border-rule bg-white"><Container className="grid grid-cols-2 gap-6 py-8 text-center sm:grid-cols-4">{cms.stats.map((stat) => <div key={stat.label}><p className="text-3xl font-bold text-ink">{stat.value}</p><p className="mt-1 text-sm text-muted">{stat.label}</p></div>)}</Container></section>}

      {/* Popular services */}
      <section aria-labelledby="popular-h">
        <Container className="pt-16">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <h2 id="popular-h" className="text-3xl font-bold tracking-[-0.02em]">
                Popular services
              </h2>
              <p className="mt-1 text-muted">Fixed professional fees. Government fees and GST shown before you pay.</p>
            </div>
            <LinkButton href="/services" variant="outline">
              See all services
            </LinkButton>
          </div>
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {popular.map((s) => (
              <ServiceCard key={s.id} service={s} showCategory />
            ))}
          </div>
        </Container>
      </section>

      {cms.testimonials.length > 0 && <section aria-labelledby="testimonials-h"><Container className="py-16"><h2 id="testimonials-h" className="text-3xl font-bold tracking-[-0.02em]">What our customers say</h2><div className="mt-6 grid gap-4 md:grid-cols-3">{cms.testimonials.map((t) => <figure key={t.id} className="rounded-lg border border-rule bg-white p-6"><blockquote className="text-muted">“{t.quote}”</blockquote><figcaption className="mt-4 font-semibold">{t.name}{t.company && <span className="font-normal text-muted"> · {t.company}</span>}</figcaption><p className="sr-only">Rated {t.rating} out of 5</p></figure>)}</div></Container></section>}
      {cms.faq.length > 0 && <section aria-labelledby="home-faq-h"><Container className="max-w-3xl py-14"><h2 id="home-faq-h" className="text-3xl font-bold tracking-[-0.02em]">Frequently asked questions</h2><div className="mt-5 divide-y divide-rule">{cms.faq.map((item) => <details key={item.question} className="py-4"><summary className="cursor-pointer font-semibold">{item.question}</summary><RichText html={item.answer} className="mt-3" /></details>)}</div></Container></section>}

      {/* How it works — a real sequence, so it is numbered */}
      {cmsIsEmpty && <section aria-labelledby="how-h">
        <Container className="pt-20">
          <h2 id="how-h" className="text-3xl font-bold tracking-[-0.02em]">
            How it works
          </h2>
          <ol className="mt-8 grid gap-px overflow-hidden rounded-lg border border-rule bg-rule sm:grid-cols-2 lg:grid-cols-3">
            {STEPS.map((s, i) => (
              <li key={s.title} className="bg-white p-6">
                <span className="num text-4xl font-bold text-ink/20">{i + 1}</span>
                <h3 className="mt-2 text-lg font-semibold">{s.title}</h3>
                <p className="mt-1 text-muted">{s.body}</p>
              </li>
            ))}
          </ol>
        </Container>
      </section>}

      {/* Verify + expert */}
      {cmsIsEmpty && <section>
        <Container className="grid grid-cols-1 gap-6 pt-20 lg:grid-cols-2">
          <div className="flex flex-col justify-between rounded-lg bg-ink p-8 text-white">
            <div>
              <Icon name="qr" size={32} className="text-marigold" />
              <h2 className="mt-4 text-2xl font-bold tracking-[-0.02em]">Check a certificate in seconds</h2>
              <p className="mt-2 max-w-[46ch] text-white/75">
                Every certificate issued through BizNexa carries a verification ID and QR code. Anyone can confirm it is genuine and still valid — no login needed.
              </p>
            </div>
            <div className="mt-8">
              <LinkButton href="/verify" variant="primary">
                Verify a certificate
              </LinkButton>
            </div>
          </div>
          <div className="rounded-lg border border-rule bg-white p-8">
            <h2 className="text-2xl font-bold tracking-[-0.02em]">Not sure which service you need?</h2>
            <p className="mt-2 text-muted">Leave your number. An expert will call you within one working day and recommend the right service — free.</p>
            <div className="mt-6">
              <LeadForm source="home" />
            </div>
          </div>
        </Container>
      </section>}
    </>
  );
}
