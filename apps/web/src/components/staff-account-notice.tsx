'use client';

import { Button } from '@biznexa/ui';
import { useAuth } from '@/lib/auth';

export const STAFF_ACCOUNT_MESSAGE =
  'This is a staff account. Customer pages are not available here. Please use the admin portal.';

export function StaffAccountNotice() {
  const { signOut } = useAuth();
  const adminUrl = process.env.NEXT_PUBLIC_ADMIN_URL;

  return (
    <main className="mx-auto max-w-[720px] px-6 py-24 text-center">
      <h1 className="text-2xl font-bold text-night">Staff account</h1>
      <p className="mt-3 text-muted">{STAFF_ACCOUNT_MESSAGE}</p>
      <div className="mt-6 flex flex-wrap items-center justify-center gap-4">
        {adminUrl && (
          <a className="font-semibold text-ink underline" href={adminUrl}>
            Open admin portal
          </a>
        )}
        <Button type="button" variant="outline" onClick={() => void signOut()}>
          Sign out
        </Button>
      </div>
    </main>
  );
}
