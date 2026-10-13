# Phase 7B Report — Community Safety Reports, K-Anonymized Aggregated Safety Layer & Phase 7A Follow-Ups

## 1. What Was Built

### Phase 7A Follow-Ups
1. **Follow-up 1 (No-Contact Selected Calm Note)**:
   - On the Safe Journey start screen (`apps/web/src/pages/SafeJourneyPage.tsx`), when no contact is selected (or the user has no accepted contacts), a calm note is shown in English (`"No one will be told if you don't check in. Pick a trusted contact."`) and Hindi (`"यदि आप चेक-इन नहीं करती हैं तो किसी को नहीं बताया जाएगा। एक विश्वसनीय संपर्क चुनें।"`), without blocking the Start button.
2. **Follow-up 2 (Optional Short Destination Note)**:
   - Added `note` column (`max 100 chars`) to `journeys` (`apps/api/src/db/schema.ts`, `0007_safe_journeys.sql`).
   - Added `"Where are you heading? (optional)"` input on the start screen in English and Hindi.
   - The note is never returned in `JourneyDto` API responses, never included in reminder pushes, and never shown on the active or lapsed screens; it is included **only** in the lapse SMS to the chosen contact as: `"She said: <note>"`.

### Phase 7B: Reports and the Aggregated Safety Layer
1. **Task 1 — Schema + Migration (`apps/api/src/db/schema.ts`, `apps/api/src/db/migrations/0008_reports_safety_layer.sql`)**:
   - Added `reports` table (`id`, `category` [`poor_lighting`, `harassment`, `stalking`, `unsafe_area`, `broken_cctv`, `other`], `lat` and `lng` rounded to 3 decimals, `note` up to 500 chars, `anonymous` bool, `user_id` NULL when anonymous, `created_at`).
2. **Task 2 — Endpoints & K-Anonymity (`apps/api/src/routes/reports.ts`, `apps/api/src/services/reportService.ts`)**:
   - `POST /api/reports`: Rate-limited (`reportRateLimitMiddleware`, keyed strictly by IP so anonymous submissions are never linked to `user_id`), rounds `lat`/`lng` to 3 decimals (`~100 m` grid cell), stores `user_id = NULL` when `anonymous` is `true`, and logs no user identifier or coordinates.
   - `GET /api/safety-layer`: Returns aggregated counts per ~100 m grid cell (`3` decimals) and **only** cells with at least `K` reports (default `K = 5`, configurable via `SAFETY_LAYER_MIN_REPORTS_K`). Never returns individual report notes, IDs, or `user_id`s.
   - `GET /api/reports`: Returns `403` for normal users so raw reports can never be read by non-admins.
   - `GET /api/admin/reports` & `DELETE /api/admin/reports/:id`: Admin-only (`requireRole('admin')`) moderation endpoints to read raw reports and delete a report.
3. **Task 3 — Photo Attachments Decision**:
   - **Dropped**: Per Task 3 instructions (*"If you cannot guarantee EXIF removal, DROP the photo feature and tell me"*), photo attachments were intentionally omitted because server-side or unsupported-browser fallbacks cannot guarantee 100% metadata/EXIF stripping without native image re-encoding libraries, and text/category/grid-cell reporting satisfies the non-identifying reporting goal with zero risk of visual or metadata leakage.
4. **Task 4 — Bilingual Web UI (`apps/web/src/pages/SafetyReportsPage.tsx`, `apps/web/src/i18n/en.json`, `apps/web/src/i18n/hi.json`)**:
   - Mounted at `/reports` with navigation links (`Safety Reports` / `सुरक्षा रिपोर्ट`) in English and Hindi.
   - Quick report flow: 6 category chips (`>=56px`), Leaflet pin-drop map + manual coordinate inputs + `"Use my current location"` button (enabled **only** when `location` consent is granted), optional note (`max 500 chars`), and an anonymous toggle (ON by default) with a plain explanation using `$t(app.name)`.
   - Aggregated safety layer view: Leaflet map of k-anonymized cells (`>= K` reports) when online and not in data-saver mode, and an accessible text list of aggregated cells (never individual reports) when offline or in data-saver mode.

---

## 2. Files Created / Changed

### Created
- `apps/api/src/db/migrations/0008_reports_safety_layer.sql`
- `apps/api/src/services/reportService.ts`
- `apps/api/src/routes/reports.ts`
- `apps/api/src/tests/phase7b_reports.test.ts`
- `apps/web/src/pages/SafetyReportsPage.tsx`
- `apps/web/src/tests/phase7b_reports_ui.test.tsx`
- `docs/phase-07b-report.md`

### Modified
- `apps/api/src/db/schema.ts`
- `apps/api/src/db/migrations/0007_safe_journeys.sql`
- `apps/api/src/db/migrations/meta/_journal.json`
- `apps/api/src/core/config.ts`
- `apps/api/src/core/middleware.ts`
- `apps/api/src/services/journeyService.ts`
- `apps/api/src/routes/journeys.ts`
- `apps/api/src/services/auditService.ts`
- `apps/api/src/routes/responder.ts`
- `apps/api/server.ts`
- `apps/api/src/tests/phase7a_journeys.test.ts`
- `apps/web/src/lib/api.ts`
- `apps/web/src/i18n/en.json`
- `apps/web/src/i18n/hi.json`
- `apps/web/src/pages/SafeJourneyPage.tsx`
- `apps/web/src/App.tsx`
- `apps/web/src/components/PageLayout.tsx`
- `apps/web/src/pages/HomePage.tsx`
- `apps/web/src/tests/phase7a_journeys_ui.test.tsx`

---

## 3. Verification & Real Command Output

### Phase 7A Follow-Up Tests (`phase7a_journeys.test.ts` & `phase7a_journeys_ui.test.tsx`)
```text
 ✓ apps/api/src/tests/phase7a_journeys.test.ts > SAATHI Phase 7A API Tests (Safe Journeys / Walk With Me) > 6. Follow-up 2: Optional short note (max 100 chars) is stored with the journey, never returned in API responses or reminder pushes, and included ONLY in the lapse SMS to the chosen contact as "She said: <note>" 284ms
 ✓ apps/web/src/tests/phase7a_journeys_ui.test.tsx > SAATHI Phase 7A Web UI Tests — Safe Journeys ("Walk with me") > 1. Start screen, honest no-tracking note ($t(app.name)), duration chips, contact picker, active countdown, reminder prompt, extend, and "I'm safe" completion (English + Hindi) 247ms
 Test Files  2 passed (2)
      Tests  8 passed (8)
```

### Phase 7B API Tests (`apps/api/src/tests/phase7b_reports.test.ts`)
```text
 ✓ apps/api/src/tests/phase7b_reports.test.ts > SAATHI Phase 7B API Tests (Reports & K-Anonymized Aggregated Safety Layer) > 1. Anonymous report has NO user_id in DB; non-anonymous stores user_id; coordinates are rounded to 3 decimals 110ms
 ✓ apps/api/src/tests/phase7b_reports.test.ts > SAATHI Phase 7B API Tests (Reports & K-Anonymized Aggregated Safety Layer) > 2. K-anonymity on GET /api/safety-layer: cells with < K reports (default K=5) are NOT returned; cells with >= K reports ARE returned with aggregated counts only 90ms
 ✓ apps/api/src/tests/phase7b_reports.test.ts > SAATHI Phase 7B API Tests (Reports & K-Anonymized Aggregated Safety Layer) > 3. Access control & Moderation: normal users and responders cannot read raw reports (403); admin CAN read GET /api/admin/reports and delete a report via DELETE /api/admin/reports/:id 95ms
 ✓ apps/api/src/tests/phase7b_reports.test.ts > SAATHI Phase 7B API Tests (Reports & K-Anonymized Aggregated Safety Layer) > 4. Rate limiting on POST /api/reports: enforces per-minute limit and returns 429 when exceeded 91ms
 Test Files  1 passed (1)
      Tests  4 passed (4)
```

### Phase 7B Web UI Tests (`apps/web/src/tests/phase7b_reports_ui.test.tsx`)
```text
 ✓ apps/web/src/tests/phase7b_reports_ui.test.tsx > SAATHI Phase 7B Web UI Tests — Reports & Aggregated Safety Layer > 1. Report flow, category chips, consent-gated current location, anonymous toggle with plain explanation, and English + Hindi i18n 441ms
 ✓ apps/web/src/tests/phase7b_reports_ui.test.tsx > SAATHI Phase 7B Web UI Tests — Reports & Aggregated Safety Layer > 2. Aggregated map list in data-saver / offline mode and location consent off: hides map tiles, shows text list of aggregated cells, and blocks current-location GPS button when consent is off 48ms
 Test Files  1 passed (1)
      Tests  2 passed (2)
```

### Full Test Suite Totals (`/tmp/phase7b_full_suite.log`)
```text
 Test Files  21 passed (21)
      Tests  104 passed (104)
   Start at  11:20:21
   Duration  100.81s (tests 52%, environment 25%, import 20%, transform 2%)
```

---

## 4. Assumptions & Known Issues
- **Assumptions**:
  - Photo uploads were dropped per Task 3 rules so there is zero risk of EXIF or visual identity leakage.
  - Grid cells are keyed by 3-decimal-place rounded `(lat, lng)` (~110 m resolution) and require at least `K = 5` reports before appearing in `GET /api/safety-layer`.
- **Known Issues**: None.

---

## 5. What the Next Phase Can Rely On
- `reports` table (`0008_reports_safety_layer.sql`), `POST /api/reports`, `GET /api/safety-layer` (k-anonymized with `K=5`), and admin moderation endpoints `GET /api/admin/reports` and `DELETE /api/admin/reports/:id`.
- `SafetyReportsPage` at `/reports` with bilingual category chips, consent-gated GPS / map pin drop, anonymous toggle, and offline/data-saver text list fallback.
