import Link from 'next/link';
import { Logo } from '@biznexa/ui';
import type { CategorySummary } from '@/lib/api';

export function SiteFooter({ categories }: { categories: CategorySummary[] }) {
  return (
    <footer className="mt-24 bg-night text-white/75">
      <div className="mx-auto grid max-w-[1180px] grid-cols-1 gap-10 px-4 py-14 sm:px-6 md:grid-cols-[1.3fr_1fr_1fr_1fr]">
        <div>
          <Logo inverted />
          <p className="mt-4 max-w-xs text-sm leading-relaxed">
            Company registration, trademarks, GST, ISO, licenses, compliance and business technology. Apply online and track every step.
          </p>
        </div>
        <div>
          <h2 className="text-sm font-semibold text-white">Services</h2>
          <ul className="mt-3 space-y-2 text-sm">
            {categories.map((c) => (
              <li key={c.slug}>
                <Link href={`/services/${c.slug}`} className="hover:text-white">
                  {c.name}
                </Link>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h2 className="text-sm font-semibold text-white">Company</h2>
          <ul className="mt-3 space-y-2 text-sm">
            <li><Link href="/about" className="hover:text-white">About</Link></li>
            <li><Link href="/contact" className="hover:text-white">Contact</Link></li>
            <li><Link href="/consultants" className="hover:text-white">Consult an expert</Link></li>
            <li><Link href="/blog" className="hover:text-white">Resources</Link></li>
            <li><Link href="/verify" className="hover:text-white">Verify a certificate</Link></li>
          </ul>
        </div>
        <div>
          <h2 className="text-sm font-semibold text-white">Policies</h2>
          <ul className="mt-3 space-y-2 text-sm">
            <li><Link href="/terms" className="hover:text-white">Terms &amp; Conditions</Link></li>
            <li><Link href="/privacy" className="hover:text-white">Privacy Policy</Link></li>
            <li><Link href="/refund-policy" className="hover:text-white">Refund Policy</Link></li>
          </ul>
        </div>
      </div>
      <div className="border-t border-white/10">
        <div className="mx-auto flex max-w-[1180px] flex-wrap justify-between gap-2 px-4 py-5 text-xs sm:px-6">
          <p>© {new Date().getFullYear()} BizNexa. All rights reserved.</p>
          <p>Payments are processed securely. Your documents are stored privately in India.</p>
        </div>
      </div>
    </footer>
  );
}
