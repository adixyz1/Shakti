# Phase 8D Report: Demo Mode (`DEMO_MODE=true`)

## Summary of What Was Done

1. **Public Policy Check (PIN Features)**:
   - Updated the public `/policy` page copy in English (`apps/web/src/i18n/en.json`) and Hindi (`apps/web/src/i18n/hi.json`) so that `policy.section1Items.account` states only that optional safety PIN features change what is shown on screen, with no mention or explanation of Duress PIN or Cancel PIN mechanics.

2. **`DEMO_MODE` Flag & Production Guard (`apps/api/src/core/config.ts`, `apps/api/server.ts`, `apps/api/src/routes/demo.ts`)**:
   - Added `DEMO_MODE=true` environment flag, off by default (`false`).
   - Added `assertValidDemoModeConfiguration()`, called at server startup (`startServer()`), which throws a fatal error if `DEMO_MODE=true` when `NODE_ENV=production` (no override).
   - Added `requireDemoMode` middleware so every `/api/demo/*` endpoint returns `404` when `DEMO_MODE` is off.

3. **Demo Data Schema, Seeding, Idempotent Reset & Metrics Filtering (`0012_demo_mode_flags.sql`, `demoService.ts`, `metricsService.ts`, `reportService.ts`)**:
   - Added migration `0012_demo_mode_flags.sql` adding `is_demo` boolean columns (`DEFAULT false NOT NULL`) to `incidents`, `reports`, and `safety_pulses`.
   - Implemented `resetAndSeedDemoData` and `POST /api/demo/reset` (admin-only, idempotent) which restores the seeded demo users, 2 accepted trusted contacts (`Priya Verma`, `Rohan Kulkarni`), on-duty campus responder, resources directory, and `is_demo = true` incidents (with valid SHA-256 hash-chained events, notifications, locations, and trust ratings), community reports, and weekly safety pulses exceeding the `n >= 5` minimum sample threshold.
   - Updated `computeImpactMetrics` and `getAggregatedSafetyLayer` to include `is_demo` rows **only** when `DEMO_MODE=true`, returning `includes_demo_data: true` and rendering the `"Includes demo data"` badge on the Admin Analytics page.

4. **Simulate Panel (`demoService.ts`, `responderService.ts`, `contactIncidentTokenService.ts`, `DemoSimulatePanel.tsx`)**:
   - Implemented `POST /api/demo/simulate/responder` (`acknowledge`, `on_the_way`, `resolve`, with optional `delay_ms` up to 5000 ms) and `POST /api/demo/simulate/contact` (`seen`, `on_my_way`, with optional `delay_ms`), restricted to demo mode and accessible to `admin` or the seeded demo user (`user_demo_1`).
   - Both simulation endpoints act through the real `performResponderIncidentAction` and `recordContactResponseByToken` state-machine services (never writing statuses directly) and mark `incident_events`, `incident_access_audit`, and `audit_log` rows with `simulated: true` / `[SIMULATED_DEMO_ACTION]`.

5. **Always-Visible Demo Banner & Presentation Script (`DemoModeBanner.tsx`, `docs/DEMO_SCRIPT.md`)**:
   - Added `DemoModeBanner` across all screens (`PageLayout`, `WelcomePage`, `LoginPage`, `ContactAlertPage`, `PublicInvitePage`) displaying `"DEMO MODE: no real alerts are sent"` with mock-provider labels (`MockSmsProvider`, `MockPushProvider`, `MockEmergencyGateway`) only when `DEMO_MODE=true`.
   - Wrote `docs/DEMO_SCRIPT.md` covering the 5-minute live presentation journey.

## What Was Not Done
- No new product features or changes outside the Phase 8D scope were added.

## Verification Totals
- `phase8d_demo.test.ts`: 5 passed (5)
- `phase8d_demo_ui.test.tsx`: 2 passed (2)
- Full test suite: `Test Files  30 passed (30)`, `Tests  136 passed (136)`
