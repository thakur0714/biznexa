# BizNexa — Master Development Prompt

> Paste this entire document into your AI coding agent or hand it to your dev team. It is self-contained: it tells the builder what to make, in what order, with what stack, and how to know each part is done.

---

## 0. ROLE & MISSION

You are a senior full-stack engineering team (architect, backend, frontend, mobile, QA, DevOps) building **BizNexa** — *"Everything Your Business Needs, In One Place."*

BizNexa is an Indian online business-services platform where individuals, startups, MSMEs and companies **discover, buy, and track** professional services (company registration, trademark, GST/tax, ISO, licenses, compliance, business technology) and **book consultations** with verified professionals (CA, CS, lawyers, etc.).

Core customer journey (every service follows this):

```
Select Service → Choose Package → Register/Login → Fill Form → Upload Documents
→ Pay → Track Progress → Receive Final Documents/Certificate
```

**Your job:** build the MVP (Section 12) to production quality, with an architecture that supports Phase 2 and Phase 3 without rewrites. Work module by module in the build order in Section 13. After each module: run tests, confirm the acceptance criteria, then move on.

**Rules for you, the builder:**
1. Never hard-code services, prices, stages, document lists, or form fields — everything service-related is **admin-configurable data**.
2. When this prompt is silent, choose the simplest secure option, write it down in `docs/DECISIONS.md`, and continue.
3. Do not copy text, images, logos or code from the reference websites. Use them only for **layout and UX patterns** as described in Section 9.
4. Ask before changing the stack or anything listed in Section 2.

---

## 1. PLATFORMS

| # | Platform | Users | MVP? |
|---|----------|-------|------|
| 1 | Public Website (SEO-first) | Visitors, customers | ✅ |
| 2 | Customer Dashboard (web) | Customers | ✅ |
| 3 | Admin / Operations Portal (web) | Admin, Ops Exec, Support Exec | ✅ |
| 4 | Consultant Portal (web, responsive) | Consultants | ✅ basic |
| 5 | Customer Mobile App (Android + iOS) | Customers | ✅ |
| 6 | Consultant / Partner Mobile App | Consultants, partners/agents | Phase 2 |

All clients consume **one shared backend API**.

---

## 2. TECH STACK (default — change only with approval)

| Layer | Choice |
|------|--------|
| Monorepo | Turborepo + pnpm |
| Website + Customer Dashboard | Next.js 14+ (App Router), TypeScript, Tailwind CSS, shadcn/ui, SSR/ISR for SEO |
| Admin + Consultant Portal | Next.js (separate app in monorepo), TanStack Table, React Hook Form + Zod |
| Backend API | NestJS (TypeScript), REST + OpenAPI/Swagger, modular architecture |
| Database | PostgreSQL 15+ with Prisma ORM |
| Cache / Queues | Redis + BullMQ (notifications, reminders, PDF generation, webhooks) |
| Search | PostgreSQL full-text (MVP); Meilisearch/OpenSearch optional later |
| File storage | Multer (NestJS `FileInterceptor`) uploads to the API, stored on a private server disk / mounted volume behind a `StorageService` interface; downloads via short-lived signed API links (see DECISIONS D17) |
| Payments | Razorpay (UPI, cards, net banking, refunds, webhooks) |
| SMS / OTP | MSG91 (DLT-registered templates) |
| Email | AWS SES or SendGrid |
| Push | Firebase Cloud Messaging |
| WhatsApp | Provider-agnostic interface; implement in Phase 2 (Gupshup/Interakt/Meta Cloud API) |
| PDF | Server-side HTML→PDF (Puppeteer/Playwright) for invoices and certificates |
| QR | `qrcode` library, signed verification URL |
| Mobile | React Native (Expo) + TypeScript, sharing types/API client with web |
| Auth | JWT access token (15 min) + rotating refresh token (httpOnly cookie on web, secure storage on mobile); Google OAuth; OTP login |
| Infra | Docker; AWS (ECS/EC2 or similar) in **ap-south-1 (Mumbai)**; CloudFront CDN; GitHub Actions CI/CD |
| Monitoring | Sentry, structured logs, uptime checks |

Repository layout:

```
/apps
  /web          → public website + customer dashboard (Next.js)
  /admin        → admin, ops, support, consultant portals (Next.js, role-based)
  /api          → NestJS backend
  /mobile       → React Native (Expo) customer app
/packages
  /ui           → shared design-system components
  /types        → shared TypeScript types + Zod schemas
  /api-client   → generated typed client from OpenAPI
  /config       → eslint, tsconfig, tailwind presets
/docs           → DECISIONS.md, API.md, RUNBOOK.md, ER diagram
```

---

## 3. USER ROLES & PERMISSIONS (RBAC)

Implement permission-based RBAC (roles are bundles of permissions so new roles can be added later without code changes).

| Role | Can do |
|------|--------|
| **Customer** | Browse, buy, fill forms, upload docs, pay, track, download invoices/certificates, book consultations, raise tickets, chat on own applications |
| **Admin (Super Admin)** | Everything, including settings, roles, CMS, pricing, refunds, reports |
| **Operations Executive** | View/process **assigned** applications, review documents, update status, upload final documents, internal notes, message customers |
| **Consultant** | View assigned applications and bookings, manage own profile/availability/fees (subject to admin approval), message customers, upload deliverables, view own earnings and reviews |
| **Support Executive** | View customers (read-only), handle tickets, reply in chat, view orders/payments (no refunds) |

Rules:
- Every staff action on an application, document, payment, or certificate is written to an **audit log** (who, what, when, before/after).
- Ops/Consultants see only records assigned to them unless granted `applications.view_all`.
- Customer data access is always scoped to the owning user (enforce in the API, not just the UI).

---

## 4. SERVICE CATALOGUE (seed data — must be editable in Admin)

Category → Services. Seed all of these as data.

1. **Trademark:** Trademark Registration, Renewal, Objection Reply, Opposition, Assignment, Trademark Search, Logo/Brand Protection, Copyright Registration
2. **Company Registration:** Private Limited, LLP, OPC, Partnership, Section 8, Proprietorship, Public Limited, Startup (DPIIT) Registration, Business Registration
3. **ISO & Certification:** ISO 9001, 14001, 45001, 27001, 22000, 13485, Other ISO
4. **Tax & GST:**
   - GST: Registration, Return Filing, Modification, Cancellation, Annual Return, LUT, E-Way Bill
   - Income Tax: ITR Filing, Business Tax Filing, Tax Consultation, Tax Planning, TDS Services
5. **Business Compliance:** Annual Compliance, ROC Filing, Director KYC, Director Appointment, Director Removal, Registered Office Change, Company Name Change, Share Transfer, Authorised Capital Increase, Company/LLP Closure, Other MCA Services
6. **Business Licenses:** FSSAI Registration, Renewal, Modification, Import Export Code, BIS Certification, Other Licenses
7. **Business Technology:** Website Development, E-commerce Website, Mobile App Development, Software Development, CRM, ERP, Digital Marketing, SEO, Business Automation, IT Consulting

Each **Service** record holds (all admin-editable):
- Name, slug, category, subcategory, short + long description, icon/image, SEO title, meta description
- **Packages** (e.g., Basic / Standard / Premium): price, government fee (shown separately), GST %, inclusions list, estimated timeline, "most popular" flag
- **Required documents** (name, description, mandatory/optional, accepted file types, max size, per-package override)
- **Application form schema** (dynamic JSON form: field types text, number, date, select, multi-select, file, address, repeater e.g. "directors")
- **Process stages** (ordered list — becomes the customer's tracking timeline)
- Benefits, FAQs, related services, estimated time, popularity score, active/inactive
- **Recurring config** (optional): recurrence (monthly/quarterly/annual), reminder offsets (e.g., 30/15/7/1 days)
- **SAC code** for GST invoicing

---

## 5. DATA MODEL (minimum entities)

Design with Prisma; include `createdAt`, `updatedAt`, `deletedAt` (soft delete) and `createdBy` where useful. Use UUID primary keys plus human-readable codes where shown.

- **User** (id, name, email, mobile, passwordHash, googleId, status, emailVerified, mobileVerified, lastLoginAt)
- **Role**, **Permission**, **UserRole**
- **CustomerProfile** (userId, PAN, address, state — needed for GST place of supply)
- **BusinessEntity** (customer's companies: legal name, type, GSTIN, CIN/LLPIN, PAN, address) — one customer can own many
- **Category**, **Subcategory**, **Service**, **ServicePackage**, **ServiceDocumentRequirement**, **ServiceStage**, **ServiceFAQ**, **ServiceFormSchema** (versioned)
- **Order** (code e.g. `ORD-2026-000123`, customerId, items, subtotal, discount, taxes, total, amountPaid, balance, couponId, status)
- **Application** (code `BN10025`, orderId, serviceId, packageId, businessEntityId, formData JSON, formSchemaVersion, currentStageId, status, assignedToUserId, priority, slaDueAt)
- **ApplicationStageHistory** (applicationId, stageId, status, note, changedBy, changedAt, visibleToCustomer)
- **ApplicationDocument** (applicationId, requirementId, fileKey, version, status, rejectionReason, reviewedBy, reviewedAt)
- **FinalDeliverable** (applicationId, type, fileKey, uploadedBy)
- **InternalNote** (applicationId, authorId, body — never visible to customer)
- **Payment** (orderId, gateway, gatewayOrderId, gatewayPaymentId, amount, method, status, rawWebhook JSON)
- **Refund** (paymentId, amount, reason, status, initiatedBy)
- **Invoice** (number, orderId, paymentId, seller GSTIN, buyer GSTIN optional, placeOfSupply, CGST/SGST/IGST lines, totals, pdfKey)
- **Coupon** (code, type %/fixed, value, maxDiscount, minOrderValue, serviceIds, startsAt, expiresAt, usageLimit, perUserLimit, active), **CouponRedemption**
- **Consultant** (userId, category, qualification, experienceYears, expertise[], languages[], city, state, bio, photo, fee per session/duration, verificationStatus, rating, reviewCount, isOnline)
- **ConsultantService**, **AvailabilitySlot** (recurring weekly + exceptions), **Booking** (customerId, consultantId, type audio/video/chat/meeting, startAt, endAt, status, meetingLink, paymentId), **Review** (bookingId, rating 1–5, text, moderated)
- **CertificationBody** (name, accreditation, logo)
- **Certificate** (certificateNumber, verificationId, type, organizationName, scope, issueDate, validFrom, validUntil, certificationBodyId, status Active/Suspended/Withdrawn/Expired, pdfKey, qrKey, applicationId, businessEntityId)
- **Reminder** (businessEntityId, type, dueDate, sourceApplicationId, offsets, status)
- **Notification** (userId, channel, templateKey, payload, status, readAt), **NotificationTemplate** (per event × channel, editable)
- **Ticket** (code, customerId, applicationId optional, subject, description, priority, status, assignedTo), **TicketMessage**
- **Conversation** (applicationId or bookingId or ticketId), **Message** (senderId, body, attachments)
- **CmsPage**, **Banner**, **Testimonial**, **BlogPost**, **BlogCategory**, **Tag**, **Setting** (key/value: company GSTIN, address, contact info, invoice prefix)
- **AuditLog**

Deliver an ER diagram in `/docs`.

---

## 6. STATUS MODELS (implement as explicit state machines)

**Application status** (system-level; the customer timeline uses the service's configured stages on top of this):

```
DRAFT → PAYMENT_PENDING → SUBMITTED → DOCUMENTS_UNDER_REVIEW
  ↔ DOCUMENTS_PENDING (action needed by customer)
→ DOCUMENTS_APPROVED → ASSIGNED → IN_PROGRESS
  ↔ ON_HOLD (e.g., awaiting government / client response)
→ COMPLETED → DELIVERED (final docs available)
Any state → CANCELLED (admin only, with reason; triggers refund flow if applicable)
```

**Document status:** `REQUIRED → UPLOADED → UNDER_REVIEW → APPROVED | REJECTED (reason mandatory) → (re-upload creates new version) UPLOADED`

**Payment status:** `CREATED → PENDING → SUCCESS | FAILED`, `SUCCESS → REFUND_INITIATED → REFUNDED | PARTIALLY_REFUNDED`

**Ticket status:** `OPEN → IN_PROGRESS → WAITING_FOR_CUSTOMER → RESOLVED → CLOSED` (auto-close resolved tickets after 7 days without reply)

**Booking status:** `PENDING_PAYMENT → CONFIRMED → COMPLETED | CANCELLED | NO_SHOW | RESCHEDULED`

**Certificate status:** `ACTIVE | SUSPENDED | WITHDRAWN | EXPIRED` (EXPIRED set automatically by a daily job when `validUntil` passes)

Every transition: validates allowed moves, writes history, writes audit log, fires the matching notification event.

---

## 7. FUNCTIONAL REQUIREMENTS BY MODULE

### 7.1 Public Website

**Navigation:** `Logo | Services (mega-menu) | Consultations | Resources (Blog) | Verify Certificate | About | Contact | Login/Sign up`
Services mega-menu lists all categories with their top services + "All Services".

**Homepage** (conversion-focused, fast, mobile-first):
1. Hero: headline *"Everything Your Business Needs, In One Place."* + large search box ("What service are you looking for?") with live autocomplete across services + CTA "Explore Services"
2. Popular Services: 6–8 cards (admin-picked or by popularity)
3. Category tiles (7 categories)
4. How It Works: 6 steps — Choose a Service → Submit Details → Upload Documents → Make Payment → Track Progress → Get Your Documents
5. Positioning strip: START → PROTECT → CERTIFY → COMPLY → CONSULT → GROW (each links to its category)
6. Featured consultants
7. Testimonials, trust badges (secure payments, data privacy), stats counters (admin-editable)
8. Latest blog posts, FAQ, lead-capture "Talk to an expert" form, footer with policies

**Service listing page** (`/services/[category]`): service cards (name, short description, starting price, estimated timeline, "View Details"); filters: service type/subcategory, price range, popularity, category; sort by popularity/price; pagination; SEO intro text and FAQs at bottom.

**Service detail page** (`/services/[category]/[service]`) — standard template for every service:
- Breadcrumbs, title, short intro, rating summary, "Starting from ₹X"
- **Sticky pricing card** (right on desktop, bottom bar on mobile): package selector (Basic/Standard/Premium), price breakdown (professional fee + govt fee + GST), "Get Started" CTA, "Talk to an expert"
- Package comparison table
- Sections with sticky in-page tab navigation: Overview, Benefits, Documents Required, Process (visual stepper), Estimated Time, Pricing, FAQs, Related Services
- Lead-capture form (name, mobile, email, city) for visitors not ready to buy
- JSON-LD schema (Service, FAQPage, BreadcrumbList)

**Other pages:** All Services, Consultants directory (see 7.6), Blog listing/detail, About, Contact (form + map + details), Terms, Privacy, Refund Policy, Verify Certificate (see 7.8), 404/500.

**Global search:** searches services, categories, blog posts; typo-tolerant; tracks zero-result queries for admin.

**SEO:** SSR/ISR, clean slugs, editable meta per page, sitemap.xml, robots.txt, canonical tags, Open Graph, Core Web Vitals green (LCP < 2.5s on 4G), image optimisation.

### 7.2 Authentication
- Register: name, mobile, email, password (min 8, complexity rule) → verify mobile via OTP
- Login: email + password, mobile + OTP, Google login
- Forgot password via email OTP or mobile OTP
- OTP: 6 digits, 5-minute expiry, max 5 attempts, resend after 30s, rate-limited per mobile and IP
- Guest checkout path: user can select a package, then register/login inline without losing selection
- Session management, logout from all devices, account deletion request

### 7.3 Customer Dashboard
Sidebar: Dashboard · My Services · Pending Actions · Documents · Payments · Certificates · Consultations · Notifications · Support · Profile & Businesses

- **Dashboard home:** summary cards (active applications, pending actions, upcoming compliance due dates, unpaid balances), recent activity, "Buy a new service" CTA.
- **My Services:** table/cards — Service · Application ID · Status · Action. The action is context-aware: *View* (in progress), *Upload* (documents pending), *Pay* (balance due), *Download* (completed). Tabs: Active / Completed / Cancelled.
- **Application detail:** vertical status timeline from the service's stages (done / current / upcoming, with dates and customer-visible notes), form data (read-only after submission unless returned for correction), documents checklist with statuses, payments, final documents, assigned expert (name + photo), message thread.
- **Pending Actions:** one list of everything blocking progress (docs to upload/re-upload, payments due, info requested).
- **Documents:** all docs across applications; upload, view, download, replace; status chips; rejection reason shown prominently (e.g., *"Address Proof — Rejected. Reason: Document is not clearly readable."*).
- **Payments:** history, receipts, invoices (PDF download), pay balance.
- **Certificates:** list, view, download PDF, copy/share verification link, show QR, renewal CTA when expiring.
- **Consultations:** upcoming/past bookings, join link, reschedule/cancel per policy, leave review.
- **Notifications:** in-app inbox with read/unread.
- **Support:** create ticket (subject, related service/application, description, attachment, priority), view tickets and thread.
- **Profile & Businesses:** personal details, saved business entities (reused to prefill forms), password, notification preferences.

### 7.4 Application Form & Checkout
1. Customer picks service + package → (login if needed) → selects/creates business entity
2. Dynamic multi-step form from the service's form schema; autosave as DRAFT; progress indicator
3. Upload required documents (can skip and upload later — application then shows "Documents Pending")
4. Order summary: package, govt fee, coupon field, GST breakdown, total
5. Pay via Razorpay → on webhook success: order PAID, application SUBMITTED, invoice generated, notifications sent
6. Success page with Application ID and "Track Application" button

**Upload rules:** PDF/JPG/PNG (configurable), max 10 MB default, virus scan, files uploaded through the API (multer) and stored privately on server storage, downloaded only through signed API links (5-minute expiry), every replacement kept as a new version.

### 7.5 Payments, Invoices, Coupons, Refunds
- Methods: UPI, debit card, credit card, net banking (via Razorpay).
- **Full payment** default; **partial payment** when the package allows it (admin sets advance % or milestones); balance requests appear in Pending Actions.
- Payment confirmation **only via verified webhook signature** — never trust the client callback alone. Idempotent webhook handling.
- **Invoice** auto-generated on each successful payment: sequential number per financial year (e.g., `BN/2026-27/000123`), seller details and GSTIN from Settings, customer details + optional customer GSTIN, service, SAC code, amount, discount, **CGST + SGST** (intra-state) or **IGST** (inter-state) based on place of supply, govt fee shown as a separate non-taxable line, total in figures and words. Downloadable PDF; emailed automatically.
- **Coupons:** code, % or fixed, max discount cap, service-specific, minimum order value, start/expiry, total usage limit, per-user limit; validated server-side.
- **Refunds:** admin initiates full/partial refund with reason → Razorpay refund API → status tracked → credit note generated → customer notified.

### 7.6 Consultations & Consultant Directory
**Directory (`/consultants`)** — marketplace-style listing:
- Categories: CA, CS, Lawyer, Tax Consultant, Trademark Consultant, ISO Consultant, Business Consultant, Technology Consultant
- Filters: category, **location (state/city/area)**, **rating**, experience, fee range, language, consultation type, available today
- Sort: recommended, rating, experience, fee low→high
- Card: photo, name, verified badge, qualification, experience, expertise tags, languages, city, rating + review count, fee, availability indicator, "Book Consultation" button

**Consultant profile page:** photo, name, verified badge, qualification, experience, expertise, services offered, languages, location, fee per session (with duration), rating breakdown (5→1 stars), reviews (verified-booking only), availability calendar, "Book Consultation" CTA.

**Booking flow:** select consultant → consultation type (Audio / Video / Chat / Online Meeting) → date → available time slot (shown in customer's time zone, IST default) → pay → confirmation (email/SMS/push + calendar .ics) → reminders 24h and 1h before → session → review prompt after completion.

**MVP scope:** directory, profiles, slot booking, payment, confirmation, meeting link (consultant-provided or auto-generated Google Meet/Zoom link), reviews.
**Phase 2:** in-app real-time audio/video/chat (e.g., Agora/Twilio/100ms), per-minute billing, online/offline presence, wallet, consultant payouts/commission.

**Consultant onboarding:** apply via form (documents: qualification proof, membership numbers such as ICAI/ICSI/Bar Council, ID) → admin approves → profile goes live. Consultants manage availability, fees (admin approval if changed), and see bookings, assigned applications, reviews, earnings.

### 7.7 Admin / Operations Portal
- **Dashboard:** KPI cards — total customers, new orders (today/7d/30d), active applications, completed applications, pending documents, revenue, consultants, certificates issued, open support tickets; charts for revenue and orders over time; "needs attention" list (SLA breaches, documents waiting for review > 24h).
- **Service Management:** CRUD categories, subcategories, services; packages and pricing; required documents; **form builder** (drag-and-drop or JSON editor with preview); process stages; FAQs; estimated time; SEO fields; activate/deactivate (never hard-delete services that have orders).
- **Application Management:** filterable table (status, service, assignee, date, priority, SLA); detail view with customer, service, order ID, payment, documents, assignment (to ops executive/consultant), status updates (with customer-visible note option), internal notes, customer message thread, final document upload; bulk assign; export CSV.
- **Document Review:** queue of uploaded documents; inline preview (PDF/image); approve / reject with reason (pick from preset reasons or free text) / request additional document.
- **Customer Management:** search (name, mobile, email, application ID), profile, businesses, orders, payments, documents, certificates, tickets; block/deactivate.
- **Consultant Management:** add, approve/reject applications, edit, suspend; manage services and fees; view bookings, reviews (moderate), earnings.
- **Payment Management:** all / successful / failed / pending payments, refunds, invoices, revenue; reconcile with Razorpay; export.
- **Coupons:** CRUD with usage stats.
- **Certificate Management:** create/import certificates (manual form + CSV bulk import), auto-generate certificate number + verification ID + QR, upload or generate PDF, change status (suspend/withdraw with reason), see verification lookups.
- **Notifications:** edit templates per event and channel; send manual announcements.
- **CMS:** homepage sections, About, service page content, blogs, FAQs, testimonials, banners, contact info, Terms, Privacy, Refund Policy — rich-text editor with image upload and SEO fields; draft/publish.
- **Blog / Knowledge Center:** categories (Business Articles, Tax Updates, Trademark, GST, Compliance, Certification), tags, featured image, SEO title, meta description, author, publish/schedule.
- **Support:** ticket queue, assignment, replies, status, priority, SLA timer.
- **Reports:** see Section 7.11.
- **Settings:** company profile and GSTIN, invoice prefix, payment config, OTP/SMS/email settings, roles & permissions, staff users.
- **Audit log viewer.**

### 7.8 Certificate Verification (public, no login)
Route: `/verify` and `/verify/[verificationId]`

- Inputs: **Certificate Number** or **Verification ID**, or **scan QR** (QR encodes `https://biznexa.com/verify/{verificationId}?t={signedToken}`).
- Optional secondary search by organisation name (admin toggle).
- Result card:
  - ✅ **Certificate Verified** — Status: **Active** (green), or clear red/amber states for Suspended / Withdrawn / Expired, or ❌ "No certificate found" with guidance.
  - Fields: Certificate Number, Organisation, Certificate Type/Standard, Scope (optional), Issue Date, Valid From, Expiry Date, Certification Body, Status, "Verified on {timestamp}".
  - Button to view/download the official PDF (admin toggle per certificate).
- Security: rate limit per IP, CAPTCHA after repeated lookups, no customer personal data shown, every lookup logged, verification IDs are random (non-sequential, not guessable).
- Mobile app has a "Scan QR" entry that opens the same verification.
- Public API endpoint `GET /api/public/certificates/verify?number=…` (rate-limited, API-key optional) so third parties can verify programmatically (Phase 2: documented partner API).

### 7.9 Notifications
Channels: Email, SMS, Push, In-app; WhatsApp via the same interface in Phase 2.
Events: registration, OTP, payment success/failure, invoice issued, document requested, document approved, document rejected, application status change, expert assigned, consultation booked/reminder/cancelled, certificate issued, certificate expiring, compliance reminder, ticket created/replied/resolved.
- Templates editable in admin with variables (`{{customerName}}`, `{{applicationId}}`, …).
- Sent via queue with retries; delivery status stored.
- Users can opt out of marketing messages but not transactional ones.
- SMS templates must be DLT-registered (India).

### 7.10 Compliance Reminders & Renewals
- When a recurring service completes or a certificate is issued, the system creates **Reminders** (e.g., GST return due, annual ROC filing due, ISO certificate expiring).
- Daily job sends reminders at configured offsets (default 30/15/7/1 days) via email, SMS, push.
- Message example: *"Your ISO 9001 certificate expires in 30 days."* with CTA **Renew Now** → deep-links to the renewal service with business entity and details prefilled.
- Dashboard widget "Upcoming due dates." (Advanced compliance calendar = Phase 2.)

### 7.11 Reports (Admin)
Date-range filter, charts + tables, CSV/Excel export:
- **Sales:** total, monthly, service-wise, category-wise, coupon impact
- **Customers:** total, new, active (ordered in last 90 days)
- **Services:** popular services, active / completed / cancelled applications, average turnaround time per service, SLA breaches
- **Consultants:** total, active, bookings, revenue, average rating
- **Support:** tickets by status, average first-response and resolution time

### 7.12 Support & Messaging
- Tickets as in 7.3/7.7.
- **Messaging (MVP = asynchronous threads):** per application and per ticket; text, images, documents; unread counts; email/push notification on new message. Real-time chat (WebSockets) is Phase 2.

---

## 8. CUSTOMER MOBILE APP (Android + iOS)

Bottom tabs: **Home · Services · My Services · Notifications · Account**

- **Login:** mobile OTP, email + password, Google; biometric unlock after first login
- **Home:** search, popular services, pending actions banner, upcoming due dates
- **Services:** browse categories → service detail → package → form → upload (camera capture with auto-crop, gallery, files) → pay (Razorpay SDK incl. UPI intent)
- **My Services:** active / completed / pending actions; application detail with timeline
- **Documents:** upload, view, download, replace
- **Payments:** pay balance, history, invoice download
- **Certificates:** view, download, share verification link, **Verify Certificate**, **Scan QR**
- **Consultation:** find consultant, book appointment, join meeting (Phase 2: in-app chat/audio/video)
- **Support:** create ticket, view tickets, message support
- **Push notifications:** application updates, payment reminders, document requests, consultation reminders, certificate updates, compliance reminders — each deep-links to the relevant screen
- Offline-friendly lists (cached), force-update mechanism, crash reporting

---

## 9. UX REFERENCE GUIDE (patterns only — do not copy content or branding)

| Area | References | Patterns to adopt |
|------|-----------|-------------------|
| Service pages | indiafilings.com, onlinelegalindia.com | Mega-menu by category; service hero with sticky price/CTA card; package comparison; clear "documents required" checklist; visual process steps; long SEO content + FAQs below the fold; lead-capture "talk to an expert" form; trust signals near the price |
| Consultant marketplace | astrotalk.com | Expert cards with photo, rating, experience, languages, fee, online/available badge and instant "Book/Chat/Call" buttons; quick filter chips; booking in very few taps |
| Consultant marketplace | clutch.co, goodfirms.co | Directory filters (location, category, rating, budget); verified badges; detailed review pages with rating breakdown; profile pages with services, focus areas, portfolio |
| Consultant booking | planetayurveda.com | Simple consultation booking form: choose expert/type, date, time, pay, confirmation |
| Dashboard / reports | semrush.com | Clean KPI cards, data tables with filters, and chart-first admin dashboards |
| Certificate verification | testometer.co.in/verify, qualifi.net/e-cert-verify, iafcertsearch.org, certificates.genveritas.in/verify | Single focused input (certificate no. / verification ID), instant result card with clear status colours, issuing/certification body shown, QR entry point, search by company name (IAF style), public no-login access |
| Verification API | surepass.io | Expose a clean, rate-limited verification API for third parties (Phase 2) |

**Design system:** professional, trustworthy, modern. Primary deep blue/indigo, accent for CTAs, success green, warning amber, error red. Inter or similar sans-serif. Accessible contrast (WCAG 2.1 AA), keyboard navigation, visible focus states. Indian formats: ₹ with Indian digit grouping (₹1,25,000), DD-MMM-YYYY dates, IST.

---

## 10. NON-FUNCTIONAL REQUIREMENTS

**Security**
- OWASP Top 10 protections; input validation with Zod/class-validator; parameterised queries (Prisma)
- Passwords hashed with Argon2/bcrypt; rate limiting on auth, OTP, verification, and search
- Encrypt sensitive fields at rest (PAN, Aadhaar numbers — store masked where possible; **never store full Aadhaar in plain text**)
- All documents in private storage; access only via short-lived signed URLs after permission check
- HTTPS everywhere, HSTS, secure cookies, CSRF protection on web, CORS allow-list
- Razorpay webhook signature verification; secrets in a secrets manager, never in code
- Audit log for all staff actions; admin 2FA mandatory

**Privacy & legal (India)**
- Comply with the **Digital Personal Data Protection Act, 2023**: consent at signup, purpose-limited data use, data export and deletion requests, data retention policy
- Data hosted in India (ap-south-1)
- GST-compliant invoices and credit notes
- DLT-compliant SMS

**Performance & scale**
- API p95 < 300 ms for reads; pages LCP < 2.5s on mid-range mobile
- Designed for 100k customers and 10k concurrent sessions without re-architecture
- Background jobs for PDFs, notifications, reminders, exports

**Reliability**
- Daily automated DB backups with point-in-time recovery; tested restore
- Health checks, error tracking (Sentry), uptime alerts
- Environments: local, staging, production; seeded demo data for staging

**Quality**
- Unit tests for business logic (pricing, tax, coupons, state machines) ≥ 80% coverage
- Integration tests for all API modules; E2E tests (Playwright) for: signup → buy service → upload → pay → admin approves → status updates → final doc download; certificate verification; consultation booking
- Lint, type-check, test on every PR in CI

**Extensibility (prepare for Phase 2/3)**
- Notification channel interface (add WhatsApp without touching business logic)
- Payment gateway interface (add another gateway later)
- i18n-ready strings (multi-language in Phase 3)
- Organisation/multi-user accounts possible later (keep BusinessEntity separate from User)
- Event bus for domain events (e.g., `application.status_changed`) to plug in automation and AI later

---

## 11. CORE WORKFLOW (end-to-end — must work in MVP)

```
CUSTOMER: Select Service → View Details → Select Package → Register/Login
        → Fill Application Form → Upload Documents → Make Payment
ADMIN/OPS: Review Application → Verify Documents (approve/reject/request)
        → Assign Consultant/Executive → Process Service → Update Status (each update notifies customer)
        → Upload Final Documents / Issue Certificate
CUSTOMER: Receive Notification → Download Certificate/Document → (Reminder set for renewal if recurring)
```

---

## 12. SCOPE BY PHASE

**MVP (build now)**
- Website: Homepage, service categories, listing, detail, registration/login, contact, blog, certificate verification, consultant directory + profiles
- Customer portal: dashboard, my services, application form, documents, payments, invoices, certificates, consultations (booking with meeting link), notifications, support
- Admin: dashboard, customers, services (incl. form builder), applications, documents, payments, coupons, consultants, certificates, CMS, blog, support, basic reports, settings, audit log
- Consultant web portal: profile, availability, bookings, assigned applications, messages
- Mobile app: login, services, my services, documents, payments, certificates (incl. verify + QR scan), notifications, support
- Notifications: email, SMS, push, in-app; compliance/expiry reminders (basic)

**Phase 2**
Advanced consultant marketplace (instant connect, per-minute billing), in-app audio/video consultation, real-time chat, partner/agent portal + consultant/partner mobile app, referral system, advanced compliance calendar, automated renewals, WhatsApp integration, advanced reports, wallet/commission/payouts, advanced CRM (leads pipeline), public verification API for partners.

**Phase 3**
AI business assistant, AI service recommendation, AI document checking (OCR + validity checks), government/API integrations (MCA, GST, trademark registry), advanced compliance automation, enterprise accounts (multi-user organisations), multi-language, advanced business analytics.

---

## 13. BUILD ORDER & MILESTONES

Complete each milestone with tests and a short demo note in `docs/CHANGELOG.md`.

1. **Foundation:** monorepo, CI/CD, Docker, env config, DB schema v1, auth (all methods), RBAC, audit log, file upload service, design system
2. **Catalogue:** categories/services/packages/documents/stages/FAQs admin + public listing and detail pages + search + seed data (Section 4)
3. **Ordering:** dynamic form builder + renderer, cart/checkout, coupons, Razorpay payments + webhooks, invoices (PDF, GST)
4. **Fulfilment:** application management, document review, assignment, status timeline, final documents, internal notes, messaging threads
5. **Customer dashboard** (all sections in 7.3)
6. **Notifications** (all channels + templates) and **reminders/renewals**
7. **Certificates:** management, PDF + QR generation, public verification page
8. **Consultants:** onboarding, directory, profiles, availability, booking, reviews, consultant portal
9. **Support** tickets; **CMS** and **blog**
10. **Reports** and admin dashboard KPIs
11. **Mobile app** (consumes the same API)
12. **Hardening:** security review, performance, accessibility audit, E2E suite, backups, monitoring, staging UAT, production launch checklist

---

## 14. ACCEPTANCE CRITERIA (definition of done for MVP)

- [ ] Admin can create a brand-new service with packages, documents, form, and stages **without code changes**, and it appears correctly on the website and app.
- [ ] A new customer can sign up with mobile OTP, buy a service, apply a coupon, pay via UPI on Razorpay test mode, and see the application as **Submitted** with an Application ID.
- [ ] A GST-correct invoice PDF (CGST/SGST vs IGST by state) is generated and emailed within 1 minute of payment.
- [ ] Ops executive rejects a document with a reason; customer is notified on email, SMS and push, sees the reason, re-uploads, and the new version goes back to review.
- [ ] Every status change shows on the customer timeline and triggers the correct notification.
- [ ] Final document uploaded by ops is downloadable by the customer on web and mobile.
- [ ] Certificate issued by admin can be verified publicly by number, verification ID, and QR scan without login; suspended/expired certificates show the correct status.
- [ ] Certificate expiring in 30 days triggers a reminder with a working "Renew Now" link.
- [ ] Customer can filter consultants by category, location and rating, book a slot, pay, and receive confirmation with a meeting link.
- [ ] Customer can raise a ticket and receive a reply from a support executive.
- [ ] Admin reports show correct sales, customer, service, and consultant numbers for a date range and export to CSV.
- [ ] Ops executive cannot see applications not assigned to them; customers cannot access other customers' data (verified by automated tests).
- [ ] All E2E tests pass; Lighthouse ≥ 90 for performance, SEO and accessibility on homepage and a service page.

---

## 15. DELIVERABLES

1. Source code in the monorepo structure above
2. Prisma schema + migrations + seed script (full service catalogue, demo customers, consultants, certificates)
3. OpenAPI/Swagger documentation
4. `README.md` (setup in under 15 minutes), `docs/DECISIONS.md`, `docs/RUNBOOK.md`, ER diagram
5. Test suites (unit, integration, E2E) passing in CI
6. Staging deployment with demo logins for each role
7. Mobile app builds (Android APK/AAB, iOS TestFlight)
8. Production deployment checklist

---

## 16. OPEN QUESTIONS (assumptions used until the owner answers)

| Question | Assumption |
|----------|-----------|
| Does BizNexa itself issue certificates, or display certificates issued by partner certification bodies? | BizNexa records certificates with a named Certification Body; verification shows both |
| Is consultation in MVP? (PRD MVP list omits it, but admin consultant management is included) | MVP includes directory + slot booking with meeting link; real-time chat/audio/video is Phase 2 |
| Consultant/Partner app timing | Consultants use a responsive web portal in MVP; native app in Phase 2 |
| Commission model for consultants | Track fee and platform commission % per booking; payouts handled manually in MVP |
| Government fees | Shown separately, collected with the order, not subject to GST |
| Brand assets (logo, colours, domain) | Placeholder brand until provided |
| Refund policy rules | Admin-initiated refunds only; policy text managed in CMS |
