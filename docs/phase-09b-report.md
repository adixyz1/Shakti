# Phase 9B Report: Accessibility Checks (WCAG 2.2 AA) & Product Rename to SHAKTI

## 1. Automated Accessibility Checks (`axe-core` WCAG 2.2 AA)

Added `axe-core` automated accessibility verification in `apps/web/src/tests/phase9b_accessibility.test.tsx` (`runSeriousAxeCheck` running tags `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`, `wcag22aa`). Every required screen was tested in both **English (`en`)** and **Hindi (`hi`)** with **0 serious or critical violations**:

1. **Home / SOS Ready** (`/home` — EN & HI)
2. **Cancel Window with On-Screen PIN Keypad** (`/home` with `TRIGGERED` incident & PIN keypad open — EN & HI)
3. **Live Status Screen** (`/home` with `NOTIFIED` active incident — EN & HI)
4. **Consent Center** (`/consents` — EN & HI)
5. **Trusted Circle** (`/circle` — EN & HI)
6. **Contact Alert Page** (`/c/:token` — EN & HI)
7. **Responder Dashboard** (`/responder` — EN & HI)
8. **Admin Analytics** (`/admin` — EN & HI)
9. **Safe Journeys (`Walk with me`)** (`/journeys` — EN & HI)
10. **Community Safety Reports & Layer** (`/reports` — EN & HI)
11. **Verified Helplines & Support Resources** (`/resources` — EN & HI)
12. **Emergency Data Policy** (`/policy` — EN & HI)
13. **Settings & Privacy Controls** (`/settings` — EN & HI)

*Note on browser / Lighthouse checks:* Real-browser and Lighthouse accessibility audits were **NOT** run here because no headless Chromium / real browser is available in this test environment; all checks were executed via `axe-core` in Vitest (`jsdom`). Furthermore, `axe-core` in `jsdom` cannot verify color contrast, so contrast must be checked in a real browser (Phase 9C adds an `axe` check inside Playwright and Lighthouse commands).

### Accessibility & Contrast Fixes Applied
- **Skip-to-main-content link & `<main id="main-content">` landmark (`apps/web/src/components/PageLayout.tsx`)**: Added a keyboard-focusable skip link (`a[href="#main-content"]`) at the top of every page and `id="main-content" tabIndex={-1}` on `<main>` so keyboard and screen-reader users can bypass the header navigation immediately.
- **Distinct navigation landmark labels (`apps/web/src/components/PageLayout.tsx`, `apps/web/src/components/ui/index.tsx`)**: Added `aria-label="Primary navigation"` to the top desktop `<nav>` to distinguish it from `aria-label="Mobile bottom navigation"`.
- **Contrast improvements (`apps/web/src/components/PageLayout.tsx`)**: Upgraded top navigation text from `text-slate-600 dark:text-slate-300` to `text-slate-700 dark:text-slate-200` and footer disclaimer text from `text-slate-500 dark:text-slate-400` to `text-slate-600 dark:text-slate-300` to ensure >= 4.5:1 WCAG AA contrast ratio on `bg-slate-50` and `dark:bg-slate-950`.
- **Button `fullWidth` prop (`apps/web/src/components/ui/index.tsx`)**: Explicitly handled `fullWidth` on `Button` so it applies `w-full` without leaking an invalid DOM attribute onto `<button>`.

---

## 2. Keyboard Operability, Reduced Motion & 200% Text / Hindi Layout Resilience

- **Keyboard operability & visible focus**: Every interactive control (`Button`, `BigButton`, `Input`, `SOS` hold button, PIN keypad buttons, calculator keys, navigation links) uses native `<button>`, `<a>`, or `<input>` elements with visible `focus-visible:ring-2` / `focus-visible:ring-4` outlines. The SOS hold button supports holding `Space` or `Enter` to initiate an alert and `Escape` to cancel.
- **Reduced motion & Data-Saver (`src/index.css`, `apps/web/src/App.tsx`)**:
  - Added global `@media (prefers-reduced-motion: reduce)` CSS rules and `html[data-saver="true"]` rules that reduce animation and transition durations to `0.01ms !important`.
  - Synced `useTriggerSettingsStore.lowPowerDataSaverMode` to `document.documentElement.setAttribute('data-saver', 'true')` in `App.tsx`, alongside existing `motion-reduce:transition-none` and conditional SVG progress-ring suppression in `HomePage.tsx`.
- **200% text size & Hindi text wrapping (`src/index.css`)**: Added `break-words` and `overflow-wrap: anywhere` on `body` so long Devanagari (Hindi) strings and 200% zoomed layouts wrap cleanly without horizontal clipping.

---

## 3. User-Visible Rename from SAATHI to SHAKTI

- Updated `app.name` to `"SHAKTI"` in both `apps/web/src/i18n/en.json` and `apps/web/src/i18n/hi.json`, and replaced all user-visible occurrences of `"SAATHI"` / `"साथी"` across English and Hindi translation strings.
- Updated `<title>` and `og:title` in `index.html` to `"SHAKTI — Safety Assistance & Alert Technology"`.
- Updated `name` and `short_name` in `public/manifest.webmanifest` to `"SHAKTI — Safety Assistance & Alert Technology"` and `"SHAKTI"`.
- Updated `DEFAULT_TITLE` in `apps/web/src/components/DiscreetTriggersManager.tsx`, emergency SMS fallback copy in `apps/web/src/lib/offlineQueue.ts`, SMS/push notification copy in `apps/api/src/services/contactService.ts` and `apps/api/src/services/notificationDispatcher.ts`, `README.md`, and `docs/DEMO_SCRIPT.md`.
- Added automated test #3 in `apps/web/src/tests/phase9b_accessibility.test.tsx` scanning `en.json` and `hi.json` to ensure zero occurrences of `"SAATHI"` or `"साथी"`.

### Internal Identifiers Intentionally NOT Renamed (to avoid orphaning existing user data/sessions)
- **HTTP-Only Auth Cookies**: `saathi_access_token`, `saathi_refresh_token` (`apps/api/src/core/security.ts`)
- **IndexedDB Database Name**: `saathi_offline_db` (`apps/web/src/lib/offlineQueue.ts`)
- **Browser `localStorage` / `sessionStorage` Keys**:
  - `saathi_lang` (language preference)
  - `saathi_theme` (light/dark mode preference)
  - `saathi_trigger_settings_v1` (discreet trigger & disguise hash settings)
  - `saathi_pulse_dismissed_at` (weekly safety pulse dismissal timestamp)
- **Service Worker Runtime Cache Name**: `saathi-static-assets-cache-first` (`vite.config.ts`)
- **Environment Variable / Default Dev Secret Fallbacks**: `SAATHI_PORT`, `SAATHI_DB_PATH`, `saathi-dev-jwt-secret-do-not-use-in-prod`
- **Voice Trigger Codeword**: Default codeword removed; requires user-configured codeword (min 6 chars + confirm entry) stored only as a salted PBKDF2-SHA256 hash (`voiceCodewordHash`) in `triggerSettingsStore.ts`

---

## 4. Disguise Mode Check

- When calculator disguise mode is active (`disguiseEnabled && !disguiseUnlockedSession`), `DiscreetTriggersManager` sets `document.title = 'Calculator'`, swaps `<link rel="icon">` to the neutral calculator SVG data URI, swaps `<link rel="manifest">` to an inline manifest with `name: "Calculator"` and `short_name: "Calculator"`, and `HomePage` renders only `<DisguiseCalculator />` with zero mentions of `SHAKTI` or `SAATHI`.
- Verified by Test #4 in `apps/web/src/tests/phase9b_accessibility.test.tsx`.

---

## 5. What the Next Phase (9C / 9D) Can Rely On

- All 12+ user, contact, responder, admin, and public policy screens pass automated `axe-core` WCAG 2.2 AA checks in both English and Hindi.
- All user-visible strings, titles, manifest metadata, and notification templates use **SHAKTI**, while internal storage/cookie identifiers remain stable.
