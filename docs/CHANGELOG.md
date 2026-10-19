# Changelog

## M9.8 — Blog public pages (19-Oct-2026)

- Replaced the Resources placeholder with a paged blog listing, category/tag pages, and sanitized article details with canonical metadata, Open Graph images and Article JSON-LD.
- Added published-only public API schemas, bounded paging, filters, published-post taxonomy counts, and 404s for unknown slugs. Regenerated OpenAPI and `@biznexa/api-client` schema.
- Added the homepage's latest three posts, published post/category/tag sitemap entries, 5-minute production revalidation, and loading/empty/error states.
- Tests: 2 shared schema tests, 3 API integration tests, 2 Playwright runs (desktop and mobile). Full checks: types 494, API 1,031, admin 205; web production build passed.

## M8.14 — Featured consultants (18-Oct-2026)

- Added a homepage section backed by `GET /api/public/consultants?featured=true`; it is hidden when there are no featured consultants and sits alongside the homepage CMS sections.
- Added the audited Featured toggle to the consultant admin detail page for approved consultants and exposed the meeting link on booking confirmation.
- Added Playwright coverage for filtering consultants, booking a slot, completing mock payment, and seeing the confirmation link on desktop and mobile.

## M9.7 — Blog admin (18-Oct-2026)

- Added admin blog post CRUD with sanitized rich-text content, media-library featured images, author, categories, tags, SEO fields and draft/scheduled/published states. Category and tag writes now await their audit records.
- Added idempotent queue publishing for scheduled posts with startup recovery, plus public blog API routes that return published posts only.
- Added the admin post/category/tag editor and API coverage for scheduling, unpublished visibility, XSS stripping and missing `cms.manage` permissions.

## M9.5 / M9.6 — CMS (in progress, 18-Oct-2026)

- Added CMS page draft, publish and unpublish endpoints requiring `cms.manage`; writes are audit logged and rich HTML is saved through `richTextInput`.
- Added SEO title, meta description and Open Graph image URL to `CmsPage`; public page reads continue to return only published rows.
- Added an admin page editor using the shared `RichTextEditor`, contact email/phone fields, and SEO metadata rendering; About and Contact read published CMS content. D62 records the `{ html }` content shape.
- Added audited homepage administration for banners, testimonials, stats, active catalogue service picks and FAQs, including ordering and active flags. The public homepage renders these sections and uses the legacy layout only when CMS content is empty.
- Focused CMS e2e, admin tests (191), rich-text sanitizer tests (56), migrations and typechecks pass. Full API test suite still needs a clean run.

## Milestones 1 & 2 — Foundation and Catalogue (09-Oct-2026)

### Built and tested

**Foundation (M1)**
- pnpm + Turborepo monorepo: `apps/api`, `apps/web`, `packages/types`; Docker Compose for Postgres/Redis/MinIO; Dockerfiles; GitHub Actions CI.
- Full database schema v1 (all entities from prompt Section 5) with the initial migration.
- Authentication: register (with consent), email + password, mobile OTP login, email/mobile OTP password reset, Google sign-in endpoint (needs `GOOGLE_CLIENT_ID`), refresh-token rotation with theft detection, logout and logout-all-devices.
- Permission-based RBAC: 5 roles, 18 permissions, global guard (`@Public()` / `@RequirePermissions()`).
- Audit log for every admin change. Validated environment config that blocks weak secrets in production.
- Shared package: GST maths (CGST+SGST vs IGST, government fee not taxed), coupon maths, state machines for applications, documents, tickets and certificates, Indian ₹ and date formatting.

**Catalogue (M2)**
- Seeded catalogue: 7 categories, 63 services, 3 packages each, document checklists, process stages, FAQs, related services, SEO fields.
- Public API: categories, filtered/sorted/paginated listing, service detail with price breakdown, typo-tolerant search, popular services.
- Admin API: create a complete service (packages, documents, stages, FAQs) in one call, edit, deactivate/soft-delete, replace packages/documents/stages/FAQs safely (rows used by orders are kept).
- Website: homepage (search with suggestions, journey rail, popular services, how it works, expert call-back), all-services and category listings with filters, service detail page (sticky pricing card / mobile bottom bar, package comparison, documents, process, FAQs, related services, lead form, JSON-LD), About, Contact, policy pages from the CMS table, sitemap.xml, robots.txt, 404/error pages.
- Accounts: login (password or OTP), registration with mobile verification, forgot password, dashboard shell, "Get started" → login → order summary for the chosen package.

**Pulled forward from M7**
- Public certificate verification by number, verification ID, signed QR link or organisation name; admin issue/suspend/withdraw with state rules; QR image generation; nightly expiry job; every lookup logged.

### Test results
- Shared package: 15 unit tests passing.
- API: 25 tests passing (20 integration against a real database, 5 search unit tests).
- Browser: 14 Playwright tests passing (7 journeys × desktop and mobile).

### Placeholders to replace before launch
- Service prices, testimonials, certification-body names and policy page text are demo content.
- Logo and colours are a placeholder brand.

## Milestone 3 — Ordering (13-Oct-2026)

### Built and tested

**Application forms**
- Versioned form schemas per service (saving creates version N+1; an application keeps the version it started with), shared validator, admin form builder with preview.
- Ready-made forms for 18 services (Private Limited, LLP, GST, Trademark, ITR, ISO, FSSAI…) and a generic form for the rest.
- Web form renderer (text, select, multi-select, repeater, address, date, conditional `showIf` fields), multi-step form page with autosave and resume.
- Customer business entities (GSTIN/PAN checked, PAN encrypted at rest); draft order + application with safe `ORD-YYYY-NNNNNN` / `BN…` codes.
- Document checklist step: upload per required document, pay now and upload later.

**Checkout and payments**
- Coupons: validation (percentage / flat, minimum order, cap, per-user and total limits) and admin coupon management with usage stats.
- Order summary with GST (CGST+SGST or IGST by place of supply), government fees outside GST, seller details from Settings.
- Payment gateway interface with Razorpay and a mock gateway; start payment, client callback, signed and idempotent webhook (`payment.captured`, `payment.failed`), payment success page, partial (advance) payments.
- Invoices: gap-free numbering, invoice record on payment, PDF generation queue (Chromium), GST rule-46 invoice template, owner-only signed download link.

### Test results (13-Oct-2026, local)
- Shared package: 244 unit tests passing. API client: 7. UI package: 40. Admin app: 89.
- API: 279 tests passing in 33 suites (integration against a real database, plus unit tests).
- Browser: 16 Playwright tests passing (smoke journeys + the full order journey, desktop and mobile). The order journey: new customer logs in with mobile OTP → Trademark Registration, Basic package → three-step form → uploads a PDF → applies a coupon made through the admin API → pays with the mock gateway (completed by a signed webhook) → payment success with the Application ID.

### Placeholders to replace before launch
- Service prices and placeholder invoice layout details (logo, signature line) — owner/CA to confirm.
- Not tried against Razorpay test mode yet (no keys).

### Next: Milestone 4 — Fulfilment (Admin / Ops)
Admin applications list and detail, assignment, status updates and the document review queue. Rejection presets, internal notes, the audit log viewer and document state tests are already done (13-Oct-2026).

## Milestone 7 — Certificates (15-Oct-2026)

### Built and tested

**PDF Generation & Uploads (M7.3)**
- A4 landscape official certificate PDF template with embedded Noto Sans font, official double border, seal, and inline QR code data URL.
- Integrates with M3.22 PDF queue (`pdf.render`) on `certificate.issued` domain event.
- Custom PDF attachment option using M2.5.6 upload service with mime-type and virus scan checks.
- Per-certificate "allow public PDF download" toggle for public verification page.
- Owner and staff signed download link generation with tamper detection and expiration.

**CSV Bulk Import (M7.4)**
- Batch certificate import supporting flexible CSV headers and RFC 4180 parsing with CSV injection protection.
- Row-by-row validation with duplicate checking against both the CSV and existing database records.
- Downloadable sample CSV template and CSV error report with detailed row and field messages.
- Atomic import executed within a single database transaction (`prisma.$transaction`), emitting domain events and audit log entries.
- Admin portal Bulk Import interface (`/certificates/import`) with upload dropzone, validation summary, preview table, and error report download.

**Customer Certificates Portal (M7.6)**
- Customer portal certificates page (`/dashboard/certificates`) displaying all issued certificates linked via business entity ownership or application.
- Status badges (Active, Suspended, Withdrawn, Expired) and 30-day expiry warning alerts.
- One-click official PDF download via secure signed links.
- Copy/share verification URL and interactive QR code preview modal with downloadable QR image.
- "Renew Certificate" CTA displayed for expiring or expired credentials deep-linking to renewal services.
- Updated customer dashboard sidebar navigation.

**Public Verify API (M7.7)**
- Public certificate verification endpoint `GET /api/public/certificates/verify?number=` with rate limiting and rate limit response headers (`X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`).
- Optional partner API key support via `X-API-Key` header or `apiKey` query parameter granting elevated rate limits (300 req/min).
- Lookup logging recording verification method (`NUMBER`, `VERIFICATION_ID`, `QR`, or `API`) and partner attribution.

## M4.13 — Refunds and credit notes (17-Oct-2026)

### Built and tested
- Admin can refund a paid payment fully or partly with a reason (Payments → payment detail → Refund). Only staff with "Issue refunds" (Admin by default) see the button; the API refuses everyone else.
- Safe against mistakes: never more than what is left to refund, one refund at a time per payment, and a double-click or retried request (same `Idempotency-Key`) never refunds twice.
- The gateway confirms each refund by webhook: payment becomes Refunded or Partially refunded; a failed refund puts the payment back where it was. Repeated webhooks change nothing.
- GST credit note for every processed refund: own number series `CN/2627/000001`, the reverse of the original invoice (a proportional share for a partial refund, CGST/SGST/IGST correct to the paisa), PDF in the invoice layout. Customer and staff with payments access can download it.
- Customer Payments page shows each refund's status and the credit note; the customer gets a "refund processed" notification (email, SMS, push, in-app, WhatsApp templates).
- Every refund step is in the audit log with before/after.

### Test results
- New: 11 API integration tests (refunds), 2 credit note template tests, 2 notification tests, 11 shared-package tests (+ gateway webhook parsing), 7 admin component tests.

### Before going live
- In the Razorpay dashboard, add the `refund.processed` and `refund.failed` events to the webhook.

## Milestone 10 — Reports & Analytics (17-Oct-2026)

### Built and tested

**Services Report (M10.5)**
- API endpoint `GET /api/admin/reports/services` with IST date-range filtering and SQL aggregations (`groupBy`, `aggregate`, `$queryRaw`).
- Metrics: popular services (orders count and total revenue in paise), applications by status, average turnaround time (submittedAt → completedAt, days), and SLA breaches per service.
- Admin portal page `/reports/services` with date range filter, summary metric cards, popular services table, application status breakdown, and SLA breach monitor.

**Consultants Report (M10.6)**
- API endpoint `GET /api/admin/reports/consultants` with IST date-range filtering.
- Metrics: total consultants, active consultants count, verification status breakdown (Pending, Verified, Rejected), bookings count, booking revenue from SUCCESS payments, and average rating.
- Admin portal page `/reports/consultants` with verification breakdown, revenue metrics, and consultant performance table.

**Support Report (M10.7)**
- API endpoint `GET /api/admin/reports/support` with IST date-range filtering.
- Metrics: tickets by status (Open, In Progress, Waiting Customer, Resolved, Closed), average first staff response time (minutes), average resolution time (hours), and priority distribution.
- Admin portal page `/reports/support` with status metrics, response/resolution KPI cards, and ticket details table.

**Background CSV Report Export (M10.8)**
- Reusable "Export CSV" button across all report pages (`sales`, `customers`, `services`, `consultants`, `support`).
- BullMQ queue job (`report-export`) generating CSV asynchronously with MinIO/S3 object storage upload.
- Secure 24-hour HMAC-signed download links with tamper and expiration validation.
- RBAC: `reports.view` permission strictly enforced on export enqueue and signed link generation.

## Milestone 6 — Notifications & Templates (Part 1, 18-Oct-2026)

### Built and tested

**Admin Notification Template Editor (M6.9 part 1)**
- API endpoints `GET /api/admin/notifications/templates`, `GET /api/admin/notifications/templates/events`, `POST /api/admin/notifications/templates/preview`, `GET /api/admin/notifications/templates/:id`, `PUT /api/admin/notifications/templates/:id` guarded by `settings.manage` permission.
- Variable catalog and sample variables per event for all 24 transactional events across EMAIL, SMS, PUSH, IN_APP, and WHATSAPP channels.
- Live preview rendering with sample event variables and detection of missing/unknown variables.
- SMS DLT template ID configuration, character and SMS segment counter with GSM-7 detection.
- Complete audit logging (`notification.template.update`) for every template modification.
- Admin UI template editor (`/notifications`) with channel tabs, device previews, variable chips, and `useApi()` typed client integration.

## Milestone 4 — Fulfilment Integration & End-to-End (18-Oct-2026)

### Built and tested

**M4 Fulfilment Integration & Authorization Coverage (M4.17)**
- End-to-end Playwright journey in `apps/web/e2e/document-reupload.spec.ts`: customer order & document upload → ops reviews and rejects with reason → customer sees reason and re-uploads v2 in dashboard → ops reviews and approves v2 → application automatically moves to DOCUMENTS_APPROVED → moves to IN_PROGRESS → ops uploads final deliverable (PDF certificate) and attaches to application → application moves to COMPLETED and DELIVERED → customer verifies "Delivered" status and downloads the final deliverable.
- Comprehensive M4 route authorization and scoping test suite `apps/api/test/m4-authorization.e2e-spec.ts` (67 tests):
  - 401 Unauthorized enforced for unauthenticated requests across all M4 endpoints.
  - 403 Forbidden enforced for customer role on staff/admin routes.
  - 403 Forbidden enforced for support role on routes requiring applications/documents/certificates management.
  - 403 Forbidden enforced for operations staff lacking global management permissions (`applications.view_all` for bulk-assign and assignee patch, `certificates.manage` for certificate creation).
  - 404 Not Found scoping enforced for operations staff attempting to access unassigned applications, documents, internal notes, or deliverables.
  - Customer data isolation: customer accounts cannot access or view other customers' applications, documents, notes, or deliverables.

## Milestone 11 — Mobile App (Expo) (18-Oct-2026)

### Built and tested

**Mobile App Scaffold & Android Tester APK (M11.1)**
- Expo SDK 52 mobile application scaffolded in `apps/mobile` and added to pnpm workspace and Turborepo (`dev`, `build`, `test`, `lint`, `typecheck`).
- Configured specifically for Android tester APK distribution (`eas.json` and `app.json` preview/production APK build targets; no iOS/TestFlight, no store submission per 18-Oct decision).
- Centralized design tokens in `@biznexa/config/tokens` (colors: ink, night, paper, rule, seal, marigold, danger; spacing; radius; typography) imported directly by the mobile app.
- Shared `@biznexa/types` and `@biznexa/api-client` packages integrated without duplicated types.
- React Navigation bottom tab navigator with Ionicons icons across Home, Services (Browse), and Account.

**Mobile Authentication & Secure Storage (M11.2)**
- Header `X-Client: mobile` enforced across all client API calls, matching API expectations for mobile session handling.
- Refresh token securely stored and rotated in `expo-secure-store` with automatic retry on 401. Access token kept in memory only.
- Authentication methods:
  - Indian mobile number OTP login and verification with countdown timer.
  - Email + password login and account registration with validation using `@biznexa/types` schemas (`mobileSchema`, `loginSchema`, `registerSchema`, `otpVerifySchema`).
  - Google OAuth sign-in integration (`POST /api/auth/google`).
  - Biometric authentication (FaceID / Fingerprint) toggle via `expo-local-authentication`, with auto-lock on launch and biometric unlock screen.

**Home & Services Catalogue (M11.3)**
- Home screen: BizNexa brand header, live typo-tolerant search with quick results dropdown (`GET /api/catalogue/search`), popular services cards with turnaround times (`GET /api/catalogue/popular`), category chips with service counts (`GET /api/catalogue/categories`), and trust indicators.
- Services browse screen: searchable and filterable service catalogue (`GET /api/catalogue/services`) with category filter pills, sorting options (Popular, Price Low-High, Price High-Low, Name), pull-to-refresh, and empty state handling.
- Service detail screen (`GET /api/catalogue/services/:slug`): service overview, packages selection cards with complete fee breakdown (professional fee, GST, government fee, partial payment advance %), required documents checklist, ordered process timeline stages, expandable FAQs accordion, related services, and sticky bottom booking bar.

**My Services & Application Detail (M11.5)**
- My Services list screen (`GET /api/applications`) displaying customer's ongoing and completed services with category filters, status pills (using `@biznexa/types` application status tokens), search, pull-to-refresh, and empty state.
- Application detail screen (`GET /api/applications/:id`): ordered lifecycle process stages timeline with active/completed status indicator, assigned expert details, deliverable certificate download cards, and interactive message thread.
- Bidirectional messaging tab (`GET /api/applications/:id/messages` and `POST /api/applications/:id/messages`) supporting text messages and multi-file attachments uploaded via camera or document picker.

**Documents & Payments (M11.6)**
- Documents screen (`GET /api/applications/:id/documents`): mandatory and optional documents checklist with status badges (PENDING, APPROVED, REJECTED), rejection remarks, and action triggers for camera capture (`expo-image-picker`), gallery selection, or file upload (`expo-document-picker`).
- Secure file upload service (`apps/mobile/src/api/upload.ts`) handling multipart upload (`POST /api/files`) with mime type & size limit validation, followed by document replacement/upload (`POST /api/applications/:id/documents/:docId/upload`).
- Payments screen (`GET /api/orders`): list of completed and pending payment transactions, invoice PDF download and sharing via `expo-file-system` and `expo-sharing`, and pay balance modal for partial payments.

**Certificates & QR Verification (M11.7)**
- Certificates screen (`GET /api/certificates`) with status badges (ACTIVE, EXPIRING, EXPIRED), issuance and validity dates in DD-MMM-YYYY format, and PDF certificate download and native share sheet integration.
- Public certificate verification lookup by number (`GET /api/public/certificates/verify?number=...`) displaying verification state, holder details, issuing body, and validity period.
- Integrated camera QR scanner screen (`expo-camera`) with live viewfinder overlay, torch toggle, camera flip, and automatic parsing of raw certificate numbers and verification URLs.

### Test results (18-Oct-2026)
- 22 unit tests in `@biznexa/mobile` covering theme tokens, API client headers and error parsing, secure storage persistence, auth schema validation, multipart file upload validation, and screen logic.
- All 10 workspace packages passing typecheck (`turbo run typecheck`), lint (`turbo run lint`), and tests (`turbo run test`).

## M8.11 — Customer Consultations (18-Oct-2026)

- Added the customer Consultations page with upcoming and past bookings, IST session times, booking status and fees.
- Confirmed sessions show their meeting link; completed sessions link to the review flow.
- Customers can cancel or reschedule more than 24 hours before a session. Rescheduling lists the consultant’s available times, and the lifecycle API rechecks the policy and slot under lock.

## M8.12 — Consultation Reviews (18-Oct-2026)

- Customers can submit one 1–5 star review with an optional comment after a booking reaches `COMPLETED`. The booking's unique review relation enforces one review per booking.
- New reviews await moderation. Admins can approve or reject with a reason; every moderation decision is written to the audit log.
- Approval updates the consultant's average rating and review count in the same transaction. Consultant profiles show approved reviews and calculate their rating breakdown from approved reviews only.

## M8.13 — Consultant Portal (18-Oct-2026)

- Added consultant-only portal navigation and pages for bookings, assigned applications, messages, and earnings.
- Consultants see only their own bookings and assigned applications. Booking outcomes call the existing cx-9 endpoint; application detail reuses the existing M4.11 message thread.
- Conversation list shows unread counts. Earnings include only `COMPLETED` bookings and calculate fee less the consultant record’s commission rate, in paise with Indian currency formatting.
- Added API e2e coverage proving cross-consultant isolation and 403 responses for customers; regenerated OpenAPI and API client types.
## M5.13 — Customer data isolation (18-Oct-2026)

### Checked and tested
- Every customer route was reviewed for ownership checks; no leak was found, so no code changed.
- API: `test/data-isolation.e2e-spec.ts` (86 tests). Customer A gets 404 for every one of customer B's applications, documents, deliverables, payments, invoices, credit notes, certificates, messages, attachments, tickets, bookings, businesses, notifications and data exports — the same answer as an id that doesn't exist. B's ids inside A's requests (files, business, application) are refused, signed download links can't be pointed at another resource, lists/counts/dashboard show A nothing of B's, and B's data is checked unchanged afterwards.
- Browser: `e2e/customer-isolation.spec.ts` on desktop and mobile — A opens B's application by URL and sees "Application not found"; A's My Services, Businesses and Support pages show none of B's things.

## M12.1 — Security review & M12.2 — Sensitive data (18-Oct-2026)

Report: `docs/reviews/SECURITY_REVIEW_2026-10-18.md`. Decisions: D64, D65.

### Fixed
- **Password reset tokens work once.** They are bound to the old password hash. Before, a token could be replayed for 10 minutes.
- **Account pre-hijacking.** Google sign-in or OTP login on an account whose email/mobile was never verified now clears its password and revokes every session (audited).
- **Rate limits on every sensitive route** (`src/common/rate-limits.ts`): password change, refresh, and payment create/callback for applications and bookings now have their own limits too.
- **Headers:** helmet CSP + HSTS (2 years, includeSubDomains) in production only. Web and admin send HSTS in production. `CORS_ORIGINS` is validated (no `*` or paths, https in production). The refresh cookie gets a 403 from a foreign `Origin`.
- **PAN and bank-account answers** in application forms are encrypted at rest. They are shown in full to the customer, the data export and Admin/Operations, and masked for consultants.
- **Aadhaar:** the form builder refuses Aadhaar number fields. A grep of the schema, forms, exports and logs found no stored number.
- **PII scrub in logs:** `RedactingLogger` removes emails, mobiles, PANs, Aadhaar-shaped numbers, tokens and passwords from messages, contexts and stacks.
- **Dependencies:** postcss and mysql2 overridden. No runtime advisories remain in the API. The remaining dev-tool advisories are accepted (review A1).

### Deploy note
- `CORS_ORIGINS` must list every browser origin that signs in (website + admin), or `/api/auth/refresh` returns 403.

### Test results
- Lint 0 errors (warnings are older ones) and typecheck pass in every package.
- Unit/integration: types 490, api-client 7, mobile 12, rich-text 56, ui 40, admin 195, web 19, API 922, all passing. New: `security.e2e-spec.ts`, `rate-limits.e2e-spec.ts` (throttler on: the 11th login gets 429), `security.spec.ts`, `redacting-logger.spec.ts`, `sensitive-form-data.spec.ts`, PAN visibility in `application-form.e2e-spec.ts`, Aadhaar rules in `form-schema.test.ts`, `next-config.test.ts` (web, admin).
- Browser: 26 Playwright tests passing (desktop + mobile). During the run the dev API log scrubbed 22 emails/mobiles and none appeared in plain text.
## M12.4 — Authorization sweep (18-Oct-2026)

### Built and tested
- Every API route now declares who may call it: `@Public()`, `@SignedIn()`, `@CustomerOnly()`, `@RequirePermissions()` or `@RequireAnyPermission()`. The global guard refuses a route that declares nothing (D63).
- Customer self-service routes are customer-only: staff accounts get 403 there instead of acting as a customer.
- API: `test/route-access.e2e-spec.ts` — every route (found from the running app) × anonymous, customer, consultant, admin, operations, support and a staff session before 2FA, checked against the decorators and the role seed. A new route without an access decorator fails it.
- Test fix: `invoice-pdf` and `invoice-record` no longer share a far-future invoice year with each other or with `invoice-numbers`, and their date override applies only to their own payments, so the counter each deletes at the end is never one another suite (or this process's invoice sweep, working on another suite's payment) is using. This removes the random duplicate-invoice-number failures in parallel runs.
- Test fix: `certificate-pdf` waited only for its own process's `pdf.generated` event, but every API process queues all certificates without a PDF when it starts, so another suite's process could render the regenerated PDF first and the test timed out after 2 minutes. It now also watches the certificate's `pdfKey`.

### Test results
- API suite run 3 times in a row: 83 suites, 794 tests, all passed each time.

