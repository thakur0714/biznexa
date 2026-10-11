import { Icon } from './icons';

/** Two-column frame for login/register: the form, and a short reminder of what the account is for. */
export function AuthShell({ title, subtitle, children }: { title: string; subtitle?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="mx-auto grid max-w-[1000px] grid-cols-1 gap-10 px-4 py-12 sm:px-6 md:grid-cols-[1fr_380px] md:py-16">
      <div className="max-w-[440px]">
        <h1 className="text-3xl font-bold tracking-[-0.025em]">{title}</h1>
        {subtitle && <p className="mt-2 text-muted">{subtitle}</p>}
        <div className="mt-8">{children}</div>
      </div>
      <aside className="hidden self-start rounded-xl bg-ink p-7 text-white md:block">
        <h2 className="text-lg font-semibold">Your BizNexa account</h2>
        <ul className="mt-4 space-y-3 text-white/80">
          {['Track every application stage by stage', 'Upload and replace documents anytime', 'Download invoices and certificates', 'Get reminders before due dates'].map((t) => (
            <li key={t} className="flex gap-2.5">
              <Icon name="check" size={18} className="mt-0.5 shrink-0 text-marigold" />
              {t}
            </li>
          ))}
        </ul>
      </aside>
    </div>
  );
}
