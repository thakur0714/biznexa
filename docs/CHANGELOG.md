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

**Ordering & Application Forms**
- Dynamic application form renderer: JSON schema forms with field types (text, select, multi-select, repeater, address, date, file), dynamic conditional fields (`showIf`), validation rules, autosaving drafts, and versioning.
- Document management: required document checklist per service/package, file uploads via signed URLs, version history, virus scanning, and approval/rejection state machine.
- Business entities: customer profile business entity picker and management.

**Checkout & Payments**
- Order summary and tax calculation: GST breakdown (CGST+SGST vs IGST based on place of supply), government fee handling, advance/partial payment options.
- Coupon engine: discount validation (percentage / fixed amount, minimum order value, max discount cap, per-user and total usage limits), admin coupon management API.
- Online payments: Razorpay integration and in-memory MOCK payment gateway, secure payment initiation, signed webhook handler with idempotent processing (`payment.captured`, `payment.failed`).
- Invoicing & PDF generation: GST-compliant tax invoice template, HTML to PDF generation via Playwright/Chromium, signed invoice download links.
- End-to-end full order journey Playwright test spec (`apps/web/e2e/order-journey.spec.ts`) covering customer login, package choice, form submission, document upload, coupon redemption, mock payment checkout, signed webhook verification, and success confirmation view.

### Test results
- Shared package (`@biznexa/types`): 244 unit tests passing.
- UI package (`@biznexa/ui`): 40 unit tests passing.
- Admin app (`@biznexa/admin`): 89 unit tests passing.
- Browser: Playwright smoke spec + full order journey spec (`order-journey.spec.ts`).

### Next: Milestone 4 — Fulfilment (Admin / Ops)
Application state machine, admin applications list, detail view, assignment to ops executives/consultants, status update UI, document review queue, internal notes, rejection presets.
