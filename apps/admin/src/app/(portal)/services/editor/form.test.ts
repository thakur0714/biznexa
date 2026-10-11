import { describe, expect, it } from 'vitest';
import type { AdminServiceDetail } from '@biznexa/types';
import { changedSections, detailsOf, emptyValues, newDocument, newPackage, serviceFormSchema, toFormPath, toFormValues, type ServiceFormValues } from './form';

const CAT = '11111111-1111-4111-8111-111111111111';
const PKG = '22222222-2222-4222-8222-222222222222';

const filled = (over: Partial<ServiceFormValues> = {}): ServiceFormValues => ({
  ...emptyValues(),
  name: 'Pollution NOC',
  slug: 'pollution-noc',
  categoryId: CAT,
  shortDescription: 'Consent to establish from the pollution board.',
  packages: [{ ...newPackage('Basic'), id: PKG, professionalFee: '1,499.50', governmentFee: '' }],
  ...over,
});

const detail: AdminServiceDetail = {
  id: '33333333-3333-4333-8333-333333333333',
  slug: 'pollution-noc',
  name: 'Pollution NOC',
  categoryId: CAT,
  category: { id: CAT, slug: 'licenses', name: 'Licenses' },
  subcategoryId: null,
  shortDescription: 'Consent to establish from the pollution board.',
  overview: null,
  icon: 'stamp',
  imageUrl: null,
  benefits: ['Online', 'Fast'],
  estimatedTime: '10 days',
  estimatedDaysMin: 7,
  estimatedDaysMax: null,
  sacCode: null,
  popularity: 5,
  isPopular: false,
  isActive: true,
  recurrence: 'ANNUAL',
  reminderOffsets: [30, 7],
  seoTitle: null,
  metaDescription: null,
  updatedAt: '2026-10-10T00:00:00.000Z',
  packages: [
    {
      id: PKG,
      name: 'Basic',
      professionalFee: 149950,
      governmentFee: 0,
      gstRate: 18,
      inclusions: ['Filing'],
      estimatedTime: null,
      isMostPopular: false,
      allowPartial: false,
      advancePercent: null,
      isActive: true,
      inUse: true,
    },
  ],
  documents: [{ id: crypto.randomUUID(), name: 'Site plan', description: null, isMandatory: true, acceptedTypes: ['application/pdf'], maxSizeMb: 10, packageIds: [PKG], inUse: false }],
  stages: [{ id: crypto.randomUUID(), name: 'Filed', description: null, sortOrder: 1, inUse: false }],
  faqs: [{ question: 'Valid for how long?', answer: 'Five years.' }],
  relatedServiceIds: [],
};

describe('service form → API request', () => {
  it('converts what the admin typed: rupees to paise, lines to lists, blanks to null', () => {
    const out = serviceFormSchema.parse(filled({ benefits: ' Online \n\nFast ', estimatedDaysMin: '5', imageUrl: '  ', subcategoryId: '' }));
    expect(out.packages[0]).toMatchObject({ id: PKG, professionalFee: 149950, governmentFee: 0, gstRate: 18, advancePercent: null });
    expect(out.benefits).toEqual(['Online', 'Fast']);
    expect(out).toMatchObject({ estimatedDaysMin: 5, estimatedDaysMax: null, imageUrl: null, subcategoryId: null, icon: null, recurrence: null });
    expect(out.stages.map((s) => s.name)).toEqual(['Application received', 'Filed with the department', 'Completed']);
  });

  it('reports problems with the API’s own messages at the form field', () => {
    const res = serviceFormSchema.safeParse(
      filled({
        slug: 'Pollution NOC',
        packages: [{ ...newPackage('B'), professionalFee: 'abc', allowPartial: true }],
        stages: [],
        estimatedDaysMin: 'x',
        recurrence: 'ANNUAL',
        reminderOffsets: '30, soon',
      }),
    );
    const issues = Object.fromEntries(res.error!.issues.map((i) => [i.path.join('.'), i.message]));
    expect(issues).toMatchObject({
      slug: 'Use lowercase letters, numbers and single hyphens',
      'packages.0.name': 'Enter a package name',
      'packages.0.professionalFee': 'Enter an amount',
      stages: 'Add at least one process stage',
      estimatedDaysMin: 'Enter a whole number',
      'reminderOffsets.1': 'Enter a whole number',
    });
  });

  it('asks for the advance when part payment is allowed', () => {
    const res = serviceFormSchema.safeParse(filled({ packages: [{ ...newPackage('Basic'), professionalFee: '999', allowPartial: true }] }));
    expect(res.error!.issues.map((i) => [i.path.join('.'), i.message])).toEqual([['packages.0.advancePercent', 'Enter the advance to collect']]);
  });

  it('drops a removed package from the documents limited to it', () => {
    const doc = { ...newDocument(), name: 'Board resolution', packageIds: [PKG, crypto.randomUUID()] };
    expect(serviceFormSchema.parse(filled({ documents: [doc] })).documents[0].packageIds).toEqual([PKG]);
  });

  it('round-trips a saved service unchanged', () => {
    const values = toFormValues(detail);
    expect(values.packages[0]).toMatchObject({ professionalFee: '1499.50', governmentFee: '', inUse: true });
    const out = serviceFormSchema.parse(values);
    expect(out).toMatchObject({ benefits: detail.benefits, reminderOffsets: [30, 7], icon: 'stamp', estimatedDaysMin: 7 });
    expect(out.packages[0].professionalFee).toBe(149950);
    expect(out.documents[0]).toMatchObject({ id: detail.documents[0].id, packageIds: [PKG] });
    expect(Object.keys(detailsOf(out))).not.toEqual(expect.arrayContaining(['packages']));
    expect(detailsOf(out)).toMatchObject({ name: 'Pollution NOC', slug: 'pollution-noc' });
  });
});

describe('changedSections', () => {
  it('lists only the sections that differ, in save order', () => {
    const saved = toFormValues(detail);
    expect(changedSections(saved, saved)).toEqual([]);
    const edited = { ...saved, faqs: [], name: 'Pollution NOC (Delhi)', packages: [...saved.packages, newPackage('Pro')] };
    expect(changedSections(saved, edited)).toEqual(['details', 'packages', 'faqs']);
    expect(changedSections(saved, { ...saved, relatedServiceIds: [crypto.randomUUID()] })).toEqual(['related']);
  });
});

describe('toFormPath', () => {
  it('maps API error fields onto form fields', () => {
    expect(toFormPath('slug')).toBe('slug');
    expect(toFormPath('benefits.3')).toBe('benefits');
    expect(toFormPath('0.name', 'packages')).toBe('packages.0.name');
    expect(toFormPath('1.inclusions.4', 'packages')).toBe('packages.1.inclusions');
    expect(toFormPath('', 'relatedServiceIds')).toBe('relatedServiceIds');
    expect(toFormPath('documents.0.packageIds')).toBe('documents.0.packageIds');
  });
});
