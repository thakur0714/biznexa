import type { Metadata, Viewport } from 'next';
import './globals.css';
import { ToastProvider } from '@biznexa/ui';
import { AuthProvider } from '@/lib/auth';
import { SiteHeader } from '@/components/site-header';
import { SiteFooter } from '@/components/site-footer';
import { api, type CategorySummary } from '@/lib/api';

const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';

export const metadata: Metadata = {
  metadataBase: new URL(SITE),
  title: { default: 'BizNexa — Everything your business needs, in one place', template: '%s | BizNexa' },
  description: 'Register your company, protect your trademark, file GST and income tax, get ISO certified and stay compliant. Apply online and track every step.',
  openGraph: { type: 'website', siteName: 'BizNexa', locale: 'en_IN' },
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { themeColor: '#1f2b7a' };

async function loadCategories() {
  try {
    return await api<CategorySummary[]>('/catalogue/categories', { revalidate: 300 });
  } catch {
    return [];
  }
}

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const categories = await loadCategories();
  return (
    <html lang="en-IN" data-scroll-behavior="smooth">
      {/* Browser extensions (e.g. ColorZilla) add attributes to <body> before hydration. */}
      <body className="min-h-screen antialiased" suppressHydrationWarning>
        <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-white focus:px-4 focus:py-2">
          Skip to content
        </a>
        <AuthProvider>
          <ToastProvider>
            <SiteHeader categories={categories} />
            <main id="main">{children}</main>
            <SiteFooter categories={categories} />
          </ToastProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
