'use client';

import { NotAllowed } from '@/components/portal-shell';
import { EmptyState } from '@biznexa/ui';
import { useAuth } from '@/lib/auth';
import { canSee, findNavItem } from '@/lib/nav';

/** Placeholder for portal sections whose screens are built in later milestones. */
export function SectionView({ slug }: { slug: string }) {
  const { user } = useAuth();
  const item = findNavItem(slug);
  if (!item || !user) return null;
  if (!canSee(item, user.permissions)) return <NotAllowed />;

  return (
    <div className="max-w-[960px]">
      <h1 className="text-2xl font-bold tracking-[-0.02em]">{item.label}</h1>
      <EmptyState className="mt-6" title="Coming soon" description="This section is being built. It will appear here in an upcoming release." />
    </div>
  );
}
