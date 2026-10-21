import { Suspense } from 'react';
import { PortalShell } from '@/components/portal-shell';

export default function PortalLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <Suspense>
      <PortalShell>{children}</PortalShell>
    </Suspense>
  );
}
