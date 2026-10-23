/**
 * Website content for the demo seed (`seed-demo.ts`): CMS pages, homepage blocks, testimonials and blog posts,
 * written as sanitiser-safe HTML (h2, h3, p, ul, li, strong, a). Sample text for testing — the legal pages
 * carry a notice and must be replaced with reviewed text, and the testimonials with real ones, before launch.
 */

const SAMPLE_LEGAL = '<p><strong>Sample text for testing.</strong> This page must be reviewed by a lawyer before launch.</p>';

export const CMS_PAGES: { slug: 'about' | 'terms' | 'privacy' | 'refund-policy' | 'contact'; title: string; seoTitle: string; metaDescription: string; html: string; contactEmail?: string; contactPhone?: string }[] = [
  {
    slug: 'about',
    title: 'About BizNexa',
    seoTitle: 'About BizNexa | Business Services for Indian Founders',
    metaDescription: 'BizNexa brings company registration, trademarks, GST, licences, ISO certification and expert consultations into one online platform for Indian businesses.',
    html: [
      '<p><strong>BizNexa is an online business services platform for India’s founders, startups and MSMEs.</strong> From the day you register your company to the day you renew your ISO certificate, we bring every registration, licence, filing and certification into one place, with expert help at every step.</p>',
      '<h2>Why we started BizNexa</h2>',
      '<p>Running a business in India means dealing with many departments: the MCA for your company, the Trademark Registry for your brand, GSTN for tax, FSSAI for food and certification bodies for ISO. Most business owners end up juggling several consultants, chasing updates on the phone and keeping documents in email threads.</p>',
      '<p>BizNexa replaces that with one clear online process. Choose a service, submit your details, upload documents, pay upfront prices and track progress from your dashboard until your final certificate is ready to download.</p>',
      '<h2>How we help your business</h2>',
      '<ul>',
      '<li><strong>Start:</strong> company, LLP, OPC, partnership and startup registration</li>',
      '<li><strong>Protect:</strong> trademark, copyright and brand protection</li>',
      '<li><strong>Certify:</strong> ISO, BIS and FSSAI certifications and licences</li>',
      '<li><strong>Comply:</strong> GST, income tax, TDS and annual ROC compliance</li>',
      '<li><strong>Consult:</strong> chartered accountants, company secretaries, lawyers and industry experts</li>',
      '<li><strong>Grow:</strong> websites, apps, CRM, ERP and digital marketing</li>',
      '</ul>',
      '<h2>Our promise</h2>',
      '<ul>',
      '<li>Transparent pricing with no hidden charges</li>',
      '<li>Qualified professionals handle every application</li>',
      '<li>Your documents are stored securely and only shared with the people working on your application</li>',
      '<li>Status updates at every stage, from submission to final document</li>',
      '</ul>',
      '<h2>Talk to us</h2>',
      '<p>Not sure which service you need? <a href="/contact">Contact our team</a> or <a href="/consultants">book a consultation</a> with an expert.</p>',
    ].join(''),
  },
  {
    slug: 'terms',
    title: 'Terms & Conditions',
    seoTitle: 'Terms & Conditions | BizNexa',
    metaDescription: 'The terms that apply when you use the BizNexa website, buy a service or book a consultation.',
    html: [
      SAMPLE_LEGAL,
      '<h2>1. About these terms</h2><p>These terms govern your use of the BizNexa website, mobile app and services. By creating an account or purchasing a service you agree to them.</p>',
      '<h2>2. Your account</h2><p>You must give accurate details and keep your password and one-time codes private. You are responsible for activity on your account.</p>',
      '<h2>3. Services and timelines</h2><p>Each service page lists what is included, the documents needed and an estimated timeline. Timelines depend on government departments and on you providing complete documents on time.</p>',
      '<h2>4. Prices and payment</h2><p>Professional fees, government fees and GST are shown before you pay. Government fees are paid to the authority on your behalf and are not subject to GST.</p>',
      '<h2>5. Documents and information</h2><p>You confirm that the documents and information you upload are genuine. We may reject documents that are unclear, incomplete or appear altered.</p>',
      '<h2>6. Consultations</h2><p>Consultations are provided by independent, verified professionals. You can reschedule or cancel up to 24 hours before the session.</p>',
      '<h2>7. Limitation of liability</h2><p>We are not responsible for delays or decisions by government departments. Our liability is limited to the professional fee paid for the service concerned.</p>',
      '<h2>8. Contact</h2><p>Questions about these terms: <a href="/contact">contact us</a>.</p>',
    ].join(''),
  },
  {
    slug: 'privacy',
    title: 'Privacy Policy',
    seoTitle: 'Privacy Policy | BizNexa',
    metaDescription: 'How BizNexa collects, uses, stores and protects your personal data under the Digital Personal Data Protection Act, 2023.',
    html: [
      SAMPLE_LEGAL,
      '<h2>What we collect</h2><p>Your name, mobile number, email, address, business details and the documents you upload for a service. We also keep payment references (not card numbers) and a record of your applications.</p>',
      '<h2>How we use it</h2><p>To deliver the services you request, communicate with you about your applications, meet legal obligations and improve our website. We send marketing messages only if you have not opted out.</p>',
      '<h2>Who can see it</h2><p>Only the BizNexa team members and consultants working on your application. Documents are stored privately and opened through short-lived secure links.</p>',
      '<h2>How long we keep it</h2><p>As long as your account is active and as required by tax and company law. Sensitive numbers such as PAN are stored encrypted.</p>',
      '<h2>Your rights</h2><p>You can download a copy of your data or ask us to delete your account from <strong>Dashboard → Profile → Privacy</strong>, under the Digital Personal Data Protection Act, 2023.</p>',
      '<h2>Contact</h2><p>For privacy questions write to <a href="mailto:privacy@biznexa.com">privacy@biznexa.com</a>.</p>',
    ].join(''),
  },
  {
    slug: 'refund-policy',
    title: 'Refund Policy',
    seoTitle: 'Refund Policy | BizNexa',
    metaDescription: 'When and how BizNexa refunds professional fees, government fees and consultation fees.',
    html: [
      SAMPLE_LEGAL,
      '<h2>Before work starts</h2><p>If you cancel before our team starts work on your application, the professional fee is refunded in full.</p>',
      '<h2>After work starts</h2><p>Once documents are reviewed or filing has begun, a partial refund may be given for work not yet done, decided case by case.</p>',
      '<h2>Government fees</h2><p>Government fees already paid to an authority cannot be refunded by BizNexa.</p>',
      '<h2>Consultations</h2><p>Cancel at least 24 hours before your session for a full refund. Missed sessions are not refunded.</p>',
      '<h2>How refunds are paid</h2><p>Refunds go back to the original payment method within 5–7 working days, and a GST credit note is issued in your account.</p>',
    ].join(''),
  },
  {
    slug: 'contact',
    title: 'Contact Us',
    seoTitle: 'Contact BizNexa | Talk to a Business Expert',
    metaDescription: 'Questions about a service, pricing or an application in progress? Contact the BizNexa team.',
    html: '<p>Have a question about a service, pricing or an application in progress? Send us a message and our team will get back to you within one working day.</p><p>Already a customer? Raise a ticket from <strong>Dashboard → Support</strong> for the fastest answer about your application.</p>',
    contactEmail: 'support@biznexa.com',
    contactPhone: '+91 98765 43210',
  },
];

export const TESTIMONIALS = [
  { name: 'Rajesh Kumar', company: 'Kumar Textiles Pvt Ltd, Ludhiana', quote: 'Our company was incorporated in 12 days. I could see every step in the dashboard instead of calling someone for updates.', rating: 5 },
  { name: 'Anita Desai', company: 'Desai Foods LLP, Pune', quote: 'The FSSAI licence and GST registration were handled together. The team told me exactly which document was wrong and why.', rating: 5 },
  { name: 'Pooja Iyer', company: 'Iyer Tech Solutions, Bengaluru', quote: 'ISO 9001 felt complicated until our consultant broke it into simple steps. The certificate verification page impresses our clients.', rating: 5 },
  { name: 'Mohit Bansal', company: 'Bansal Traders, Amritsar', quote: 'Monthly GST returns are now on time, and I get a reminder before every due date.', rating: 4 },
  { name: 'Ritu Malhotra', company: 'Malhotra Design Studio, Gurugram', quote: 'Booked a 30-minute call with a lawyer the same day. Clear advice on our partnership deed at a fair price.', rating: 5 },
  { name: 'Amit Patel', company: 'Patel Exports Pvt Ltd, Ahmedabad', quote: 'IEC and trademark done online without a single office visit. Invoices with GST were in my account right after payment.', rating: 4 },
];

export const HOME_FAQ = [
  { question: 'How do I start a service on BizNexa?', answer: '<p>Choose a service, pick a package, fill one short form and upload your documents. Pay online and track every step from your dashboard.</p>' },
  { question: 'Are government fees included in the price?', answer: '<p>Government fees are shown separately on every service page, collected with your order and paid to the authority on your behalf. They are not subject to GST.</p>' },
  { question: 'Can I upload documents later?', answer: '<p>Yes. You can skip the upload step and add documents from <strong>Dashboard → Pending actions</strong>. Work starts once the required documents are approved.</p>' },
  { question: 'How do I know my certificate is genuine?', answer: '<p>Every certificate carries a verification ID and QR code. Anyone can check it on our <a href="/verify">Verify Certificate</a> page without logging in.</p>' },
  { question: 'Can I talk to an expert before buying?', answer: '<p>Yes. Use “Talk to an expert” on any service page for a free callback, or <a href="/consultants">book a paid consultation</a> with a CA, CS or lawyer.</p>' },
];

/** Slugs of the services shown as "Popular" on the homepage, in order. */
export const HOME_POPULAR = ['private-limited-company-registration', 'gst-registration', 'trademark-registration', 'itr-filing', 'fssai-registration', 'iso-9001-certification', 'msme-udyam-registration', 'website-development'];

const post = (intro: string, sections: [string, string[]][], cta: string) =>
  `<p>${intro}</p>${sections.map(([h, items]) => `<h2>${h}</h2>${items.length > 1 ? `<ul>${items.map((i) => `<li>${i}</li>`).join('')}</ul>` : `<p>${items[0]}</p>`}`).join('')}<p>${cta}</p>`;

export const BLOG_POSTS = [
  {
    slug: 'gst-registration-checklist', cat: 'gst', day: 30, status: 'PUBLISHED' as const, tags: ['GST', 'Startups'],
    title: 'GST Registration: The Complete Document Checklist',
    excerpt: 'Everything you need ready before you apply for GST registration, for proprietors, partnerships and companies.',
    content: post('GST registration is mandatory once your turnover crosses the threshold, or from day one if you sell online or across states. Most delays come from missing or unclear documents, so keep these ready before you apply.', [
      ['For proprietors', ['PAN and Aadhaar of the owner', 'Passport-size photograph', 'Proof of business address (electricity bill or rent agreement)', 'Bank statement or cancelled cheque']],
      ['For partnerships and LLPs', ['Partnership deed or LLP agreement', 'PAN of the firm', 'PAN, Aadhaar and photo of each partner', 'Authorisation letter for the signatory']],
      ['For companies', ['Certificate of incorporation, MOA and AOA', 'PAN of the company', 'Board resolution for the authorised signatory', 'Director PAN, Aadhaar and photos']],
      ['Common mistakes', ['Address proof in a different name without a NOC from the owner', 'Blurred scans or photos with cut-off edges', 'Mobile number not linked to the signatory’s Aadhaar']],
    ], 'With BizNexa you upload these once, our team checks them before filing and you track the ARN and GSTIN in your dashboard. <a href="/services/tax-gst/gst-registration">Start GST registration</a>.'),
  },
  {
    slug: 'private-limited-vs-llp', cat: 'business-articles', day: 21, status: 'PUBLISHED' as const, tags: ['Company Registration', 'Startups'],
    title: 'Private Limited or LLP: Which Is Right for Your Startup?',
    excerpt: 'A side-by-side look at cost, compliance, taxation and funding for the two most popular business structures.',
    content: post('Both a Private Limited Company and an LLP give you limited liability and a separate legal identity. The right choice depends on how you plan to grow.', [
      ['Choose a Private Limited Company if', ['You plan to raise funding from investors or VCs', 'You want to give ESOPs to employees', 'You want to look established to large customers']],
      ['Choose an LLP if', ['You are professionals or a small team sharing profits', 'You want lower annual compliance costs', 'You do not plan to raise equity funding soon']],
      ['Compliance at a glance', ['Private Limited: board meetings, statutory audit, AOC-4 and MGT-7 every year', 'LLP: Form 8 and Form 11 every year; audit only above the turnover limit']],
      ['Tax', ['Companies can opt for the 22% concessional rate; LLPs pay 30% but profit shares are tax-free in partners’ hands. Speak to a CA about your numbers.']],
    ], 'Still unsure? <a href="/consultants">Book a 30-minute call</a> with a company secretary before you decide.'),
  },
  {
    slug: 'trademark-objection-reply', cat: 'trademark', day: 14, status: 'PUBLISHED' as const, tags: ['Trademark'],
    title: 'Got a Trademark Objection? Here Is What to Do Next',
    excerpt: 'How to read the examination report, the common grounds for objection and how to reply on time.',
    content: post('An objection does not mean your trademark is refused. It means the examiner needs more information or sees a possible conflict. You usually have 30 days from the examination report to reply.', [
      ['Common grounds', ['Section 9: the mark is descriptive or lacks distinctiveness', 'Section 11: a similar mark already exists for similar goods or services', 'Wrong class or unclear description of goods']],
      ['What a good reply includes', ['Legal arguments with relevant case law', 'Evidence of use: invoices, website, ads with dates', 'An affidavit of use where needed']],
      ['After the reply', ['The examiner may accept the mark, or call a hearing. Missing the deadline can lead to the application being treated as abandoned.']],
    ], 'Our trademark attorneys draft and file the reply for you. <a href="/services/trademark/trademark-objection-reply">See Trademark Objection Reply</a>.'),
  },
  {
    slug: 'itr-due-dates', cat: 'tax-updates', day: 7, status: 'PUBLISHED' as const, tags: ['Income Tax'],
    title: 'Income Tax Return Due Dates You Should Not Miss',
    excerpt: 'Key ITR deadlines for salaried individuals, businesses that need an audit and companies.',
    content: post('Filing your income tax return on time avoids late fees, interest and the loss of some deductions and carry-forward benefits.', [
      ['Usual due dates', ['31 July: individuals and businesses that do not need an audit', '31 October: businesses that need a tax audit, and companies', '30 November: businesses with transfer pricing reports', '31 December: belated or revised return']],
      ['If you miss the date', ['A late fee of up to ₹5,000 applies, plus interest on unpaid tax. Losses (other than house property) cannot be carried forward.']],
      ['Documents to collect', ['Form 16 and salary slips', 'Bank interest certificates', 'Capital gains statements', 'Investment proofs for deductions']],
    ], 'Dates can be extended by the government each year; check the latest notification. <a href="/services/tax-gst/itr-filing">File your ITR with an expert</a>.'),
  },
  {
    slug: 'iso-9001-benefits', cat: 'certification', day: 3, status: 'PUBLISHED' as const, tags: ['ISO'],
    title: '5 Ways ISO 9001 Helps Small Manufacturers Win Orders',
    excerpt: 'Why large buyers ask for ISO 9001, what the audit looks at and how long certification takes.',
    content: post('ISO 9001 is the international standard for quality management. For small manufacturers it is often the difference between being shortlisted and being ignored.', [
      ['The benefits', ['Eligibility for tenders and large-buyer vendor lists', 'Fewer defects through documented processes', 'Clear roles and training records', 'Better customer trust through a verifiable certificate', 'A base for other standards like ISO 14001 and 45001']],
      ['How long it takes', ['Most small units are certified in 3–6 weeks: gap analysis, documentation, internal audit, then the certification body’s audit.']],
    ], 'Every certificate issued through BizNexa can be checked on our <a href="/verify">Verify Certificate</a> page.'),
  },
  {
    slug: 'roc-annual-filing-guide', cat: 'compliance-updates', day: 1, status: 'DRAFT' as const, tags: ['Compliance'],
    title: 'ROC Annual Filing Guide',
    excerpt: 'AOC-4 and MGT-7 explained: what to file, when, and the penalty for delays.',
    content: post('Every company must file its financial statements and annual return with the Registrar of Companies each year.', [
      ['Forms', ['AOC-4: financial statements, within 30 days of the AGM', 'MGT-7 / MGT-7A: annual return, within 60 days of the AGM']],
    ], 'Draft — to be completed.'),
  },
];
