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

### Next: Milestone 3 — Ordering
Dynamic application form renderer, file upload to S3 (pre-signed URLs), cart/checkout, coupons at checkout, Razorpay payments with verified webhooks, GST invoice PDFs. The "Continue to your details" button on the order summary page is where this connects.
