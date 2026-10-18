import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PERMS } from '@biznexa/types';
import { NAV, findNavItem, visibleNav } from './nav';

const slugs = (perms: string[]) => visibleNav(perms).flatMap((g) => g.items.map((i) => i.slug));
const ALL = Object.values(PERMS);

// Permission bundles as seeded in apps/api/prisma/seed.ts
const OPS = [PERMS.ADMIN_ACCESS, PERMS.APPLICATIONS_VIEW_ASSIGNED, PERMS.APPLICATIONS_UPDATE, PERMS.DOCUMENTS_REVIEW, PERMS.CUSTOMERS_VIEW];
const SUPPORT = [PERMS.ADMIN_ACCESS, PERMS.CUSTOMERS_VIEW, PERMS.PAYMENTS_VIEW, PERMS.TICKETS_MANAGE, PERMS.LEADS_VIEW];
const CONSULTANT = [PERMS.ADMIN_ACCESS, PERMS.APPLICATIONS_VIEW_ASSIGNED];

describe('visibleNav', () => {
  it('shows every section to an admin', () => {
    expect(slugs(ALL)).toEqual(NAV.flatMap((g) => g.items.map((i) => i.slug)));
  });

  it('shows nothing to a customer', () => {
    expect(visibleNav([])).toEqual([]);
  });

  it('shows an operations executive their work queues only', () => {
    expect(slugs(OPS)).toEqual(['', 'applications', 'documents', 'customers']);
  });

  it('shows support customers, payments, tickets and enquiries but no catalogue editing', () => {
    expect(slugs(SUPPORT)).toEqual(['', 'customers', 'support', 'leads', 'payments']);
  });

  it('shows consultants only their own portal sections', () => {
    expect(visibleNav(CONSULTANT, NAV, ['CONSULTANT']).flatMap((g) => g.items.map((i) => i.slug))).toEqual(['consultant/profile', 'consultant/availability', 'consultant/bookings', 'consultant/applications', 'consultant/messages', 'consultant/earnings']);
  });

  it('drops groups that end up empty for regular permission filtered navigation', () => {
    expect(visibleNav(CONSULTANT).map((g) => g.label)).toEqual(['Overview', 'Work']);
  });

  it('has unique slugs', () => {
    const all = NAV.flatMap((g) => g.items.map((i) => i.slug));
    expect(new Set(all).size).toBe(all.length);
  });
});

describe('findNavItem', () => {
  it('finds items by slug', () => {
    expect(findNavItem('services')?.label).toBe('Services');
    expect(findNavItem('nope')).toBeUndefined();
  });
});

describe('built sections', () => {
  // vitest runs from the package root.
  const page = (slug: string) => existsSync(join(process.cwd(), 'src/app/(portal)', slug, 'page.tsx'));

  it('have their own page; the rest use the placeholder', () => {
    for (const item of NAV.flatMap((g) => g.items).filter((i) => i.slug !== '')) {
      expect({ slug: item.slug, page: page(item.slug) }).toEqual({ slug: item.slug, page: !!item.built });
    }
  });
});
