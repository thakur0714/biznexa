# WCAG 2.1 AA Accessibility Audit

**Audit Date**: October 19, 2026
**Auditor**: Automated Agentic Accessibility Audit (Chromium & Axe-Core 4.10.2 + Interactive Keyboard Evaluation)
**Standard**: WCAG 2.1 Level AA
**Scope**: Public Web (`apps/web` on `:3000`), Customer Portal (`/dashboard/*`), Buy Flow (`/apply/*`), Blog (`/blog/*`), Consultants (`/consultants/*`), and Admin Portal (`apps/admin` on `:3001`).
**Viewports Tested**: Desktop (1280×800) and Mobile (360×740).
**Test Method**: Full keyboard-only walkthrough (Tab, Shift+Tab, Enter, Space, Escape, Arrow keys), automated Axe-Core 2.1 AA test engine, color contrast mathematics, screen reader accessibility tree & ARIA semantics inspection.

---

## Executive Summary

BizNexa demonstrates several strong accessibility foundations: semantic `<dialog>` usage with `showModal()`, `aria-invalid` and `aria-describedby` wiring on standard form controls, explicit heading structures across most pages, and clean text alternative attributes on logos and general illustrations.

However, several **Blocker** and **High** severity issues prevent the platform from conforming to WCAG 2.1 Level AA:
1. **Critical ARIA Malformation in Customer Notifications**: `role="feed"` directly contains `<button>` elements instead of `role="article"`, breaking assistive technology virtual navigation.
2. **Missing Accessible Labels in Admin Applications Management**: Checkboxes (select-all and row selection) and bulk assignment `<select>` elements completely lack labels or `aria-label` attributes.
3. **Non-Compliant Focus Ring Contrast Across All Apps**: The global `:focus-visible` outline uses `--color-marigold` (`#f4b000`), which achieves only **1.90:1** contrast on white backgrounds and **1.77:1** on paper backgrounds (violating the 3.0:1 threshold of WCAG 1.4.11 Non-text Contrast).
4. **Header Navigation Dropdown & Mobile Menu Keyboard Traps**: Opening the "Services" dropdown on desktop places focus in a disconnected order (Tab skips past the menu). On mobile (360px), the hamburger menu cannot be dismissed with the `Escape` key.
5. **Sidebar Drawers (Admin & Customer Mobile)**: Mobile navigation drawers do not trap focus, causing keyboard users to tab into underlying content beneath backdrops.
6. **Badge & Token Contrast Failures**: Warning badges (`bg-amber-050 text-amber`) and success badges (`bg-seal-050 text-seal`) provide only ~3.88:1 contrast for small text (violating the 4.5:1 threshold of WCAG 1.4.3).

---

## Severity Classification

| Severity | Definition | Action Required |
|---|---|---|
| **Blocker** | Completely halts keyboard or screen reader users from completing primary tasks, or severely violates ARIA specifications in a way that crashes/breaks assistive tech navigation. | Must fix before deployment. |
| **High** | Major barrier that forces difficult workarounds, violates Level A/AA contrast thresholds, or omits critical accessibility landmarks/skip links. | High priority remediation. |
| **Medium** | Meaningful usability friction for keyboard or screen reader users (e.g. heading hierarchy skips, unannounced dynamic validation, scrollable table focus). | Should fix in current milestone. |
| **Low** | Minor standard deviations, polish improvements, or best-practice enhancements. | Fix when touching component. |

---

## Detailed Findings

### Issue A11Y-01: Critical ARIA Feed Structure in Customer Notifications
- **Severity**: **Blocker**
- **WCAG Success Criteria**: 4.1.2 Name, Role, Value (Level A), 1.3.1 Info and Relationships (Level A)
- **Affected Page**: `/dashboard/notifications` (`apps/web/src/app/dashboard/notifications/notifications-view.tsx:168`)
- **Description**: The notifications container is given `role="feed"` with `aria-label="Notifications list"`. Under the W3C WAI-ARIA 1.2 specification, `feed` elements must strictly contain `article` elements (`role="article"`). In this view, `role="feed"` directly contains `<button>` interactive elements. This causes screen readers (VoiceOver, NVDA, JAWS) to misreport feed entry counts and break page reading modes.
- **Steps to Reproduce**:
  1. Start API and Web servers.
  2. Navigate to `http://localhost:3000/login` and log in as `customer@biznexa.local` / `Customer@12345`.
  3. Navigate to `http://localhost:3000/dashboard/notifications`.
  4. Inspect the DOM container `<div class="space-y-3" role="feed" aria-label="Notifications list">`.
  5. Observe that each notification item is rendered as a `<button>` without a wrapping or applied `role="article"`.
- **Suggested Fix**: Either change `role="feed"` to an unordered list `<ul role="list">` with `<li>` children containing the buttons, or wrap each notification button in `<article aria-labelledby="...">` (or add `role="article"` to the item container).

---

### Issue A11Y-02: Missing Form Labels on Checkboxes & Bulk Select in Admin Applications
- **Severity**: **Blocker**
- **WCAG Success Criteria**: 1.3.1 Info and Relationships (Level A), 4.1.2 Name, Role, Value (Level A), 3.3.2 Labels or Instructions (Level A)
- **Affected Page**: Admin Applications list (`/applications` on `http://localhost:3001/applications`, `apps/admin/src/app/(portal)/applications/applications-view.tsx:157, 173, 191`)
- **Description**:
  1. The header table cell checkbox `<input type="checkbox">` used to select all applications has no `<label>`, `aria-label`, or `title`.
  2. Every row checkbox `<input type="checkbox">` for selecting individual applications has no label or `aria-label`.
  3. The bulk assignment dropdown `<select class="border border-rule rounded p-2 text-sm">` has no `<label>` or `aria-label`.
  Screen readers announce these controls as "Checkbox, unchecked" or "Select, unassigned" with zero context on what application is being selected or what the select action performs.
- **Steps to Reproduce**:
  1. Navigate to `http://localhost:3001/login` and log in as `admin@biznexa.local` / `Admin@12345`. Complete 2FA.
  2. Navigate to `http://localhost:3001/applications`.
  3. Inspect the table header and body checkboxes, and the bulk assignment dropdown.
  4. Run Axe or a screen reader; observe critical `label` and `select-name` violations.
- **Suggested Fix**:
  - Add `aria-label="Select all applications"` to the header checkbox.
  - Add `aria-label={`Select application ${app.code}`}` to each row checkbox.
  - Add `aria-label="Assign selected applications to staff member"` or a visible `<label htmlFor="bulk-assignee">` to the bulk select dropdown.

---

### Issue A11Y-03: Focus Visible Indicator Fails Non-Text Contrast (1.90:1 vs 3.0:1 required)
- **Severity**: **High**
- **WCAG Success Criteria**: 1.4.11 Non-text Contrast (Level AA), 2.4.7 Focus Visible (Level AA)
- **Affected Pages**: Global across `apps/web` (`globals.css:26-30`) and `apps/admin` (`globals.css:24-28`)
- **Description**: The global stylesheet defines focus styling as:
  ```css
  :focus-visible {
    outline: 3px solid var(--color-marigold);
    outline-offset: 2px;
    border-radius: 4px;
  }
  ```
  `--color-marigold` is `#f4b000`. When rendered on white (`#ffffff`), the contrast ratio is **1.90:1**. When rendered on the paper background (`#f6f7fb`), the contrast ratio is **1.77:1**. Both fall far short of the WCAG 1.4.11 requirement of **3.0:1** for user interface state indicators. As a result, users with low vision cannot reliably see where keyboard focus is located.
- **Steps to Reproduce**:
  1. Open `http://localhost:3000/` or `http://localhost:3001/`.
  2. Press `Tab` repeatedly to move focus through links and buttons.
  3. Measure the color contrast between the yellow focus ring `#f4b000` and the white `#ffffff` or light-gray `#f6f7fb` background using a color contrast analyzer.
  4. Observe contrast is 1.90:1 (Fails 3.0:1).
- **Suggested Fix**: Change the focus outline color on light backgrounds to a high-contrast color like `--color-ink` (`#1f2b7a`, contrast 12.3:1) or add a dual outline (e.g., `outline: 2px solid #1f2b7a; outline-offset: 2px; box-shadow: 0 0 0 4px #ffffff;`).

---

### Issue A11Y-04: Mobile Hamburger Menu Cannot Be Closed with Escape Key (360px)
- **Severity**: **High**
- **WCAG Success Criteria**: 2.1.1 Keyboard (Level A), 2.1.2 No Keyboard Trap (Level A)
- **Affected Page**: Global website header on viewports < 1024px (`apps/web/src/components/site-header.tsx:36-47`)
- **Description**: At 360px mobile width, the navigation is toggled via the hamburger button. In `site-header.tsx`, the `useEffect` listening for the `Escape` key only checks `menuOpen` (the desktop services dropdown) and calls `setMenuOpen(false)`. It ignores `mobileOpen`. When a mobile keyboard user opens the menu, pressing `Escape` does nothing, forcing the user to tab through all categories and navigation items just to reach the close toggle.
- **Steps to Reproduce**:
  1. Open `http://localhost:3000/` in a 360px viewport width (e.g. mobile emulation).
  2. Tab to the menu button ("Open menu") and press `Enter` to expand the mobile drawer.
  3. Press the `Escape` key.
  4. Notice the mobile drawer remains open.
- **Suggested Fix**: Update the `keydown` listener in `site-header.tsx` to handle `mobileOpen`:
  ```ts
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      setMenuOpen(false);
      setMobileOpen(false);
    }
  };
  ```

---

### Issue A11Y-05: Desktop "Services" Dropdown Focus Order Skips Dropdown Content
- **Severity**: **High**
- **WCAG Success Criteria**: 2.4.3 Focus Order (Level A)
- **Affected Page**: Global website header (`apps/web/src/components/site-header.tsx:83-141`)
- **Description**: On desktop, activating the "Services" button opens the mega-menu `#services-menu`. In the DOM tree, `#services-menu` is located *after* the navigation links (`/consultants`, `/blog`, `/verify`, `/about`, `/contact`) and *after* the user account/auth buttons. When a user presses `Enter` on "Services" and then presses `Tab` expecting to enter the opened menu, focus moves to the next link in `<nav>` ("Consultations"), skipping all service links in the opened dropdown.
- **Steps to Reproduce**:
  1. Open `http://localhost:3000/` at 1280px desktop width.
  2. Tab to the "Services" button in the header.
  3. Press `Enter` to open the dropdown menu.
  4. Press `Tab`.
  5. Notice the active focused element is "Consultations" (`href="/consultants"`), not the first category or service link in the dropdown.
- **Suggested Fix**: Move `#services-menu` in the DOM so it immediately follows the Services button or `<nav>`, or programmatically shift focus to the first interactive element inside `#services-menu` upon opening, and return focus to the Services button upon closing.

---

### Issue A11Y-06: Mobile Sidebar Drawers Lack Focus Trapping (Admin & Customer Portals)
- **Severity**: **High**
- **WCAG Success Criteria**: 2.4.3 Focus Order (Level A), 2.1.2 No Keyboard Trap (Level A)
- **Affected Pages**:
  - Customer Portal: `http://localhost:3000/dashboard/*` (`apps/web/src/app/dashboard/layout.tsx:104-144`)
  - Admin Portal: `http://localhost:3001/*` (`apps/admin/src/components/portal-shell.tsx:58-83`)
- **Description**: On 360px mobile viewports, both the customer dashboard and admin portal feature a slide-in sidebar navigation drawer overlaying a darkened backdrop (`bg-night/40`). When the drawer opens:
  1. Focus is not moved into the drawer.
  2. Focus is not trapped inside the drawer. Pressing `Tab` cycles past the drawer items and tabs directly into interactive elements on the main page *underneath* the backdrop overlay.
  3. In the admin portal, the `Escape` key listener is attached to `<aside id="admin-sidebar">`. Because focus remains on the "Close" button outside the `aside`, pressing `Escape` does not dismiss the drawer.
- **Steps to Reproduce**:
  1. Open `http://localhost:3000/dashboard` or `http://localhost:3001/` on a 360px mobile viewport.
  2. Activate the "Menu" drawer button.
  3. Press `Tab` repeatedly.
  4. Notice focus disappears behind the drawer and interacts with background buttons/cards on the dashboard.
- **Suggested Fix**: Wrap drawer navigation in an accessible dialog pattern or use focus-trap utilities (trap Tab cycles within the drawer, set `aria-modal="true"` and `role="dialog"`, move focus to first nav item on open, and restore focus to trigger button on close).

---

### Issue A11Y-07: Insufficient Color Contrast on Warning & Success Badges
- **Severity**: **High**
- **WCAG Success Criteria**: 1.4.3 Contrast (Minimum) (Level AA)
- **Affected Pages**:
  - Homepage (`/`)
  - Service detail pages (`/services/*`)
  - Buy flow documents step (`/apply/*/*/documents`)
  - Customer Dashboard (`/dashboard`, `/dashboard/support`, `/dashboard/profile`)
  - Admin Portal (`/applications`, `/customers`, `/consultants`, etc.)
- **Description**:
  1. Warning badges and priority tags use `bg-amber-050 text-amber` (`#b26a00` foreground on `#fff4dc` background). Measured contrast ratio is **3.88:1**.
  2. Success badges use `bg-seal-050 text-seal` (`#0e8a5f` foreground on `#e6f5ee` background). Measured contrast ratio is **3.87:1**.
  Because these badges use small text (12px / `text-xs`), WCAG 1.4.3 requires a minimum contrast ratio of **4.5:1**. Both fail Level AA.
- **Steps to Reproduce**:
  1. Open `http://localhost:3000/apply/gst-registration/<id>/documents`.
  2. Inspect the "Required" pill badge next to each required document.
  3. Evaluate the foreground `#b26a00` on `#fff4dc`: contrast is 3.88:1.
  4. Open `http://localhost:3000/dashboard/support`. Inspect ticket priority badges ("High"). Contrast is 3.88:1.
- **Suggested Fix**: Darken `--color-amber` from `#b26a00` to `#8f5300` (contrast 5.3:1) and darken `--color-seal` from `#0e8a5f` to `#0a6847` (contrast 4.8:1) in `packages/config/tokens.css`.

---

### Issue A11Y-08: Admin Portal Layout Lacks "Skip to Content" Link
- **Severity**: **High**
- **WCAG Success Criteria**: 2.4.1 Bypass Blocks (Level A)
- **Affected Page**: Entire Admin Portal (`apps/admin/src/app/layout.tsx`)
- **Description**: While `apps/web/src/app/layout.tsx` includes `<a href="#main" className="sr-only focus:not-sr-only ...">Skip to content</a>`, `apps/admin/src/app/layout.tsx` has no skip link. Admin users navigating with keyboard or switch devices must tab through the entire sidebar navigation (up to 25 links) on every page reload to reach the main work area.
- **Steps to Reproduce**:
  1. Open `http://localhost:3001/` while logged in.
  2. Reload the page and press `Tab`.
  3. Notice focus lands on the logo or first sidebar item, with no skip link available.
- **Suggested Fix**: Add the skip-to-content link into `apps/admin/src/app/layout.tsx`:
  ```tsx
  <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-white focus:px-4 focus:py-2">
    Skip to main content
  </a>
  ```

---

### Issue A11Y-09: Form Controls Strip Outline Without Replacement Focus Indicator
- **Severity**: **High**
- **WCAG Success Criteria**: 2.4.7 Focus Visible (Level AA)
- **Affected Pages**: All forms across Web and Admin (`packages/ui/src/field.tsx:3`, `apps/web/src/components/service-card.tsx:18`)
- **Description**:
  1. In `packages/ui/src/field.tsx`, the base control class is defined as:
     `const control = '... outline-none transition-colors focus:border-ink';`
     `outline-none` removes the browser default focus outline. The only visual change on focus is `border-ink` (`#1f2b7a`), without any focus ring, shadow, or offset. For users with high-resolution screens or motor impairments, a 1px border change is subtle and often imperceptible.
  2. In `apps/web/src/components/service-card.tsx:18`, the main card link specifies `focus-visible:outline-none group-focus-within:underline`. The outline is explicitly suppressed, giving keyboard users only an underline on the title.
- **Steps to Reproduce**:
  1. Open `http://localhost:3000/login` or `/register`.
  2. Tab into the email and password input fields.
  3. Observe that there is no outer focus ring or outline, only a 1px border color transition.
  4. Tab into a service card on `http://localhost:3000/services`. Notice the card itself displays no focus outline.
- **Suggested Fix**: Add `focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2` to `control` in `field.tsx` and ensure card links keep a visible 2px focus ring around the card container.

---

### Issue A11Y-10: Prohibited ARIA Attribute on Consultant Booking Skeleton Loader
- **Severity**: **High**
- **WCAG Success Criteria**: 4.1.2 Name, Role, Value (Level A)
- **Affected Page**: `/consultants/[slug]/book` (`apps/web/src/app/consultants/[slug]/book/page.tsx`)
- **Description**: During the initial load of consultant booking, the skeleton placeholder is rendered as:
  `<div class="... animate-pulse" aria-label="Loading consultants">`
  According to W3C ARIA in HTML rules, generic `<div>` elements without an explicit ARIA role cannot possess an `aria-label`. Assistive technologies ignore `aria-label` on non-landmark, generic elements, meaning screen reader users are not informed of the loading state.
- **Steps to Reproduce**:
  1. Open `http://localhost:3000/consultants/e2e-avail-15c099a4-main/book`.
  2. Run Axe or inspect the DOM during render.
  3. Observe Axe violation `aria-prohibited-attr`.
- **Suggested Fix**: Add `role="status"` and `aria-live="polite"` to the container:
  ```tsx
  <div role="status" aria-live="polite" className="... animate-pulse">
    <span className="sr-only">Loading consultant booking details...</span>
  </div>
  ```

---

### Issue A11Y-11: Mobile Horizontal Scrollable Tables Not Keyboard Accessible (360px)
- **Severity**: **Medium**
- **WCAG Success Criteria**: 2.1.1 Keyboard (Level A)
- **Affected Pages**:
  - Service detail package comparison: `/services/tax-gst/gst-registration`
  - Admin Dashboard Overview tables: `http://localhost:3001/`
  - Buy flow details tables
- **Description**: On 360px mobile viewports, tables and package comparison matrices are wrapped in `<div class="overflow-x-auto ...">`. When the table width exceeds 360px, horizontal scrollbars appear. Because the container lacks `tabindex="0"`, keyboard-only users navigating on mobile or with external keyboards cannot focus the container to scroll horizontally using arrow keys. Content on the right side of the table remains unreachable.
- **Steps to Reproduce**:
  1. Open `http://localhost:3000/services/tax-gst/gst-registration` in a 360px mobile viewport.
  2. Tab down to the package table.
  3. Try scrolling horizontally using keyboard Left/Right arrow keys.
  4. Notice the container cannot be focused; table content extends off-screen and cannot be brought into view.
- **Suggested Fix**: Add `tabindex="0"`, `role="region"`, and an accessible label to scrollable wrappers:
  ```tsx
  <div tabIndex={0} role="region" aria-label="Package comparison table" className="overflow-x-auto ...">
  ```

---

### Issue A11Y-12: Heading Hierarchy Level Skips (h1 to h3)
- **Severity**: **Medium**
- **WCAG Success Criteria**: 1.3.1 Info and Relationships (Level A), 2.4.6 Headings and Labels (Level AA)
- **Affected Pages**:
  - `/services` (Catalogue overview)
  - `/services/tax-gst` (Category listings)
  - `/apply/*/*/documents` (Documents upload step)
  - `/dashboard/support` (Support tickets listing)
- **Description**:
  1. On `/services` and `/services/[category]`, the page title is an `<h1>`. The grid of service cards (`service-card.tsx`) uses `<h3>` for each service name, skipping `<h2>` entirely.
  2. On `/dashboard/support`, the page title is an `<h1>`, and ticket cards use `<h3>`, skipping `<h2>`.
  3. On `/apply/[service]/[id]/documents`, document titles use `<h3>` directly beneath the `<h1>`.
  Screen reader users who navigate by heading level (pressing '2' in JAWS/NVDA) will hear "No heading at level 2", mistakenly believing there are no major sections.
- **Steps to Reproduce**:
  1. Open `http://localhost:3000/services`.
  2. Use a screen reader heading list rotor (VoiceOver `VO+U` -> Headings).
  3. Observe heading sequence jumps from `h1` ("All Services") directly to `h3` ("Private Limited Company").
- **Suggested Fix**:
  - Change category subheadings or section headers to `<h2>`, or change service card titles to `<h2>` when presented as the direct child section of `<h1>`.

---

### Issue A11Y-13: Form Placeholder Text Fails Contrast Threshold (3.29:1 vs 4.5:1)
- **Severity**: **Medium**
- **WCAG Success Criteria**: 1.4.3 Contrast (Minimum) (Level AA)
- **Affected Pages**: All input fields across Web and Admin (`packages/ui/src/field.tsx:43`)
- **Description**: Input placeholders use `placeholder:text-muted/70`. `--color-muted` is `#545c80`. At 70% opacity over `#ffffff`, the effective rendered color is `#878da6`, producing a contrast ratio of **3.29:1** against white and **3.15:1** against `#f6f7fb`. While placeholders are supplementary, when used as hints or example formats (e.g. `123456`, `john@example.com`), low-vision users cannot read them.
- **Steps to Reproduce**:
  1. Open `http://localhost:3000/login` or `/register`.
  2. Inspect the placeholder color in computed CSS styles.
  3. Measure contrast: 3.29:1 (Fails 4.5:1 for standard text).
- **Suggested Fix**: Change `placeholder:text-muted/70` to `placeholder:text-muted` without opacity reduction (`#545c80` on `#ffffff` has 6.52:1 contrast, passing comfortably).

---

### Issue A11Y-14: Incomplete WAI-ARIA Pattern on Customer Login Tabs
- **Severity**: **Medium**
- **WCAG Success Criteria**: 4.1.2 Name, Role, Value (Level A), 2.1.1 Keyboard (Level A)
- **Affected Page**: `/login` (`apps/web/src/app/login/login-form.tsx:88-91`)
- **Description**: The customer login page switches between "Email & password" and "Mobile OTP" using `role="tablist"` and `role="tab"`. However:
  1. The tabs do not possess `aria-controls` referencing their respective panel IDs.
  2. The panels do not have `role="tabpanel"` or `aria-labelledby`.
  3. Arrow keys (Left/Right) do not switch between tabs (standard ARIA tablist behavior); tabs are only switched via mouse click or Tab+Enter.
- **Steps to Reproduce**:
  1. Open `http://localhost:3000/login`.
  2. Focus the "Email & password" tab.
  3. Press the `Right Arrow` key.
  4. Notice focus does not move to the "Mobile OTP" tab.
- **Suggested Fix**: Add `aria-controls="panel-password"`, `role="tabpanel"` on the form wrapper, and add an `onKeyDown` handler allowing ArrowLeft/ArrowRight to switch tabs.

---

### Issue A11Y-15: Dynamic Validation Errors Not Announced via Live Region
- **Severity**: **Medium**
- **WCAG Success Criteria**: 4.1.3 Status Messages (Level AA), 3.3.1 Error Identification (Level A)
- **Affected Pages**: Application dynamic form (`/apply/[service]/[id]`), Login (`/login`), Register (`/register`)
- **Description**: When a user submits an incomplete form, field error messages (`<p id="{id}-err" class="text-danger">{error}</p>`) are injected under invalid fields. While `aria-describedby` correctly points to the error message when the field is focused, there is no `role="alert"` or top-level `aria-live="polite"` summary to announce that errors occurred on submit. A blind user pressing "Submit" receives no immediate auditory feedback that the submission failed.
- **Steps to Reproduce**:
  1. Open `http://localhost:3000/apply/gst-registration/<id>`.
  2. Leave required fields blank and click "Next step".
  3. Screen reader remains silent because focus stays on the button and error containers lack `role="alert"`.
- **Suggested Fix**: Provide a top-level validation error banner with `role="alert"` (or focus the first invalid field upon form submission failure) and add `aria-live="polite"` to dynamic Notice components.

---

### Issue A11Y-16: Search Combobox Listbox Option Nests Interactive Link
- **Severity**: **Low**
- **WCAG Success Criteria**: 4.1.2 Name, Role, Value (Level A)
- **Affected Page**: Homepage (`apps/web/src/components/search-box.tsx:123`)
- **Description**: In the homepage search combobox dropdown, items are rendered as:
  `<li id="..." role="option" aria-selected="..."><a href="...">...</a></li>`.
  According to WAI-ARIA combobox 1.2 design patterns, `role="option"` elements should not contain focusable interactive elements like `<a>`. Selection should be driven by the combobox `aria-activedescendant` and Enter key.
- **Steps to Reproduce**:
  1. Type "trademark" into the homepage search input.
  2. Inspect the resulting dropdown options in DevTools.
  3. Notice `<a>` tags nested directly inside `li[role="option"]`.
- **Suggested Fix**: Remove the `<a>` element from inside `li[role="option"]`, handle navigation via the combobox `submit` / `Enter` handler, and retain the `<a>` styling on the `<li>`.

---

### Issue A11Y-17: Generic `alt=""` on Informational Article Images
- **Severity**: **Low**
- **WCAG Success Criteria**: 1.1.1 Non-text Content (Level A)
- **Affected Page**: `/blog/[slug]` (`apps/web/src/app/blog/[slug]/page.tsx:48`)
- **Description**: Blog article featured images are rendered with hardcoded `alt=""`:
  `{post.featuredImage && <img src={post.featuredImage} alt="" ... />}`.
  While decorative images should use `alt=""`, featured images on articles frequently communicate context or charts.
- **Steps to Reproduce**:
  1. View a published blog post page with a featured image.
  2. Inspect the `<img>` element.
  3. Observe `alt=""` regardless of whether image alt text exists in the CMS post data.
- **Suggested Fix**: Allow the CMS editor to provide custom alt text and render `alt={post.featuredImageAlt || ''}`.

---

## Page-by-Page Audit Matrix

| Page / Flow | Viewport | Automated Status | Keyboard Walkthrough | Main Issues |
|---|---|---|---|---|
| **Homepage** (`/`) | Desktop + 360px | 1 Serious | Passable | Badge contrast (3.88:1), Yellow focus ring contrast (1.9:1), Combobox nested `<a>` |
| **All Services** (`/services`) | Desktop + 360px | Clean | Passable | Heading level skip (`h1` -> `h3`), Card link suppresses focus outline |
| **Service Category** (`/services/[category]`) | Desktop + 360px | Clean | Passable | Heading level skip (`h1` -> `h3`), Badge contrast |
| **Service Detail** (`/services/*/*`) | Desktop + 360px | 1 Serious (Mobile) | Issues on mobile | Table overflow not keyboard focusable on 360px, Yellow focus ring |
| **Buy Flow: Apply Summary** (`/apply/[service]`) | Desktop + 360px | Clean | Good | Business picker focus visible |
| **Buy Flow: Details Form** (`/apply/*/[id]`) | Desktop + 360px | Clean | Good | Dynamic errors unannounced, `outline-none` on inputs |
| **Buy Flow: Documents Step** (`/apply/*/*/documents`) | Desktop + 360px | 1 Serious | Issues on mobile | "Required" badge contrast (3.88:1), Heading level skip (`h1` -> `h3`) |
| **Buy Flow: Summary Step** (`/apply/*/*/summary`) | Desktop + 360px | Clean | Good | Coupon input focus visible |
| **Buy Flow: Payment Step** (`/apply/*/*/payment`) | Desktop + 360px | Clean | Good | Mock payment button accessible |
| **Customer Dashboard** (`/dashboard`) | Desktop + 360px | 1 Serious | Issues on mobile | Badge contrast (3.88:1), Mobile drawer no focus trap |
| **Customer Notifications** (`/dashboard/notifications`) | Desktop + 360px | 1 Critical | Broken | **Critical**: `role="feed"` with non-article children (`<button>`) |
| **Customer Documents** (`/dashboard/documents`) | Desktop + 360px | Clean | Good | Table status pills contrast |
| **Customer Support** (`/dashboard/support`) | Desktop + 360px | 1 Serious | Passable | Priority badge contrast (3.88:1), Heading level skip |
| **Customer Profile & Privacy** (`/dashboard/*`) | Desktop + 360px | 1 Serious | Good | Badge contrast, Dialog close button in footer only |
| **Consultants Directory** (`/consultants`) | Desktop + 360px | Clean | Good | Filter controls focus order |
| **Consultant Booking** (`/consultants/[slug]/book`) | Desktop + 360px | 1 Serious | Good | Prohibited `aria-label` on generic loading `<div>` |
| **Blog Index & Post** (`/blog`, `/blog/[slug]`) | Desktop + 360px | Clean | Good | Featured image hardcoded `alt=""`, Card wraps entire block |
| **Verify Certificate** (`/verify`) | Desktop + 360px | Clean | Good | QR scanner camera fallback accessible |
| **Customer Login / Register** (`/login`, `/register`) | Desktop + 360px | Clean | Good | Tablist missing `aria-controls` / arrow key navigation |
| **Admin Login & 2FA** (`:3001/login`, `:3001/two-factor`) | Desktop + 360px | Clean | Good | Setup key readable, Switch account button lacks focus outline |
| **Admin Dashboard Overview** (`:3001/`) | Desktop + 360px | 2 Serious | Issues on mobile | Stat badge contrast, Mobile table overflow not focusable, No skip link |
| **Admin Applications** (`:3001/applications`) | Desktop + 360px | 2 Critical | Broken | **Critical**: Table select-all & row checkboxes missing labels, Bulk select missing label |
| **Admin All Other Pages** (34 portal routes) | Desktop + 360px | Clean / Contrast | Issues on mobile | Mobile drawer no focus trap / escape fail, No skip link |

---

## Summary of WCAG Success Criteria Failures

1. **SC 1.3.1 Info and Relationships (Level A)**:
   - Checkboxes in Admin Applications table lack associated labels.
   - Heading level skips (`h1` to `h3`) on catalogue and support pages.
2. **SC 1.4.3 Contrast (Minimum) (Level AA)**:
   - Amber warning badges (`#b26a00` on `#fff4dc`) fail with 3.88:1.
   - Seal success badges (`#0e8a5f` on `#e6f5ee`) fail with 3.87:1.
   - Input placeholder text with 70% opacity fails with 3.29:1.
3. **SC 1.4.11 Non-text Contrast (Level AA)**:
   - Global `:focus-visible` outline in `--color-marigold` (`#f4b000`) fails with 1.90:1 on white and 1.77:1 on paper background.
4. **SC 2.1.1 Keyboard (Level A)**:
   - Mobile hamburger menu cannot be closed with Escape key.
   - Scrollable tables on mobile viewports cannot be focused for arrow-key horizontal scrolling.
5. **SC 2.4.1 Bypass Blocks (Level A)**:
   - Admin Portal completely lacks a "Skip to Content" link.
6. **SC 2.4.3 Focus Order (Level A)**:
   - Services mega-menu is placed after navigation links in DOM, skipping dropdown links when tabbing.
   - Mobile drawers on customer dashboard and admin portal allow focus to bleed into background elements.
7. **SC 2.4.7 Focus Visible (Level AA)**:
   - Focus outline removed via `outline-none` on standard inputs and service card links.
8. **SC 4.1.2 Name, Role, Value (Level A)**:
   - Customer notifications `role="feed"` directly contains `<button>` elements instead of `role="article"`.
   - Admin table checkboxes and bulk select dropdown have no accessible name.
   - Generic loading `<div>` uses prohibited `aria-label`.
