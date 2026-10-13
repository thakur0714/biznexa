# Changelog

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
