/**
 * Seed catalogue (PRD prompt Section 4). Everything here is editable from the Admin panel later.
 *
 * PRICES ARE PLACEHOLDERS for development and demos — replace with real pricing before launch.
 * SAC CODES should be confirmed with your CA before invoices go live.
 * Amounts are in rupees here and converted to paise by the seed script.
 */

export type Recurrence = 'MONTHLY' | 'QUARTERLY' | 'HALF_YEARLY' | 'ANNUAL';

export interface SeedService {
  name: string;
  slug: string;
  short: string;
  price: number; // Basic package professional fee, ₹
  govtFee?: number; // ₹, non-taxable
  time: string;
  days: [number, number];
  popular?: number; // popularity score
  featured?: boolean; // shown in "Popular Services"
  subcategory?: string;
  recurrence?: Recurrence;
  documents?: string[]; // overrides the category default
  icon?: string;
}

export interface SeedCategory {
  slug: string;
  name: string;
  tagline: string;
  description: string;
  icon: string;
  journeyStage: 'START' | 'PROTECT' | 'CERTIFY' | 'COMPLY' | 'CONSULT' | 'GROW';
  sac: string;
  subcategories?: { slug: string; name: string }[];
  documents: string[];
  stages: string[];
  benefits: string[];
  inclusions: { basic: string[]; standard: string[]; premium: string[] };
  faqs: { q: string; a: string }[];
  services: SeedService[];
}

const commonBenefits = ['Dedicated expert assigned to your application', '100% online process', 'Document checklist and review support', 'Track every step from your dashboard'];

export const CATEGORIES: SeedCategory[] = [
  {
    slug: 'company-registration',
    name: 'Company Registration',
    tagline: 'Start your business the right way',
    description: 'Register a Private Limited Company, LLP, OPC or other business structure with expert help from name approval to incorporation certificate.',
    icon: 'building',
    journeyStage: 'START',
    sac: '998216',
    documents: ['PAN card of all directors/partners', 'Aadhaar card of all directors/partners', 'Passport-size photographs', 'Address proof of directors (bank statement or utility bill)', 'Registered office address proof (utility bill not older than 2 months)', 'NOC from the property owner'],
    stages: ['Application submitted', 'Documents under review', 'Name approval', 'DSC & DIN processing', 'Incorporation filing', 'Certificate of incorporation issued'],
    benefits: [...commonBenefits, 'Name availability check before filing'],
    inclusions: {
      basic: ['Name availability search', 'Drafting of incorporation documents', 'Filing with the Registrar', 'Certificate of incorporation'],
      standard: ['Everything in Basic', 'Digital signatures (DSC) for 2 directors', 'PAN & TAN application', 'Bank account opening support'],
      premium: ['Everything in Standard', 'GST registration', 'MSME (Udyam) registration', 'First-year compliance calendar', 'Priority processing'],
    },
    faqs: [
      { q: 'How long does registration take?', a: 'Most registrations complete within the estimated time shown, subject to name approval and government processing times.' },
      { q: 'Do I need to visit any office?', a: 'No. The entire process is online. You upload documents and sign digitally.' },
      { q: 'Are government fees included?', a: 'Government and stamp duty fees are shown separately in the price breakdown and vary by state and authorised capital.' },
      { q: 'Can I change the company name later?', a: 'Yes. A name change is possible after incorporation through a separate filing with the Registrar.' },
    ],
    services: [
      { name: 'Private Limited Company Registration', slug: 'private-limited-company-registration', short: 'Incorporate a Private Limited Company with limited liability, separate legal identity and easy fundraising.', price: 6999, govtFee: 1500, time: '10–15 working days', days: [10, 15], popular: 100, featured: true },
      { name: 'LLP Registration', slug: 'llp-registration', short: 'Form a Limited Liability Partnership that combines partnership flexibility with limited liability.', price: 5999, govtFee: 1500, time: '12–18 working days', days: [12, 18], popular: 80 },
      { name: 'One Person Company (OPC) Registration', slug: 'opc-registration', short: 'Run a company on your own with limited liability and a separate legal identity.', price: 5999, govtFee: 1200, time: '10–15 working days', days: [10, 15], popular: 60 },
      { name: 'Partnership Firm Registration', slug: 'partnership-registration', short: 'Register a partnership firm with a professionally drafted partnership deed.', price: 3999, govtFee: 500, time: '7–14 working days', days: [7, 14], popular: 45, documents: ['PAN card of all partners', 'Aadhaar card of all partners', 'Business address proof', 'Draft partnership terms (profit sharing, capital)'] },
      { name: 'Section 8 Company Registration', slug: 'section-8-company-registration', short: 'Register a non-profit company for charitable, educational, social or similar purposes.', price: 11999, govtFee: 2000, time: '20–30 working days', days: [20, 30], popular: 30 },
      { name: 'Sole Proprietorship Registration', slug: 'proprietorship-registration', short: 'Start trading quickly as a proprietor with GST or MSME registration as your business proof.', price: 1999, time: '3–7 working days', days: [3, 7], popular: 50, documents: ['PAN card of the proprietor', 'Aadhaar card of the proprietor', 'Business address proof', 'Bank account details'] },
      { name: 'Public Limited Company Registration', slug: 'public-limited-company-registration', short: 'Incorporate a Public Limited Company to raise capital from the public and scale.', price: 24999, govtFee: 5000, time: '20–30 working days', days: [20, 30], popular: 20 },
      { name: 'Startup India (DPIIT) Registration', slug: 'startup-india-registration', short: 'Get DPIIT recognition to access tax benefits, easier compliance and government schemes.', price: 4999, time: '15–20 working days', days: [15, 20], popular: 40, documents: ['Certificate of incorporation', 'Company PAN', 'Brief description of the innovation', 'Pitch deck or website link', 'Director details'] },
      { name: 'Business Registration (MSME / Udyam)', slug: 'msme-udyam-registration', short: 'Register your business as an MSME to unlock subsidies, priority lending and payment protection.', price: 999, time: '1–3 working days', days: [1, 3], popular: 55, documents: ['Aadhaar of the owner/authorised signatory', 'PAN of the business', 'Bank account details', 'Business activity details'] },
    ],
  },
  {
    slug: 'trademark',
    name: 'Trademark',
    tagline: 'Protect your brand and creative work',
    description: 'Search, register and defend your trademark, logo and copyright with experienced IP professionals.',
    icon: 'shield',
    journeyStage: 'PROTECT',
    sac: '998213',
    documents: ['PAN card of the applicant', 'Aadhaar or ID proof', 'Address proof', 'Business details (name, nature of business)', 'Logo in JPG/PNG, if applicable', 'Signed power of attorney (we provide the format)', 'MSME/Startup certificate for reduced government fee, if available'],
    stages: ['Application submitted', 'Documents under review', 'Trademark search & class selection', 'Application filed with the Registry', 'Examination by the Registry', 'Final result / certificate'],
    benefits: [...commonBenefits, 'Free trademark search before filing'],
    inclusions: {
      basic: ['Trademark search report', 'Class selection advice', 'Drafting & filing in 1 class', 'Filing receipt (TM application number)'],
      standard: ['Everything in Basic', 'Detailed search with similar marks', 'Status tracking until examination', 'Expert consultation call'],
      premium: ['Everything in Standard', 'Reply to one examination objection', 'Priority filing', 'Brand protection advice'],
    },
    faqs: [
      { q: 'When can I use the ™ symbol?', a: 'You can use ™ as soon as your application is filed. The ® symbol can be used only after registration.' },
      { q: 'How long does trademark registration take?', a: 'Filing is quick; the Registry examination and publication process typically takes several months depending on objections or oppositions.' },
      { q: 'What is a trademark class?', a: 'Goods and services are grouped into 45 classes. You need to file in each class that covers your business.' },
      { q: 'Is the government fee lower for startups?', a: 'Yes. Individuals, startups and MSMEs pay a reduced government fee per class with valid proof.' },
    ],
    services: [
      { name: 'Trademark Registration', slug: 'trademark-registration', short: 'Register your brand name or logo and secure exclusive rights to use it across India.', price: 1499, govtFee: 4500, time: '2–3 days to file', days: [2, 3], popular: 95, featured: true },
      { name: 'Trademark Renewal', slug: 'trademark-renewal', short: 'Renew your registered trademark before it expires to keep your protection active for 10 more years.', price: 1999, govtFee: 9000, time: '3–5 working days', days: [3, 5], popular: 40, documents: ['Trademark registration certificate', 'PAN of the owner', 'ID and address proof', 'Signed power of attorney'] },
      { name: 'Trademark Objection Reply', slug: 'trademark-objection-reply', short: 'Get an expert reply drafted and filed against the examination report raised by the Registry.', price: 3499, time: '5–7 working days', days: [5, 7], popular: 50, documents: ['Examination report', 'Trademark application number', 'Proof of use (invoices, ads), if any', 'Signed power of attorney'] },
      { name: 'Trademark Opposition', slug: 'trademark-opposition', short: 'File or defend a trademark opposition with a well-reasoned notice or counter-statement.', price: 7999, govtFee: 2700, time: '7–10 working days', days: [7, 10], popular: 25, documents: ['Opposition notice or opposed mark details', 'Proof of prior use', 'Signed power of attorney'] },
      { name: 'Trademark Assignment', slug: 'trademark-assignment', short: 'Transfer ownership of a trademark through a properly drafted and recorded assignment deed.', price: 4999, govtFee: 9000, time: '7–10 working days', days: [7, 10], popular: 20, documents: ['Trademark certificate', 'ID and address proof of assignor and assignee', 'Agreed assignment terms', 'Signed power of attorney'] },
      { name: 'Trademark Search', slug: 'trademark-search', short: 'Check whether your brand name or logo is available before you invest in it.', price: 499, time: '1 working day', days: [1, 1], popular: 60, documents: ['Proposed brand name', 'Logo (if any)', 'Description of goods/services'] },
      { name: 'Logo & Brand Protection', slug: 'logo-brand-protection', short: 'Protect your logo through trademark and copyright filings with an ongoing brand watch.', price: 4999, govtFee: 4500, time: '3–5 working days', days: [3, 5], popular: 30 },
      { name: 'Copyright Registration', slug: 'copyright-registration', short: 'Register original creative work such as software, artwork, music, content or literary work.', price: 2999, govtFee: 500, time: '3–5 days to file', days: [3, 5], popular: 35, documents: ['Copy of the work', 'ID and address proof of the author/owner', 'No-objection from the author (if different from applicant)', 'Signed power of attorney'] },
    ],
  },
  {
    slug: 'iso-certification',
    name: 'ISO Certification',
    tagline: 'Certify your quality and build trust',
    description: 'Get ISO certified through accredited certification bodies with end-to-end documentation and audit support.',
    icon: 'badge',
    journeyStage: 'CERTIFY',
    sac: '998346',
    documents: ['Certificate of incorporation / business registration', 'GST certificate or PAN', 'Business address proof', 'Scope of activities to be certified', 'Organisation chart and key processes'],
    stages: ['Application submitted', 'Documents under review', 'Gap analysis', 'Documentation & implementation support', 'Certification audit', 'Certificate issued'],
    benefits: [...commonBenefits, 'Accredited certification bodies', 'Online certificate verification with QR code'],
    inclusions: {
      basic: ['Gap analysis', 'Documentation templates', 'Certification audit coordination', 'Certificate with QR verification'],
      standard: ['Everything in Basic', 'Customised documentation', 'Internal audit support', 'Staff awareness session'],
      premium: ['Everything in Standard', 'On-site implementation support', 'Surveillance audit reminders', 'Dedicated quality consultant'],
    },
    faqs: [
      { q: 'How long is an ISO certificate valid?', a: 'ISO certificates are typically valid for three years, subject to annual surveillance audits.' },
      { q: 'Can anyone verify my certificate?', a: 'Yes. Every certificate issued through BizNexa has a QR code and verification ID that anyone can check on our Verify Certificate page.' },
      { q: 'Which ISO standard do I need?', a: 'It depends on your goal: quality (9001), environment (14001), safety (45001), information security (27001), food safety (22000) or medical devices (13485). Our experts can guide you.' },
    ],
    services: [
      { name: 'ISO 9001 Certification', slug: 'iso-9001-certification', short: 'Quality Management System certification that shows customers you deliver consistent quality.', price: 9999, time: '7–15 working days', days: [7, 15], popular: 90, featured: true },
      { name: 'ISO 14001 Certification', slug: 'iso-14001-certification', short: 'Environmental Management System certification for organisations reducing their environmental impact.', price: 11999, time: '10–20 working days', days: [10, 20], popular: 40 },
      { name: 'ISO 45001 Certification', slug: 'iso-45001-certification', short: 'Occupational Health & Safety certification to protect your people and reduce workplace risk.', price: 11999, time: '10–20 working days', days: [10, 20], popular: 35 },
      { name: 'ISO 27001 Certification', slug: 'iso-27001-certification', short: 'Information Security Management certification to protect data and win enterprise customers.', price: 24999, time: '20–45 working days', days: [20, 45], popular: 45 },
      { name: 'ISO 22000 Certification', slug: 'iso-22000-certification', short: 'Food Safety Management certification for food manufacturers, processors and handlers.', price: 14999, time: '15–30 working days', days: [15, 30], popular: 25 },
      { name: 'ISO 13485 Certification', slug: 'iso-13485-certification', short: 'Quality Management certification for medical device manufacturers and suppliers.', price: 19999, time: '20–45 working days', days: [20, 45], popular: 15 },
      { name: 'Other ISO Certifications', slug: 'other-iso-certifications', short: 'ISO 50001, 20000-1, 22301 and other standards — tell us your requirement and we will guide you.', price: 9999, time: 'Depends on standard', days: [10, 45], popular: 10 },
    ],
  },
  {
    slug: 'tax-gst',
    name: 'Tax & GST',
    tagline: 'GST and income tax, handled by experts',
    description: 'GST registration and returns, income tax filing, TDS and tax planning by qualified tax professionals.',
    icon: 'receipt',
    journeyStage: 'COMPLY',
    sac: '998231',
    subcategories: [
      { slug: 'gst', name: 'GST' },
      { slug: 'income-tax', name: 'Income Tax' },
    ],
    documents: ['PAN card of the business/owner', 'Aadhaar card of the owner/authorised signatory', 'Business address proof', 'Bank statement or cancelled cheque', 'Photograph of the owner/authorised signatory'],
    stages: ['Application submitted', 'Documents under review', 'Expert assigned', 'Preparation', 'Filed with the department', 'Acknowledgement / certificate available'],
    benefits: [...commonBenefits, 'Filed by qualified tax professionals'],
    inclusions: {
      basic: ['Preparation and filing', 'Acknowledgement copy', 'Email support'],
      standard: ['Everything in Basic', 'Expert review before filing', 'Phone support', 'Due-date reminders'],
      premium: ['Everything in Standard', 'Dedicated tax expert', 'Notice support for 12 months', 'Tax-saving advice'],
    },
    faqs: [
      { q: 'Who needs GST registration?', a: 'Businesses above the turnover threshold, inter-state suppliers, e-commerce sellers and certain other categories must register for GST.' },
      { q: 'What happens if I miss a return due date?', a: 'Late fees and interest apply. Our reminders help you file on time, every time.' },
      { q: 'Can you handle tax notices?', a: 'Yes. Our Premium plans include notice support, and you can also book a tax consultation.' },
    ],
    services: [
      { name: 'GST Registration', slug: 'gst-registration', subcategory: 'gst', short: 'Get your GSTIN to collect tax, claim input credit and sell across India and online.', price: 1499, time: '3–7 working days', days: [3, 7], popular: 92, featured: true },
      { name: 'GST Return Filing', slug: 'gst-return-filing', subcategory: 'gst', short: 'Monthly or quarterly GSTR-1 and GSTR-3B filing with reconciliation and reminders.', price: 999, time: 'Before each due date', days: [1, 3], popular: 75, recurrence: 'MONTHLY', documents: ['GST login credentials or OTP access', 'Sales invoices for the period', 'Purchase invoices for the period', 'Bank statement for the period'] },
      { name: 'GST Modification', slug: 'gst-modification', subcategory: 'gst', short: 'Update address, business details, partners/directors or other core fields in your GST registration.', price: 999, time: '3–7 working days', days: [3, 7], popular: 25, documents: ['GST certificate', 'Proof supporting the change', 'Authorised signatory details'] },
      { name: 'GST Cancellation', slug: 'gst-cancellation', subcategory: 'gst', short: 'Cancel your GST registration correctly and file the final return to close it cleanly.', price: 1999, time: '7–15 working days', days: [7, 15], popular: 20, documents: ['GST certificate', 'Reason for cancellation', 'Stock and closing details'] },
      { name: 'GST Annual Return (GSTR-9)', slug: 'gst-annual-return', subcategory: 'gst', short: 'Annual GSTR-9 return preparation and filing with full-year reconciliation.', price: 4999, time: '5–10 working days', days: [5, 10], popular: 35, recurrence: 'ANNUAL', documents: ['GST login access', 'Annual sales and purchase registers', 'Monthly returns filed during the year', 'Books of accounts'] },
      { name: 'GST LUT Filing', slug: 'gst-lut-filing', subcategory: 'gst', short: 'File a Letter of Undertaking to export goods or services without paying IGST.', price: 999, time: '1–3 working days', days: [1, 3], popular: 20, recurrence: 'ANNUAL', documents: ['GST login access', 'Details of two witnesses', 'IEC (if applicable)'] },
      { name: 'GST E-Way Bill', slug: 'gst-e-way-bill', subcategory: 'gst', short: 'E-way bill registration and generation support for moving goods above the threshold value.', price: 799, time: '1–2 working days', days: [1, 2], popular: 15, documents: ['GST login access', 'Invoice details', 'Transporter details'] },
      { name: 'ITR Filing', slug: 'itr-filing', subcategory: 'income-tax', short: 'Accurate income tax return filing for salaried individuals, professionals and businesses.', price: 999, time: '2–5 working days', days: [2, 5], popular: 88, featured: true, recurrence: 'ANNUAL', documents: ['PAN card', 'Aadhaar card', 'Form 16 / salary slips', 'Bank statements and interest certificates', 'Investment proofs for deductions', 'Capital gains statements, if any'] },
      { name: 'Business Tax Filing', slug: 'business-tax-filing', subcategory: 'income-tax', short: 'Income tax return filing for companies, LLPs and firms with financial statements.', price: 4999, time: '5–10 working days', days: [5, 10], popular: 40, recurrence: 'ANNUAL', documents: ['PAN of the entity', 'Financial statements', 'Bank statements', 'TDS certificates', 'Previous year return'] },
      { name: 'Tax Consultation', slug: 'tax-consultation', subcategory: 'income-tax', short: 'Speak to a tax expert about returns, notices, deductions or any tax question.', price: 999, time: 'Within 24 hours', days: [1, 1], popular: 30, documents: ['Relevant documents or notice (optional)'] },
      { name: 'Tax Planning', slug: 'tax-planning', subcategory: 'income-tax', short: 'A personalised plan to reduce your tax legally through deductions, structure and timing.', price: 2999, time: '3–5 working days', days: [3, 5], popular: 25, documents: ['Income details', 'Current investments', 'Previous year return'] },
      { name: 'TDS Return Filing', slug: 'tds-return-filing', subcategory: 'income-tax', short: 'Quarterly TDS return filing (24Q/26Q/27Q) with challan reconciliation and Form 16/16A.', price: 1499, time: 'Before each due date', days: [2, 5], popular: 30, recurrence: 'QUARTERLY', documents: ['TAN', 'TDS challans for the quarter', 'Deductee details (PAN, amount)'] },
    ],
  },
  {
    slug: 'compliance',
    name: 'Compliance',
    tagline: 'Stay compliant, avoid penalties',
    description: 'Annual ROC filings, director changes, share transfers and every MCA compliance your company or LLP needs.',
    icon: 'clipboard',
    journeyStage: 'COMPLY',
    sac: '998216',
    documents: ['Certificate of incorporation', 'Company/LLP PAN', 'Director/partner details and DSC', 'Financial statements (where applicable)', 'Board/partner resolution (we can draft it)'],
    stages: ['Application submitted', 'Documents under review', 'Drafting resolutions & forms', 'Client approval & signing', 'Filed with MCA', 'Approval / acknowledgement available'],
    benefits: [...commonBenefits, 'Compliance calendar with due-date reminders'],
    inclusions: {
      basic: ['Drafting of forms and resolutions', 'Filing with MCA', 'Filing acknowledgement'],
      standard: ['Everything in Basic', 'Dedicated compliance expert', 'Due-date reminders', 'Phone support'],
      premium: ['Everything in Standard', 'Priority filing', 'Statutory register maintenance', 'Annual compliance health check'],
    },
    faqs: [
      { q: 'What is annual compliance for a company?', a: 'Every company must hold board and general meetings, file financial statements and the annual return with the Registrar, and complete director KYC each year.' },
      { q: 'What are the penalties for late filing?', a: 'MCA charges additional fees for each day of delay and directors may face disqualification for continued non-compliance.' },
      { q: 'Do you need my digital signature?', a: 'Yes, most MCA forms need a director DSC. We can also help you obtain one.' },
    ],
    services: [
      { name: 'Annual Compliance (Company)', slug: 'annual-compliance', short: 'Complete yearly ROC compliance for your Private Limited Company — filings, meetings and records.', price: 9999, govtFee: 1200, time: 'Year-round support', days: [15, 30], popular: 85, featured: true, recurrence: 'ANNUAL' },
      { name: 'ROC Annual Filing', slug: 'roc-filing', short: 'AOC-4 and MGT-7/7A filing of financial statements and annual return with the Registrar.', price: 5999, govtFee: 600, time: '7–10 working days', days: [7, 10], popular: 50, recurrence: 'ANNUAL' },
      { name: 'Director KYC (DIR-3 KYC)', slug: 'director-kyc', short: 'Annual KYC for directors to keep the DIN active and avoid penalties.', price: 499, time: '1–2 working days', days: [1, 2], popular: 45, recurrence: 'ANNUAL', documents: ['PAN of the director', 'Aadhaar of the director', 'Personal mobile and email for OTP', 'Director DSC'] },
      { name: 'Director Appointment', slug: 'director-appointment', short: 'Appoint a new director with consent, resolution and DIR-12 filing.', price: 2499, time: '5–7 working days', days: [5, 7], popular: 30, documents: ['PAN and Aadhaar of the new director', 'Photograph and address proof', 'Consent (DIR-2) — we provide the format', 'Company DSC'] },
      { name: 'Director Removal / Resignation', slug: 'director-removal', short: 'Record a director resignation or removal with the right resolutions and filings.', price: 2499, time: '5–7 working days', days: [5, 7], popular: 20, documents: ['Resignation letter or removal resolution', 'Company DSC', 'Director details'] },
      { name: 'Registered Office Change', slug: 'registered-office-change', short: 'Shift your registered office within the city, state or across states with MCA approval.', price: 3999, time: '7–30 working days', days: [7, 30], popular: 25, documents: ['New address proof (utility bill)', 'NOC from the property owner', 'Rent agreement or ownership proof', 'Board resolution'] },
      { name: 'Company Name Change', slug: 'company-name-change', short: 'Change your company name with name approval, shareholder resolution and fresh certificate.', price: 5999, time: '15–25 working days', days: [15, 25], popular: 20 },
      { name: 'Share Transfer', slug: 'share-transfer', short: 'Transfer shares between shareholders with SH-4, stamp duty and register updates.', price: 3999, time: '5–10 working days', days: [5, 10], popular: 20, documents: ['Share certificates', 'Transferor and transferee details', 'Agreed transfer price', 'Board approval'] },
      { name: 'Authorised Capital Increase', slug: 'authorised-capital-increase', short: 'Increase authorised share capital with shareholder approval and SH-7 filing.', price: 3999, time: '5–10 working days', days: [5, 10], popular: 20 },
      { name: 'Company / LLP Closure', slug: 'company-llp-closure', short: 'Close a company or LLP through strike-off with all required filings and declarations.', price: 14999, govtFee: 10000, time: '3–6 months', days: [90, 180], popular: 20 },
      { name: 'Other MCA Services', slug: 'other-mca-services', short: 'Any other MCA filing or corporate change — tell us what you need and an expert will guide you.', price: 1999, time: 'Depends on filing', days: [3, 15], popular: 10 },
    ],
  },
  {
    slug: 'licenses',
    name: 'Licenses',
    tagline: 'The licenses your business needs to operate',
    description: 'FSSAI food licenses, Import Export Code, BIS certification and other business licenses handled end to end.',
    icon: 'stamp',
    journeyStage: 'COMPLY',
    sac: '998216',
    documents: ['PAN of the business/owner', 'Aadhaar of the owner', 'Business address proof', 'Photograph of the owner', 'Business registration certificate'],
    stages: ['Application submitted', 'Documents under review', 'Application prepared', 'Filed with the authority', 'Authority review / inspection', 'License issued'],
    benefits: [...commonBenefits, 'Renewal reminders before expiry'],
    inclusions: {
      basic: ['Eligibility check', 'Application preparation and filing', 'License / certificate copy'],
      standard: ['Everything in Basic', 'Query handling with the authority', 'Renewal reminders'],
      premium: ['Everything in Standard', 'Priority processing', 'Compliance guidance after licensing', 'Dedicated license expert'],
    },
    faqs: [
      { q: 'Which FSSAI license do I need?', a: 'It depends on your turnover and activity: Basic Registration, State License or Central License. Our experts will confirm the right one for you.' },
      { q: 'Is an Import Export Code renewed every year?', a: 'An IEC needs to be updated annually on the DGFT portal even though it does not expire.' },
    ],
    services: [
      { name: 'FSSAI Registration', slug: 'fssai-registration', short: 'Get your FSSAI food registration or license to legally make, store, sell or deliver food.', price: 1499, govtFee: 100, time: '7–15 working days', days: [7, 15], popular: 85, featured: true },
      { name: 'FSSAI Renewal', slug: 'fssai-renewal', short: 'Renew your FSSAI registration or license before expiry to avoid penalties.', price: 1299, govtFee: 100, time: '7–15 working days', days: [7, 15], popular: 35, documents: ['Existing FSSAI certificate', 'Owner ID proof', 'Updated business details'] },
      { name: 'FSSAI Modification', slug: 'fssai-modification', short: 'Update name, address, products or other details on your FSSAI license.', price: 1299, time: '7–15 working days', days: [7, 15], popular: 20, documents: ['Existing FSSAI certificate', 'Proof supporting the change'] },
      { name: 'Import Export Code (IEC)', slug: 'import-export-code', short: 'Get your IEC from DGFT to import or export goods and services.', price: 1499, govtFee: 500, time: '2–5 working days', days: [2, 5], popular: 45, documents: ['PAN of the business', 'Aadhaar of the owner', 'Business address proof', 'Cancelled cheque or bank certificate'] },
      { name: 'BIS Certification', slug: 'bis-certification', short: 'BIS product certification (ISI mark / CRS registration) for products under mandatory standards.', price: 29999, time: '30–90 working days', days: [30, 90], popular: 20, documents: ['Business registration certificate', 'Factory address proof', 'Product details and test reports', 'Manufacturing process flow', 'Authorised signatory details'] },
      { name: 'Other Business Licenses', slug: 'other-business-licenses', short: 'Shop & Establishment, Trade License, Drug License and more — tell us your requirement.', price: 1999, time: 'Depends on license', days: [7, 30], popular: 15 },
    ],
  },
  {
    slug: 'business-technology',
    name: 'Business Technology',
    tagline: 'Grow with the right technology',
    description: 'Websites, apps, CRM/ERP, automation and digital marketing built by vetted technology partners.',
    icon: 'laptop',
    journeyStage: 'GROW',
    sac: '998314',
    documents: ['Business details and logo', 'Requirement brief (features, pages, references)', 'Content and images (if available)', 'Domain and hosting access (if existing)'],
    stages: ['Requirement submitted', 'Requirement review', 'Proposal & plan approved', 'Design', 'Development', 'Testing & review', 'Delivered'],
    benefits: ['Dedicated project manager', 'Fixed scope and timeline', 'Progress tracking from your dashboard', 'Post-launch support'],
    inclusions: {
      basic: ['Requirement workshop', 'Standard design', 'Development and launch', '1 month support'],
      standard: ['Everything in Basic', 'Custom design', 'Basic SEO setup', '3 months support'],
      premium: ['Everything in Standard', 'Advanced features and integrations', 'Analytics dashboard', '6 months support', 'Priority delivery'],
    },
    faqs: [
      { q: 'Who owns the code and design?', a: 'You do. Full ownership and source files are handed over on final payment.' },
      { q: 'Can I pay in parts?', a: 'Yes. Technology projects support milestone-based partial payments.' },
      { q: 'Do you provide hosting and maintenance?', a: 'Yes. Hosting setup is included and ongoing maintenance plans are available.' },
    ],
    services: [
      { name: 'Website Development', slug: 'website-development', short: 'A fast, mobile-friendly business website designed to win customers and rank on Google.', price: 14999, time: '2–4 weeks', days: [14, 28], popular: 80, featured: true },
      { name: 'E-commerce Website', slug: 'ecommerce-website', short: 'An online store with catalogue, cart, payments and order management.', price: 34999, time: '4–8 weeks', days: [28, 56], popular: 50 },
      { name: 'Mobile App Development', slug: 'mobile-app-development', short: 'Android and iOS apps for your customers or team, designed and built end to end.', price: 99999, time: '8–16 weeks', days: [56, 112], popular: 40 },
      { name: 'Custom Software Development', slug: 'software-development', short: 'Tailor-made software for your processes — portals, dashboards, integrations and more.', price: 74999, time: 'Depends on scope', days: [30, 120], popular: 30 },
      { name: 'CRM Setup & Development', slug: 'crm', short: 'Manage leads, customers and sales pipeline with a CRM set up for your business.', price: 24999, time: '2–6 weeks', days: [14, 42], popular: 25 },
      { name: 'ERP Implementation', slug: 'erp', short: 'Connect inventory, accounts, HR and operations in one ERP system.', price: 99999, time: '6–16 weeks', days: [42, 112], popular: 20 },
      { name: 'Digital Marketing', slug: 'digital-marketing', short: 'Social media, ads and content marketing plans that bring measurable leads.', price: 14999, time: 'Monthly plan', days: [30, 30], popular: 35, recurrence: 'MONTHLY' },
      { name: 'SEO Services', slug: 'seo', short: 'Improve your Google rankings with technical SEO, content and local SEO.', price: 9999, time: 'Monthly plan', days: [30, 30], popular: 30, recurrence: 'MONTHLY' },
      { name: 'Business Automation', slug: 'business-automation', short: 'Automate repetitive work — invoicing, follow-ups, reports and approvals.', price: 19999, time: '2–6 weeks', days: [14, 42], popular: 20 },
      { name: 'IT Consulting', slug: 'it-consulting', short: 'Expert advice on technology choices, security, cloud and digital transformation.', price: 4999, time: 'Within 3 working days', days: [1, 3], popular: 15 },
    ],
  },
];

export const CERTIFICATION_BODIES = [
  { name: 'Demo Quality Certification Pvt. Ltd.', accreditation: 'Accreditation details to be added by Admin', website: 'https://example.com' },
  { name: 'Demo Assurance Services LLP', accreditation: 'Accreditation details to be added by Admin', website: 'https://example.com' },
];

export const TESTIMONIALS = [
  { name: 'Demo customer', company: 'Sample Foods (demo)', quote: 'Placeholder testimonial — replace from the CMS with a real customer review.', rating: 5 },
  { name: 'Demo customer', company: 'Sample Tech (demo)', quote: 'Placeholder testimonial — replace from the CMS with a real customer review.', rating: 5 },
  { name: 'Demo customer', company: 'Sample Exports (demo)', quote: 'Placeholder testimonial — replace from the CMS with a real customer review.', rating: 5 },
];
