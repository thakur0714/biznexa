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
        <AuthProvider>
          <ToastProvider>{children}</ToastProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
