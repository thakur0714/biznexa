/**
 * Ready-made application forms (M3.5): realistic forms for the most-ordered services and a generic
 * form for every other service. The seed saves them as `ServiceFormSchema` versions; admins then own
 * them and change them in the form builder (M3.4).
 *
 * Conventions:
 * - Documents (PAN card, address proof, logo files…) are collected by the service's document
 *   checklist (M3.10), not by these forms, so customers never upload the same file twice.
 * - Aadhaar numbers, portal passwords and OTPs are never asked for; an expert collects OTP consent
 *   when filing.
 * - Business fields use the same names everywhere so the form page (M3.9) can prefill them from a
 *   saved `BusinessEntity`: `businessName`, `entityType` (values match `BusinessEntity.entityType`),
 *   `businessPan`, `gstin`, `cin`, `businessAddress`, and `contactName` / `contactEmail` /
 *   `contactMobile` for the person we speak to.
 */
import type { FormSchemaInput } from './form-schema';
import { ENTITY_TYPES as SHARED_ENTITY_TYPES } from './business-entities';

type Field = FormSchemaInput['steps'][number]['fields'][number];
type Step = FormSchemaInput['steps'][number];
/** Any field but a repeater — what a repeater row may contain. */
type Leaf = Exclude<Field, { type: 'repeater' }>;

// ─────────────── Formats ───────────────

export const FORM_PATTERNS = {
  pan: { pattern: '[A-Z]{5}[0-9]{4}[A-Z]', patternMessage: 'Enter a PAN like ABCDE1234F (capital letters)' },
  gstin: { pattern: '\\d{2}[A-Z]{5}\\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]', patternMessage: 'Enter a 15-character GSTIN like 03ABCDE1234F1Z5' },
  cin: { pattern: '[LU]\\d{5}[A-Z]{2}\\d{4}[A-Z]{3}\\d{6}', patternMessage: 'Enter a 21-character CIN like U74999PB2020PTC012345' },
  din: { pattern: '\\d{8}', patternMessage: 'A DIN has 8 digits' },
  mobile: { pattern: '[6-9]\\d{9}', patternMessage: 'Enter a 10-digit Indian mobile number' },
  ifsc: { pattern: '[A-Z]{4}0[A-Z0-9]{6}', patternMessage: 'Enter an IFSC like HDFC0001234' },
  bankAccount: { pattern: '\\d{9,18}', patternMessage: 'An account number has 9 to 18 digits' },
  fssaiNumber: { pattern: '\\d{14}', patternMessage: 'An FSSAI number has 14 digits' },
} as const;

/** Same values as `BusinessEntity.entityType`, so answers prefill from a saved business. */
const ENTITY_TYPES = [...SHARED_ENTITY_TYPES];

const YES_NO = ['Yes', 'No'];

// ─────────────── Field builders ───────────────

const text = (name: string, label: string, extra: Partial<Extract<Leaf, { type: 'text' }>> = {}): Leaf => ({ type: 'text', name, label, required: true, maxLength: 200, ...extra });
const longText = (name: string, label: string, extra: Partial<Extract<Leaf, { type: 'textarea' }>> = {}): Leaf => ({ type: 'textarea', name, label, required: true, maxLength: 2000, ...extra });
const choose = (name: string, label: string, options: Extract<Leaf, { type: 'select' }>['options'], extra: Partial<Extract<Leaf, { type: 'select' }>> = {}): Leaf => ({ type: 'select', name, label, required: true, options, ...extra });
const pan = (name: string, label = 'PAN', extra: Partial<Extract<Leaf, { type: 'text' }>> = {}): Leaf => text(name, label, { ...FORM_PATTERNS.pan, maxLength: 10, ...extra });
const email = (name: string, label = 'Email'): Leaf => ({ type: 'email', name, label, required: true });
const mobile = (name: string, label = 'Mobile number'): Leaf => ({ type: 'tel', name, label, required: true, ...FORM_PATTERNS.mobile });
const dateOfBirth = (name = 'dateOfBirth'): Leaf => ({ type: 'date', name, label: 'Date of birth', required: true, min: '1900-01-01', max: 'today' });

const businessName = (label = 'Business name', extra: Partial<Extract<Leaf, { type: 'text' }>> = {}): Leaf => text('businessName', label, extra);
const state = (label = 'State'): Leaf => ({ type: 'select', name: 'state', label, required: true, optionsSource: 'states' });
const entityType = (extra: Partial<Extract<Leaf, { type: 'select' }>> = {}): Leaf => choose('entityType', 'Type of business', ENTITY_TYPES, extra);
const gstin = (required = false): Leaf => text('gstin', 'GSTIN', { required, maxLength: 15, ...FORM_PATTERNS.gstin, helpText: required ? undefined : 'Leave blank if you are not registered under GST.' });

const contactStep = (description = 'The person our expert will call and email about this application.'): Step => ({
  title: 'Contact person',
  description,
  fields: [text('contactName', 'Full name'), text('contactDesignation', 'Designation', { required: false, helpText: 'For example Director, Partner or Owner.' }), email('contactEmail'), mobile('contactMobile')],
});

const bankFields = (required: boolean, helpText?: string): Leaf[] => [
  text('bankName', 'Bank name', { required, helpText }),
  text('bankAccountNumber', 'Account number', { required, maxLength: 18, ...FORM_PATTERNS.bankAccount }),
  text('ifsc', 'IFSC', { required, maxLength: 11, ...FORM_PATTERNS.ifsc }),
];

const premisesFields = (ownedLabel = 'Owned by the business'): Leaf[] => [
  choose('premises', 'The premises are', [ownedLabel, 'Owned by a director, partner or relative', 'Rented or leased']),
  text('premisesOwnerName', 'Name of the property owner', { showIf: { field: 'premises', oneOf: ['Owned by a director, partner or relative', 'Rented or leased'] }, helpText: 'We prepare the no-objection letter in this name.' }),
];

const BUSINESS_ACTIVITIES = ['Manufacturing', 'Trading', 'IT and software services', 'Professional and consulting services', 'Food and hospitality', 'Construction and real estate', 'Education and training', 'Healthcare', 'E-commerce', 'Other'];

/** Proposed names, the activity and the main objects — shared by company, OPC and LLP forms. */
function nameStep(kind: 'company' | 'LLP'): Step {
  return {
    title: `Proposed ${kind} name`,
    description: 'Give two names in order of preference. We check availability with the Registrar before filing.',
    fields: [
      text('proposedName1', 'First choice of name', { maxLength: 120, helpText: kind === 'LLP' ? 'Without “LLP” — it is added automatically.' : 'Without “Private Limited” — it is added automatically.' }),
      text('proposedName2', 'Second choice of name', { maxLength: 120 }),
      longText('nameSignificance', 'What does the name mean?', { maxLength: 500, helpText: 'The Registrar asks for the meaning of invented or non-English words.' }),
      choose('businessActivity', 'Main business activity', BUSINESS_ACTIVITIES),
      longText('activityDescription', `What will the ${kind} do?`, { helpText: 'Describe the products or services in a few lines. We draft the objects clause from this.' }),
    ],
  };
}

function personFields(opts: { din?: boolean; occupation?: boolean } = {}): Leaf[] {
  return [
    text('fullName', 'Full name (as on PAN)'),
    text('fatherName', "Father's name"),
    dateOfBirth(),
    pan('pan'),
    email('email'),
    mobile('mobile'),
    choose('nationality', 'Nationality', ['Indian', 'Foreign national']),
    ...(opts.occupation ? [choose('occupation', 'Occupation', ['Business', 'Salaried', 'Professional', 'Student', 'Homemaker', 'Other'])] : []),
    ...(opts.din
      ? [choose('hasDin', 'Already has a DIN?', YES_NO), text('din', 'DIN', { ...FORM_PATTERNS.din, maxLength: 8, showIf: { field: 'hasDin', equals: 'Yes' } })]
      : []),
    { type: 'address', name: 'residentialAddress', label: 'Residential address', required: true },
  ];
}

const registeredOfficeStep: Step = {
  title: 'Registered office',
  description: 'The official address on record. A home address is fine.',
  fields: [{ type: 'address', name: 'businessAddress', label: 'Registered office address', required: true }, ...premisesFields('Owned by the business or a director')],
};

// ─────────────── Company registration ───────────────

const privateLimited: FormSchemaInput = {
  steps: [
    nameStep('company'),
    {
      title: 'Capital',
      fields: [
        { type: 'number', name: 'authorisedCapital', label: 'Authorised capital (₹)', required: true, min: 10_000, max: 100_000_000, integer: true, helpText: 'The most share capital the company can issue. ₹1,00,000 is common; stamp duty depends on it.' },
        { type: 'number', name: 'paidUpCapital', label: 'Paid-up capital (₹)', required: true, min: 1_000, max: 100_000_000, integer: true, helpText: 'What shareholders put in at the start. Must not be more than the authorised capital.' },
        { type: 'number', name: 'faceValue', label: 'Face value per share (₹)', required: true, min: 1, max: 1_000, integer: true, helpText: '₹10 is most common.' },
      ],
    },
    {
      title: 'Directors and shareholders',
      description: 'A private limited company needs at least two directors, and at least one must have lived in India for 182 days in the last year.',
      fields: [
        {
          type: 'repeater',
          name: 'directors',
          label: 'Directors',
          itemLabel: 'Director',
          required: true,
          minItems: 2,
          maxItems: 15,
          fields: [
            ...personFields({ din: true, occupation: true }),
            { type: 'number', name: 'shareholdingPercent', label: 'Shareholding (%)', required: true, min: 0, max: 100, helpText: 'Enter 0 if this director will not hold shares.' },
          ],
        },
        choose('otherShareholders', 'Are there shareholders who are not directors?', YES_NO),
        {
          type: 'repeater',
          name: 'shareholders',
          label: 'Other shareholders',
          itemLabel: 'Shareholder',
          required: true,
          minItems: 1,
          maxItems: 100,
          showIf: { field: 'otherShareholders', equals: 'Yes' },
          fields: [text('fullName', 'Full name (as on PAN)'), pan('pan'), email('email'), mobile('mobile'), { type: 'number', name: 'shareholdingPercent', label: 'Shareholding (%)', required: true, min: 0, max: 100 }],
        },
      ],
    },
    registeredOfficeStep,
  ],
};

const onePersonCompany: FormSchemaInput = {
  steps: [
    { ...nameStep('company'), fields: nameStep('company').fields.map((f) => (f.name === 'proposedName1' ? { ...f, helpText: 'Without “(OPC) Private Limited” — it is added automatically.' } : f)) },
    {
      title: 'Capital',
      fields: [
        { type: 'number', name: 'authorisedCapital', label: 'Authorised capital (₹)', required: true, min: 10_000, max: 100_000_000, integer: true, helpText: '₹1,00,000 is common; stamp duty depends on it.' },
        { type: 'number', name: 'paidUpCapital', label: 'Paid-up capital (₹)', required: true, min: 1_000, max: 100_000_000, integer: true },
      ],
    },
    {
      title: 'Owner',
      description: 'The only member of an OPC is also its first director, and must be an Indian citizen living in India.',
      fields: personFields({ din: true, occupation: true }),
    },
    {
      title: 'Nominee',
      description: 'The person who becomes the member if the owner dies or cannot continue. They give written consent (we provide the format).',
      fields: [
        text('nomineeName', 'Nominee full name (as on PAN)'),
        choose('nomineeRelationship', 'Relationship to the owner', ['Spouse', 'Parent', 'Child', 'Sibling', 'Other relative', 'Other']),
        pan('nomineePan', 'Nominee PAN'),
        email('nomineeEmail', 'Nominee email'),
        mobile('nomineeMobile', 'Nominee mobile number'),
        { type: 'address', name: 'nomineeAddress', label: 'Nominee address', required: true },
      ],
    },
    registeredOfficeStep,
  ],
};

const llp: FormSchemaInput = {
  steps: [
    nameStep('LLP'),
    {
      title: 'Partners',
      description: 'An LLP needs at least two designated partners, and at least one must have lived in India for 182 days in the last year.',
      fields: [
        { type: 'number', name: 'totalContribution', label: 'Total capital contribution (₹)', required: true, min: 1_000, max: 100_000_000, integer: true, helpText: 'Money the partners put into the LLP. Fees and stamp duty depend on it.' },
        {
          type: 'repeater',
          name: 'partners',
          label: 'Partners',
          itemLabel: 'Partner',
          required: true,
          minItems: 2,
          maxItems: 50,
          fields: [
            ...personFields({ din: true, occupation: true }),
            choose('designatedPartner', 'Designated partner?', YES_NO, { helpText: 'Designated partners are responsible for compliance. At least two are needed.' }),
            { type: 'number', name: 'contribution', label: 'Capital contribution (₹)', required: true, min: 0, integer: true },
            { type: 'number', name: 'profitSharePercent', label: 'Profit share (%)', required: true, min: 0, max: 100 },
          ],
        },
      ],
    },
    registeredOfficeStep,
  ],
};

const udyam: FormSchemaInput = {
  steps: [
    {
      title: 'Owner',
      description: 'The proprietor, managing partner, or director who registers the enterprise. They confirm with an Aadhaar OTP when we file.',
      fields: [
        text('ownerName', 'Full name (as on Aadhaar)'),
        choose('socialCategory', 'Social category', ['General', 'SC', 'ST', 'OBC']),
        choose('gender', 'Gender', ['Male', 'Female', 'Transgender']),
        choose('speciallyAbled', 'Specially abled (divyang)?', YES_NO),
        email('contactEmail'),
        mobile('contactMobile', 'Mobile number linked to Aadhaar'),
      ],
    },
    {
      title: 'Enterprise',
      fields: [
        businessName('Name of the enterprise'),
        entityType(),
        pan('businessPan', 'PAN of the enterprise', { helpText: "For a proprietorship, the owner's PAN." }),
        gstin(),
        { type: 'date', name: 'commencementDate', label: 'Date business started', required: true, min: '1900-01-01', max: 'today' },
        { type: 'address', name: 'businessAddress', label: 'Official address of the enterprise', required: true },
      ],
    },
    {
      title: 'Activity and size',
      description: 'Investment and turnover decide whether you are a micro, small or medium enterprise.',
      fields: [
        choose('activityType', 'Main activity', ['Manufacturing', 'Services', 'Trading']),
        longText('activityDescription', 'Main products or services', { maxLength: 500 }),
        { type: 'number', name: 'employees', label: 'Number of employees', required: true, min: 0, max: 1_000_000, integer: true },
        { type: 'number', name: 'investment', label: 'Investment in plant, machinery or equipment (₹)', required: true, min: 0, integer: true, helpText: 'Written-down value from the last return, or purchase cost for a new business.' },
        { type: 'number', name: 'lastYearTurnover', label: 'Turnover last financial year (₹)', required: true, min: 0, integer: true, helpText: 'Enter 0 for a new business.' },
        ...bankFields(true),
      ],
    },
  ],
};

// ─────────────── GST ───────────────

const gstRegistration: FormSchemaInput = {
  steps: [
    {
      title: 'Business',
      fields: [
        businessName('Legal name of the business', { helpText: 'Exactly as on the PAN.' }),
        text('tradeName', 'Trade name', { required: false, helpText: 'The brand or shop name, if different.' }),
        entityType(),
        pan('businessPan', 'PAN of the business', { helpText: "For a proprietorship, the owner's PAN." }),
        state('State of registration'),
        { type: 'date', name: 'commencementDate', label: 'Date business started or will start', required: true, min: '1900-01-01' },
        choose('reason', 'Reason for registering', ['Turnover above the threshold', 'Selling to other states', 'Selling on e-commerce platforms', 'Starting a new business', 'Voluntary', 'Other']),
        longText('reasonDetails', 'Tell us more', { maxLength: 500, showIf: { field: 'reason', equals: 'Other' } }),
      ],
    },
    {
      title: 'What you sell',
      fields: [
        {
          type: 'multi-select',
          name: 'natureOfBusiness',
          label: 'Nature of business',
          required: true,
          minItems: 1,
          options: ['Manufacturing', 'Wholesale trading', 'Retail trading', 'Services', 'Works contract', 'Import', 'Export', 'E-commerce selling', 'Office / warehouse only'],
        },
        longText('goodsServices', 'Main goods or services', { maxLength: 1000, helpText: 'List up to five. Add HSN or SAC codes if you know them — otherwise we find them.' }),
        choose('expectedTurnover', 'Expected turnover this year', ['Up to ₹20 lakh', '₹20 lakh – ₹40 lakh', '₹40 lakh – ₹1.5 crore', '₹1.5 crore – ₹5 crore', 'Above ₹5 crore']),
        choose('composition', 'Interested in the composition scheme?', ['Yes', 'No', 'Not sure — advise me'], { helpText: 'A lower fixed tax rate for small businesses with turnover up to ₹1.5 crore, without input tax credit.' }),
      ],
    },
    {
      title: 'Place of business',
      fields: [
        { type: 'address', name: 'businessAddress', label: 'Principal place of business', required: true },
        ...premisesFields(),
        choose('hasAdditionalPlaces', 'Other offices, shops or warehouses in the same state?', YES_NO),
        {
          type: 'repeater',
          name: 'additionalPlaces',
          label: 'Additional places of business',
          itemLabel: 'Place',
          required: true,
          minItems: 1,
          maxItems: 20,
          showIf: { field: 'hasAdditionalPlaces', equals: 'Yes' },
          fields: [{ type: 'address', name: 'address', label: 'Address', required: true }, choose('use', 'Used as', ['Office', 'Shop', 'Warehouse', 'Factory', 'Other'])],
        },
      ],
    },
    {
      title: 'Owners and authorised signatory',
      description: 'Add the proprietor, every partner, or every director.',
      fields: [
        {
          type: 'repeater',
          name: 'promoters',
          label: 'Proprietor, partners or directors',
          itemLabel: 'Person',
          required: true,
          minItems: 1,
          maxItems: 20,
          fields: [
            text('fullName', 'Full name (as on PAN)'),
            text('fatherName', "Father's name"),
            dateOfBirth(),
            choose('designation', 'Role', ['Proprietor', 'Partner', 'Director', 'Karta', 'Other']),
            pan('pan'),
            email('email'),
            mobile('mobile'),
            { type: 'address', name: 'residentialAddress', label: 'Residential address', required: true },
          ],
        },
        text('authorisedSignatory', 'Authorised signatory', { helpText: 'Name of the person above who will sign GST returns. GST OTPs go to their mobile and email.' }),
      ],
    },
    {
      title: 'Bank account',
      description: 'Optional now — bank details can be added within 45 days of registration.',
      fields: bankFields(false),
    },
  ],
};

// ─────────────── Income tax ───────────────

const itrFiling: FormSchemaInput = {
  steps: [
    {
      title: 'Taxpayer',
      fields: [
        text('fullName', 'Full name (as on PAN)'),
        pan('pan'),
        dateOfBirth(),
        email('contactEmail'),
        mobile('contactMobile'),
        choose('residentialStatus', 'Residential status', ['Resident', 'Non-resident (NRI)', 'Not sure — advise me']),
        choose('yearType', 'Return for', ['The financial year that just ended', 'An earlier year (belated or updated return)']),
        text('earlierYear', 'Which financial year?', { placeholder: '2023-24', maxLength: 7, pattern: '20\\d{2}-\\d{2}', patternMessage: 'Write the year like 2023-24', showIf: { field: 'yearType', equals: 'An earlier year (belated or updated return)' } }),
      ],
    },
    {
      title: 'Income',
      description: 'Pick every source of income you had during the year.',
      fields: [
        {
          type: 'multi-select',
          name: 'incomeSources',
          label: 'Sources of income',
          required: true,
          minItems: 1,
          options: ['Salary or pension', 'House property (rent or home loan)', 'Business or profession', 'Capital gains (shares, mutual funds, property)', 'Interest and dividends', 'Crypto or other virtual assets', 'Foreign income or assets', 'Other'],
        },
        { type: 'number', name: 'employers', label: 'Number of employers during the year', required: true, min: 1, max: 20, integer: true, showIf: { field: 'incomeSources', equals: 'Salary or pension' } },
        longText('businessDetails', 'Describe the business or profession', { maxLength: 500, helpText: 'Include approximate turnover and whether books of accounts are kept.', showIf: { field: 'incomeSources', equals: 'Business or profession' } }),
        longText('capitalGainsDetails', 'What did you sell?', { maxLength: 1000, helpText: 'For example: listed shares through Zerodha, a flat sold in March.', showIf: { field: 'incomeSources', equals: 'Capital gains (shares, mutual funds, property)' } }),
        longText('otherIncome', 'Describe the other income', { maxLength: 500, showIf: { field: 'incomeSources', equals: 'Other' } }),
      ],
    },
    {
      title: 'Tax regime and deductions',
      fields: [
        choose('taxRegime', 'Tax regime', ['New regime (default)', 'Old regime', 'Not sure — compare both for me']),
        {
          type: 'multi-select',
          name: 'deductions',
          label: 'Deductions you can claim',
          helpText: 'Only allowed under the old regime. Keep the proofs ready for the document step.',
          showIf: { field: 'taxRegime', oneOf: ['Old regime', 'Not sure — compare both for me'] },
          options: ['80C (PF, PPF, ELSS, life insurance, tuition fees)', '80D (health insurance)', 'Home loan interest', 'House rent allowance (HRA)', '80CCD(1B) (NPS)', '80E (education loan interest)', '80G (donations)', 'Other'],
        },
        choose('noticeReceived', 'Received any notice from the Income Tax Department?', YES_NO),
        longText('noticeDetails', 'Describe the notice', { maxLength: 1000, showIf: { field: 'noticeReceived', equals: 'Yes' } }),
      ],
    },
    {
      title: 'Refund bank account',
      description: 'Any refund is paid into this account. It must be in your name and linked to your PAN.',
      fields: bankFields(true),
    },
  ],
};

// ─────────────── Trademark ───────────────

const NICE_CLASSES = Array.from({ length: 45 }, (_, i) => ({ value: String(i + 1), label: `Class ${i + 1} — ${i < 34 ? 'goods' : 'services'}` }));

const trademarkRegistration: FormSchemaInput = {
  steps: [
    {
      title: 'Applicant',
      description: 'The person or business that will own the trademark.',
      fields: [
        choose('applicantType', 'Applicant is', ['Individual or sole proprietor', 'Startup (DPIIT-recognised)', 'Small enterprise (Udyam-registered)', 'Partnership firm or LLP', 'Company', 'Trust or society', 'Other'], {
          helpText: 'Individuals, startups and small enterprises pay a lower government fee.',
        }),
        text('applicantName', 'Applicant name', { helpText: 'Exactly as it should appear on the certificate. For a proprietor, their own name.' }),
        businessName('Business or trading name', { required: false, helpText: 'If the applicant trades under another name.' }),
        { type: 'address', name: 'applicantAddress', label: 'Applicant address', required: true },
        email('contactEmail'),
        mobile('contactMobile'),
      ],
    },
    {
      title: 'Your trademark',
      fields: [
        choose('markType', 'What do you want to register?', ['A word or name', 'A logo', 'A word and logo together']),
        text('brandName', 'Word or name to register', { maxLength: 120, showIf: { field: 'markType', oneOf: ['A word or name', 'A word and logo together'] } }),
        longText('logoDescription', 'Describe the logo', { required: false, maxLength: 500, helpText: 'You upload the logo file in the document step.', showIf: { field: 'markType', oneOf: ['A logo', 'A word and logo together'] } }),
        longText('meaning', 'Meaning or translation', { required: false, maxLength: 500, helpText: 'Needed if the mark has words in another language or invented words.' }),
      ],
    },
    {
      title: 'Goods and services',
      fields: [
        longText('goodsServices', 'What will you sell under this brand?', { helpText: 'Be specific, e.g. “ready-made garments for men and women”, “mobile app for booking salons”.' }),
        {
          type: 'multi-select',
          name: 'classes',
          label: 'Trademark classes',
          helpText: 'Not sure? Leave blank and our expert picks them. The government fee is charged per class.',
          options: NICE_CLASSES,
          maxItems: 45,
        },
        choose('useStatus', 'Is the brand already in use?', ['Already in use', 'Not yet — proposed to be used']),
        { type: 'date', name: 'firstUseDate', label: 'Date of first use', required: true, min: '1900-01-01', max: 'today', helpText: 'An approximate date is fine; you will need some proof of use (invoices, ads).', showIf: { field: 'useStatus', equals: 'Already in use' } },
      ],
    },
  ],
};

// ─────────────── ISO certification ───────────────

const isoForm = (standard?: string): FormSchemaInput => ({
  steps: [
    {
      title: 'Organisation',
      fields: [
        businessName('Organisation name', { helpText: 'As it should appear on the certificate.' }),
        entityType(),
        gstin(),
        { type: 'address', name: 'businessAddress', label: 'Main address', required: true },
        text('website', 'Website', { required: false, placeholder: 'https://' }),
        { type: 'number', name: 'employees', label: 'Number of employees (including contract staff)', required: true, min: 1, max: 1_000_000, integer: true, helpText: 'Audit time depends on headcount.' },
      ],
    },
    {
      title: 'Certification scope',
      fields: [
        ...(standard
          ? []
          : [
              choose('standard', 'Standard', ['ISO 50001 — Energy management', 'ISO/IEC 20000-1 — IT service management', 'ISO 22301 — Business continuity', 'ISO 37001 — Anti-bribery', 'ISO 41001 — Facility management', 'Other']),
              text('otherStandard', 'Which standard?', { maxLength: 100, showIf: { field: 'standard', equals: 'Other' } }),
            ]),
        longText('scope', 'What should the certificate cover?', {
          helpText: `The products, services and activities to be certified${standard ? ` under ${standard}` : ''}, e.g. “Design, manufacture and supply of LED lighting”.`,
        }),
        longText('outsourcedProcesses', 'Processes done by outside parties', { required: false, maxLength: 1000, helpText: 'For example job work, transport or IT support.' }),
        choose('hasOtherSites', 'Should other sites be covered too?', YES_NO),
        {
          type: 'repeater',
          name: 'otherSites',
          label: 'Other sites',
          itemLabel: 'Site',
          required: true,
          minItems: 1,
          maxItems: 20,
          showIf: { field: 'hasOtherSites', equals: 'Yes' },
          fields: [text('siteName', 'Site name', { placeholder: 'Plant 2, Branch office…' }), { type: 'address', name: 'address', label: 'Address', required: true }, { type: 'number', name: 'employees', label: 'Employees at this site', required: true, min: 1, integer: true }],
        },
      ],
    },
    {
      title: 'Current status',
      fields: [
        choose('currentCertification', 'Do you hold this certification now?', ['No — first certification', 'Yes — renewal', 'Yes — transfer from another body']),
        text('currentBody', 'Current certification body', { showIf: { field: 'currentCertification', oneOf: ['Yes — renewal', 'Yes — transfer from another body'] } }),
        { type: 'date', name: 'currentExpiry', label: 'Current certificate valid until', required: true, showIf: { field: 'currentCertification', oneOf: ['Yes — renewal', 'Yes — transfer from another body'] } },
        choose('systemReady', 'Is your management system documented?', ['Yes — policies and procedures are in place', 'Partly', 'No — we need help building it']),
        { type: 'date', name: 'targetDate', label: 'Certificate needed by', min: 'today', helpText: 'Optional — for a tender or customer deadline.' },
      ],
    },
    contactStep(),
  ],
});

const ISO_STANDARDS: Record<string, string> = {
  'iso-9001-certification': 'ISO 9001:2015',
  'iso-14001-certification': 'ISO 14001:2015',
  'iso-45001-certification': 'ISO 45001:2018',
  'iso-27001-certification': 'ISO/IEC 27001:2022',
  'iso-22000-certification': 'ISO 22000:2018',
  'iso-13485-certification': 'ISO 13485:2016',
};

// ─────────────── Licences ───────────────

const fssaiRegistration: FormSchemaInput = {
  steps: [
    {
      title: 'Food business',
      fields: [
        businessName('Name of the food business'),
        entityType(),
        pan('businessPan', 'PAN of the business', { required: false, helpText: "For a proprietorship, the owner's PAN." }),
        gstin(),
        { type: 'address', name: 'businessAddress', label: 'Address of the food premises', required: true, helpText: 'Where food is made, stored or sold. For a cloud or home kitchen, the kitchen address.' },
      ],
    },
    {
      title: 'Activities',
      description: 'Your turnover and activities decide whether you need a basic registration, a state licence or a central licence.',
      fields: [
        {
          type: 'multi-select',
          name: 'businessKinds',
          label: 'What does the business do?',
          required: true,
          minItems: 1,
          options: ['Manufacturing or processing', 'Restaurant, cafe or caterer', 'Cloud kitchen or home-based food', 'Retail shop', 'Wholesale or distribution', 'Storage or warehouse', 'Transport of food', 'Import', 'Export', 'E-commerce selling', 'Other'],
        },
        longText('foodProducts', 'Food products you make, store or sell', { maxLength: 1000, helpText: 'For example: bakery items, packaged spices, dairy products.' }),
        { type: 'number', name: 'productionCapacity', label: 'Production capacity (kg or litres per day)', required: true, min: 0, showIf: { field: 'businessKinds', equals: 'Manufacturing or processing' } },
        choose('expectedTurnover', 'Expected yearly turnover', ['Up to ₹12 lakh', '₹12 lakh – ₹20 crore', 'Above ₹20 crore']),
        choose('multiState', 'Do you operate in more than one state?', YES_NO, { helpText: 'Businesses operating in several states, importers and some others need a central licence.' }),
        choose('years', 'Registration period', ['1 year', '2 years', '3 years', '4 years', '5 years'], { helpText: 'The government fee is charged per year.' }),
      ],
    },
    contactStep('The person responsible for food safety at the business.'),
  ],
};

const importExportCode: FormSchemaInput = {
  steps: [
    {
      title: 'Business',
      fields: [
        businessName('Name of the business', { helpText: 'Exactly as on the PAN.' }),
        entityType(),
        pan('businessPan', 'PAN of the business', { helpText: "For a proprietorship, the owner's PAN. The IEC number is the same as this PAN." }),
        gstin(),
        { type: 'date', name: 'incorporationDate', label: 'Date of incorporation or start of business', required: true, min: '1900-01-01', max: 'today' },
        { type: 'address', name: 'businessAddress', label: 'Registered address', required: true },
      ],
    },
    {
      title: 'Trade',
      fields: [
        choose('tradeType', 'You plan to', ['Import', 'Export', 'Import and export']),
        choose('tradeIn', 'Trade in', ['Goods', 'Services', 'Goods and services']),
        longText('products', 'Main products or services', { maxLength: 1000 }),
      ],
    },
    { title: 'Bank account', description: 'A current account in the name of the business.', fields: bankFields(true) },
    {
      title: 'Authorised signatory',
      fields: [text('contactName', 'Full name (as on PAN)'), text('contactDesignation', 'Designation', { helpText: 'For example Proprietor, Partner or Director.' }), pan('signatoryPan', 'PAN of the signatory'), email('contactEmail'), mobile('contactMobile')],
    },
  ],
};

// ─────────────── Compliance ───────────────

const annualCompliance: FormSchemaInput = {
  steps: [
    {
      title: 'Company',
      fields: [
        businessName('Company name'),
        text('cin', 'CIN', { maxLength: 21, ...FORM_PATTERNS.cin }),
        choose('entityType', 'Type of company', [
          { value: 'PRIVATE_LIMITED', label: 'Private Limited Company' },
          { value: 'OPC', label: 'One Person Company (OPC)' },
          { value: 'SECTION_8', label: 'Section 8 company' },
        ]),
        { type: 'date', name: 'incorporationDate', label: 'Date of incorporation', required: true, min: '1900-01-01', max: 'today' },
        choose('turnoverBand', 'Turnover last financial year', ['Nil — no business yet', 'Up to ₹40 lakh', '₹40 lakh – ₹2 crore', '₹2 crore – ₹50 crore', 'Above ₹50 crore']),
      ],
    },
    {
      title: 'Where things stand',
      fields: [
        choose('auditorAppointed', 'Is a statutory auditor appointed?', ['Yes', 'No', 'Not sure']),
        text('auditorName', 'Auditor or audit firm', { showIf: { field: 'auditorAppointed', equals: 'Yes' } }),
        choose('pastFilings', 'Are earlier years’ ROC filings done?', ['Yes — all filed', 'Some are pending', 'This is our first year', 'Not sure']),
        longText('pendingFilings', 'Which filings are pending?', { required: false, maxLength: 1000, helpText: 'Years or forms, if you know them. We check the MCA records either way.', showIf: { field: 'pastFilings', equals: 'Some are pending' } }),
        choose('books', 'Books of accounts are', ['Kept by us', 'Kept by our accountant', 'Not kept — we need bookkeeping help']),
        text('accountingSoftware', 'Accounting software', { required: false, placeholder: 'Tally, Zoho Books…' }),
      ],
    },
    {
      title: 'Directors',
      fields: [
        {
          type: 'repeater',
          name: 'directors',
          label: 'Directors',
          itemLabel: 'Director',
          required: true,
          minItems: 1,
          maxItems: 15,
          fields: [text('fullName', 'Full name'), text('din', 'DIN', { ...FORM_PATTERNS.din, maxLength: 8 }), email('email'), mobile('mobile'), choose('dscStatus', 'Digital signature (DSC)', ['Valid', 'Expired or none', 'Not sure'])],
        },
      ],
    },
    contactStep(),
  ],
};

// ─────────────── Technology ───────────────

const websiteDevelopment: FormSchemaInput = {
  steps: [
    {
      title: 'Your business',
      fields: [
        businessName(),
        text('industry', 'Industry', { placeholder: 'Interior design, dental clinic, packaging…' }),
        longText('audience', 'Who are your customers?', { maxLength: 500 }),
        choose('hasWebsite', 'Do you have a website now?', YES_NO),
        text('currentWebsite', 'Current website address', { placeholder: 'https://', showIf: { field: 'hasWebsite', equals: 'Yes' } }),
        choose('domain', 'Domain name', ['I already own a domain', 'I need a new domain', 'Not sure']),
        text('domainName', 'Your domain', { placeholder: 'example.com', showIf: { field: 'domain', equals: 'I already own a domain' } }),
      ],
    },
    {
      title: 'What you need',
      fields: [
        {
          type: 'multi-select',
          name: 'goals',
          label: 'What should the website do?',
          required: true,
          minItems: 1,
          options: ['Bring enquiries and leads', 'Show products or services', 'Sell online', 'Take bookings or appointments', 'Publish articles or news', 'Show a portfolio', 'Hire people'],
        },
        {
          type: 'multi-select',
          name: 'pages',
          label: 'Pages you need',
          required: true,
          minItems: 1,
          options: ['Home', 'About us', 'Services', 'Products', 'Portfolio or gallery', 'Testimonials', 'Blog', 'FAQ', 'Careers', 'Contact'],
        },
        {
          type: 'multi-select',
          name: 'features',
          label: 'Features',
          options: ['Enquiry form', 'WhatsApp chat button', 'Google Maps', 'Online payments', 'Admin panel to edit content', 'More than one language', 'Newsletter sign-up', 'Live chat'],
        },
        longText('referenceSites', 'Websites you like', { required: false, maxLength: 1000, helpText: 'Links and what you like about each.' }),
      ],
    },
    {
      title: 'Content and timeline',
      fields: [
        choose('branding', 'Logo and brand colours', ['I have a logo and brand colours', 'I have a logo only', 'I need a logo designed']),
        choose('content', 'Text and photos for the pages', ['Ready', 'Partly ready', 'I need help writing content']),
        { type: 'date', name: 'launchBy', label: 'Launch by', min: 'today', helpText: 'Optional — if there is a deadline.' },
        longText('notes', 'Anything else?', { required: false }),
      ],
    },
    contactStep(),
  ],
};

// ─────────────── Generic fallback ───────────────

/** For services without a form of their own: who the customer is and what they need; an expert follows up for the rest. */
export const GENERIC_SERVICE_FORM: FormSchemaInput = {
  steps: [
    {
      title: 'Your details',
      fields: [text('contactName', 'Full name'), email('contactEmail'), mobile('contactMobile'), state()],
    },
    {
      title: 'Business',
      description: 'Skip what does not apply if you are applying as an individual.',
      fields: [
        entityType({ required: false, options: [{ value: 'INDIVIDUAL', label: 'Individual — no business yet' }, ...ENTITY_TYPES] }),
        businessName('Business or proposed name', { required: false }),
        pan('businessPan', 'PAN of the business', { required: false, helpText: 'For a proprietorship or an individual, your own PAN.' }),
        gstin(),
        { type: 'address', name: 'businessAddress', label: 'Business address' },
      ],
    },
    {
      title: 'Your requirement',
      fields: [
        longText('requirement', 'What do you need help with?', { helpText: 'A few lines are enough. Your expert will call to confirm the details before starting.' }),
        { type: 'date', name: 'neededBy', label: 'Needed by', min: 'today', helpText: 'Optional — if there is a deadline.' },
        choose('preferredContact', 'Best way to reach you', ['Phone call', 'WhatsApp', 'Email']),
      ],
    },
  ],
};

/** Ready-made forms by service slug. Every other service gets `GENERIC_SERVICE_FORM`. */
export const SERVICE_FORMS: Record<string, FormSchemaInput> = {
  'private-limited-company-registration': privateLimited,
  'opc-registration': onePersonCompany,
  'llp-registration': llp,
  'msme-udyam-registration': udyam,
  'gst-registration': gstRegistration,
  'itr-filing': itrFiling,
  'trademark-registration': trademarkRegistration,
  ...Object.fromEntries(Object.entries(ISO_STANDARDS).map(([slug, standard]) => [slug, isoForm(standard)])),
  'other-iso-certifications': isoForm(),
  'fssai-registration': fssaiRegistration,
  'import-export-code': importExportCode,
  'annual-compliance': annualCompliance,
  'website-development': websiteDevelopment,
};

/** The ready-made form for a service, or the generic one. */
export const serviceFormFor = (slug: string): FormSchemaInput => SERVICE_FORMS[slug] ?? GENERIC_SERVICE_FORM;
