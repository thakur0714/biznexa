import { describe, expect, it } from 'vitest';
import { formDataValidator, formSchema, GENERIC_SERVICE_FORM, SERVICE_FORMS, serviceFormFor, type FormField, type FormSchema, type FormSchemaInput } from './index';

const TODAY = '2026-10-10';
const ALL: [string, FormSchemaInput][] = [...Object.entries(SERVICE_FORMS), ['generic', GENERIC_SERVICE_FORM]];

function check(form: FormSchemaInput, data: unknown) {
  const res = formDataValidator(formSchema.parse(form), { today: TODAY }).safeParse(data);
  const errors: Record<string, string> = {};
  if (!res.success) for (const i of res.error.issues) errors[i.path.join('.')] ??= i.message;
  return { data: res.success ? res.data : undefined, errors };
}

/** Every field, with repeater sub-fields as `repeater.sub`. */
function allFields(form: FormSchema): [string, FormField][] {
  return form.steps.flatMap((s) => s.fields.flatMap((f): [string, FormField][] => [[f.name, f], ...(f.type === 'repeater' ? f.fields.map((sub): [string, FormField] => [`${f.name}.${sub.name}`, sub]) : [])]));
}

const address = { line1: '12, Model Town', city: 'Ludhiana', state: 'Punjab', pincode: '141002' };
const person = { fullName: 'Asha Rao', fatherName: 'Vikram Rao', dateOfBirth: '1990-04-12', pan: 'ABCDE1234F', email: 'asha@example.com', mobile: '9876543210', nationality: 'Indian', occupation: 'Business', hasDin: 'No', residentialAddress: address };

describe('ready-made service forms', () => {
  it.each(ALL)('%s is a valid form', (_, form) => {
    expect(formSchema.safeParse(form).error?.issues).toBeUndefined();
  });

  it('covers the top services and falls back to the generic form', () => {
    for (const slug of ['private-limited-company-registration', 'gst-registration', 'trademark-registration', 'iso-9001-certification', 'fssai-registration', 'itr-filing', 'llp-registration', 'msme-udyam-registration', 'annual-compliance', 'website-development']) {
      expect(serviceFormFor(slug)).toBe(SERVICE_FORMS[slug]);
    }
    expect(serviceFormFor('trademark-renewal')).toBe(GENERIC_SERVICE_FORM);
  });

  it('asks for no files, Aadhaar numbers or passwords', () => {
    for (const [, input] of ALL) {
      for (const [name, f] of allFields(formSchema.parse(input))) {
        expect(f.type, name).not.toBe('file');
        expect(name, name).not.toMatch(/aadhaar|password|otp/i);
      }
    }
  });

  it('uses the same type and format for a field name in every form, so answers can be prefilled', () => {
    const seen = new Map<string, { type: string; pattern?: string; where: string }>();
    for (const [slug, input] of ALL) {
      for (const [name, f] of allFields(formSchema.parse(input))) {
        const key = name.split('.').pop()!;
        const shape = { type: f.type, pattern: 'pattern' in f ? f.pattern : undefined };
        const prev = seen.get(key);
        if (prev) expect({ ...shape, where: `${slug} ${name}` }, `${key} in ${prev.where}`).toMatchObject({ type: prev.type, pattern: prev.pattern });
        else seen.set(key, { ...shape, where: `${slug} ${name}` });
      }
    }
    const form = formSchema.parse(SERVICE_FORMS['gst-registration']);
    const entity = allFields(form).find(([n]) => n === 'entityType')![1];
    expect(entity.type === 'select' && entity.options!.map((o) => o.value)).toContain('PRIVATE_LIMITED');
  });
});

describe('private limited company form', () => {
  const form = SERVICE_FORMS['private-limited-company-registration'];
  const answers = {
    proposedName1: 'Nexa Foods',
    proposedName2: 'Nexa Kitchen',
    nameSignificance: 'Nexa means next.',
    businessActivity: 'Food and hospitality',
    activityDescription: 'Packaged snacks',
    authorisedCapital: 100000,
    paidUpCapital: 100000,
    faceValue: 10,
    directors: [
      { ...person, shareholdingPercent: 50 },
      { ...person, fullName: 'Ravi Kumar', pan: 'PQRSX6789K', hasDin: 'Yes', din: '01234567', shareholdingPercent: 50 },
    ],
    otherShareholders: 'No',
    businessAddress: address,
    premises: 'Rented or leased',
    premisesOwnerName: 'Kamal Singh',
  };

  it('accepts a complete application', () => {
    expect(check(form, answers).errors).toEqual({});
  });

  it('needs two directors, a DIN only from those who have one, and checks PAN format', () => {
    const { errors } = check(form, { ...answers, directors: [{ ...person, pan: 'abcde1234f', hasDin: 'Yes', shareholdingPercent: 100 }] });
    expect(Object.keys(errors).sort()).toEqual(['directors', 'directors.0.din', 'directors.0.pan']);
  });

  it('asks for other shareholders only when there are some', () => {
    expect(check(form, { ...answers, shareholders: [{ fullName: 'X' }] }).data).not.toHaveProperty('shareholders');
    expect(Object.keys(check(form, { ...answers, otherShareholders: 'Yes' }).errors)).toEqual(['shareholders']);
  });

  it('asks for the property owner only when the office is not the business’s own', () => {
    const owned = check(form, { ...answers, premises: 'Owned by the business or a director' });
    expect(owned.errors).toEqual({});
    expect(owned.data).not.toHaveProperty('premisesOwnerName');
    expect(check(form, { ...answers, premisesOwnerName: '' }).errors).toEqual({ premisesOwnerName: 'This field is required' });
  });
});

describe('GST registration form', () => {
  const form = SERVICE_FORMS['gst-registration'];
  const answers = {
    businessName: 'Asha Rao',
    tradeName: 'Rao Traders',
    entityType: 'PROPRIETORSHIP',
    businessPan: 'ABCPR1234F',
    state: 'Punjab',
    commencementDate: '2026-11-01',
    reason: 'Starting a new business',
    natureOfBusiness: ['Retail trading'],
    goodsServices: 'Garments',
    expectedTurnover: 'Up to ₹20 lakh',
    composition: 'Not sure — advise me',
    businessAddress: address,
    premises: 'Owned by the business',
    hasAdditionalPlaces: 'No',
    promoters: [{ fullName: 'Asha Rao', fatherName: 'Vikram Rao', dateOfBirth: '1990-04-12', designation: 'Proprietor', pan: 'ABCPR1234F', email: 'asha@example.com', mobile: '9876543210', residentialAddress: address }],
    authorisedSignatory: 'Asha Rao',
  };

  it('accepts an application without bank details, which can follow later', () => {
    expect(check(form, answers).errors).toEqual({});
  });

  it('asks for additional places only when there are some', () => {
    expect(check(form, { ...answers, hasAdditionalPlaces: 'Yes' }).errors).toEqual({ additionalPlaces: 'Add at least one place' });
    expect(check(form, { ...answers, hasAdditionalPlaces: 'Yes', additionalPlaces: [{ address, use: 'Warehouse' }] }).errors).toEqual({});
  });

  it('checks the IFSC and mobile formats', () => {
    const { errors } = check(form, { ...answers, ifsc: 'HDFC1234', promoters: [{ ...answers.promoters[0], mobile: '12345' }] });
    expect(errors).toEqual({ 'promoters.0.mobile': 'Enter a 10-digit Indian mobile number', ifsc: 'Enter an IFSC like HDFC0001234' });
  });
});

describe('other ready-made forms', () => {
  it('trademark: asks for the word only for word marks, and first use cannot be in the future', () => {
    const form = SERVICE_FORMS['trademark-registration'];
    const answers = { applicantType: 'Company', applicantName: 'Nexa Foods Private Limited', applicantAddress: address, contactEmail: 'a@example.com', contactMobile: '9876543210', markType: 'A logo', goodsServices: 'Packaged snacks', classes: ['30'], useStatus: 'Already in use', firstUseDate: '2025-01-01' };
    expect(check(form, answers).errors).toEqual({});
    expect(check(form, { ...answers, markType: 'A word or name', firstUseDate: '2027-01-01' }).errors).toEqual({ brandName: 'This field is required', firstUseDate: 'Date cannot be in the future' });
  });

  it('ITR: deductions are dropped under the new regime; salaried taxpayers give their employer count', () => {
    const form = SERVICE_FORMS['itr-filing'];
    const answers = { fullName: 'Asha Rao', pan: 'ABCPR1234F', dateOfBirth: '1990-04-12', contactEmail: 'a@example.com', contactMobile: '9876543210', residentialStatus: 'Resident', yearType: 'The financial year that just ended', incomeSources: ['Salary or pension'], employers: 1, taxRegime: 'New regime (default)', deductions: ['80D (health insurance)'], noticeReceived: 'No', bankName: 'HDFC Bank', bankAccountNumber: '50100123456789', ifsc: 'HDFC0001234' };
    const ok = check(form, answers);
    expect(ok.errors).toEqual({});
    expect(ok.data).not.toHaveProperty('deductions');
    expect(check(form, { ...answers, employers: undefined }).errors).toEqual({ employers: 'This field is required' });
  });

  it('ISO: the standard is fixed for named standards and asked for “other ISO”', () => {
    const named = formSchema.parse(SERVICE_FORMS['iso-9001-certification']);
    const other = formSchema.parse(SERVICE_FORMS['other-iso-certifications']);
    expect(allFields(named).map(([n]) => n)).not.toContain('standard');
    expect(allFields(other).map(([n]) => n)).toContain('standard');
    expect(JSON.stringify(named)).toContain('ISO 9001:2015');
  });

  it('FSSAI: production capacity only for manufacturers', () => {
    const form = SERVICE_FORMS['fssai-registration'];
    const answers = { businessName: 'Rao Bakery', entityType: 'PROPRIETORSHIP', businessAddress: address, businessKinds: ['Retail shop'], foodProducts: 'Cakes', expectedTurnover: 'Up to ₹12 lakh', multiState: 'No', years: '1 year', contactName: 'Asha Rao', contactEmail: 'a@example.com', contactMobile: '9876543210' };
    expect(check(form, answers).errors).toEqual({});
    expect(check(form, { ...answers, businessKinds: ['Retail shop', 'Manufacturing or processing'] }).errors).toEqual({ productionCapacity: 'This field is required' });
  });

  it('generic: an individual only needs contact details and the requirement', () => {
    const answers = { contactName: 'Asha Rao', contactEmail: 'a@example.com', contactMobile: '9876543210', state: 'Punjab', requirement: 'Need a shop licence', preferredContact: 'WhatsApp' };
    expect(check(GENERIC_SERVICE_FORM, answers)).toEqual({ data: answers, errors: {} });
  });
});
