import type { Metadata, Viewport } from 'next';
import './globals.css';
import { ToastProvider } from '@biznexa/ui';
import { AuthProvider } from '@/lib/auth';

export const metadata: Metadata = {
  title: { default: 'BizNexa Admin', template: '%s | BizNexa Admin' },
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { themeColor: '#1f2b7a' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-IN">
      {/* Browser extensions add attributes to <body> before hydration. */}
      <body className="min-h-screen antialiased" suppressHydrationWarning>
        <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-white focus:px-4 focus:py-2 focus:text-night focus:shadow-md focus:outline-2 focus:outline-offset-2 focus:outline-ink">
          Skip to content
        </a>
        <AuthProvider>
          <ToastProvider>{children}</ToastProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
