# Phase 7A Report — Safe Journeys ("Walk with me") & Phase 6B Follow-Ups

## 1. What Was Built

### Phase 6B Follow-Ups
1. **Follow-up 1 (Responder Acknowledge Cancels Escalation Timers)**:
   - Added direct test `3. Follow-up 1: After a responder acknowledges, escalation timers for that incident are cancelled and no further escalation notifications or mock-112 request are sent` in `apps/api/src/tests/phase6b_verification_gaps.test.ts`.
   - Verified `hasScheduledEscalation(incidentId)` transitions from `true` to `false` immediately on responder `POST /api/responder/incidents/:id/acknowledge` and zero Step 1/Step 2 SMS, push, or Mock 112 requests fire after waiting past their scheduled delays.
2. **Follow-up 2 (Audit-Log Throttling for Responder List Access)**:
   - Updated `recordIncidentAccessAudit()` in `apps/api/src/services/auditService.ts` to throttle `responder_list_incidents` to at most once per 5 minutes (`RESPONDER_LIST_THROTTLE_MS = 5 * 60 * 1000`) per responder (`actorId`), while always logging every incident detail view (`responder_view_incident`) and every action (`responder_action:<action>`).
   - Added test `4. Follow-up 2: Audit-log throttling — responder LIST access is logged at most once per 5 minutes per responder, while every DETAIL view and action is always logged` in `apps/api/src/tests/phase6b_verification_gaps.test.ts`.

### Phase 7A: Safe Journeys ("Walk with me")
1. **Task 1 — Schema + Migration (`apps/api/src/db/schema.ts`, `apps/api/src/db/migrations/0007_safe_journeys.sql`)**:
   - Added `journeys` table (`id`, `user_id`, `contact_id` nullable, `started_at`, `ends_at`, `status` [`active`, `completed`, `lapsed`, `cancelled`], `reminder_sent_at` nullable, `lapsed_notified_at` nullable) with indexes on `user_id` and `status`.
2. **Task 2 — Owner-Only Endpoints (`apps/api/src/routes/journeys.ts`, `apps/api/src/services/journeyService.ts`)**:
   - `POST /api/journeys` (alias `/api/journeys/start`): starts an active journey for a duration in minutes (with optional accepted `contact_id`).
   - `GET /api/journeys/active`: returns the owner's active journey (or most recent un-dismissed `lapsed` journey so the lapsed screen can be displayed).
   - `GET /api/journeys/:id`: returns a specific journey owned by the user.
   - `POST /api/journeys/:id/extend`: extends an active journey's `ends_at` and reschedules server timers.
   - `POST /api/journeys/:id/complete`: marks the journey `completed` ("I'm safe") and cancels all scheduled timers.
   - `POST /api/journeys/:id/cancel`: marks the journey `cancelled` and cancels all scheduled timers.
3. **Task 3 — Server-Side Scheduler & Startup Recovery (`apps/api/src/services/scheduler.ts`, `apps/api/src/services/journeyService.ts`, `apps/api/server.ts`)**:
   - Extended the in-process scheduler with `scheduleJourneyTimers()`, `cancelScheduledJourneyTimers()`, and `recoverActiveJourneysOnStartup()`.
   - Sends a T-minus reminder (configurable via `JOURNEY_REMINDER_LEAD_MINUTES`, default `3` minutes) to the user via `MockPushProvider` (`recipientRef: "user:<userId>"`) and sets `reminder_sent_at`.
   - On lapse without completion, marks the journey `lapsed` and notifies the chosen contact **only** if `getNotifiableContacts(userId, "checkin")` returns them, using the exact plain-text message (no link, no location): `"<first name> hasn't checked in from her walk. Expected by HH:MM."`
   - Re-reads active journeys on startup and never duplicates an already-sent reminder (`reminder_sent_at`) or lapse notice (`lapsed_notified_at`).
4. **Task 4 — No-Tracking Rule**:
   - Safe Journeys never request, collect, store, or share location coordinates. Location only exists if the user explicitly triggers SOS, which creates a normal incident through `triggerSos()`.
   - Verified with a dedicated test that completed and lapsed journeys leave zero rows in `location_samples` even when `location` consent is granted.
5. **Task 5 — Bilingual Web UI (`apps/web/src/pages/SafeJourneyPage.tsx`, `apps/web/src/i18n/en.json`, `apps/web/src/i18n/hi.json`)**:
   - Added `/journeys` route and navigation links (`Safe Walk` / `सुरक्षित यात्रा`), with `>=56px` touch targets in English and Hindi.
   - Displays the honest no-tracking banner using `$t(app.name)`: `"SAATHI cannot see your location during a walk. If you need help, press SOS."`
   - Includes start screen (duration chips `15/30/45/60 min`, optional accepted contact picker), calm active-journey screen (countdown, expected time, big `"I'm safe"` button, `+10 min` extend, cancel, and T-minus reminder banner), and lapsed screen (`"Send SOS"`, `"Call 112"`, and `"I'm safe (close timer)"`).

---

## 2. Files Created / Changed

### Created
- `apps/api/src/db/migrations/0007_safe_journeys.sql`
- `apps/api/src/services/journeyService.ts`
- `apps/api/src/routes/journeys.ts`
- `apps/api/src/tests/phase7a_journeys.test.ts`
- `apps/web/src/pages/SafeJourneyPage.tsx`
- `apps/web/src/tests/phase7a_journeys_ui.test.tsx`
- `docs/phase-07a-report.md`

### Modified
- `apps/api/src/services/auditService.ts`
- `apps/api/src/tests/phase6b_verification_gaps.test.ts`
- `apps/api/src/db/schema.ts`
- `apps/api/src/db/migrations/meta/_journal.json`
- `apps/api/src/core/config.ts`
- `apps/api/src/services/scheduler.ts`
- `apps/api/server.ts`
- `apps/web/src/lib/api.ts`
- `apps/web/src/i18n/en.json`
- `apps/web/src/i18n/hi.json`
- `apps/web/src/App.tsx`
- `apps/web/src/components/PageLayout.tsx`
- `apps/web/src/pages/HomePage.tsx`
- `apps/web/src/tests/phase4a_sos_core.test.tsx`

---

## 3. Verification & Real Command Output

### Phase 6B Follow-Ups (`apps/api/src/tests/phase6b_verification_gaps.test.ts`)
```text
 ✓ apps/api/src/tests/phase6b_verification_gaps.test.ts > SAATHI Phase 6B Verification Gap Tests (API) > 1. Duress resolve & invalid transition rejection (e, h, q): responder resolve truly closes a duress incident while keeping owner view masked, rejects invalid state transitions after close, and includes MOCK 112 gateway status 517ms
 ✓ apps/api/src/tests/phase6b_verification_gaps.test.ts > SAATHI Phase 6B Verification Gap Tests (API) > 2. Audit log for responder list/view/actions & GET /api/admin/audit-log admin-only route (i, k) 151ms
 ✓ apps/api/src/tests/phase6b_verification_gaps.test.ts > SAATHI Phase 6B Verification Gap Tests (API) > 3. Follow-up 1: After a responder acknowledges, escalation timers for that incident are cancelled and no further escalation notifications or mock-112 request are sent 362ms
 ✓ apps/api/src/tests/phase6b_verification_gaps.test.ts > SAATHI Phase 6B Verification Gap Tests (API) > 4. Follow-up 2: Audit-log throttling — responder LIST access is logged at most once per 5 minutes per responder, while every DETAIL view and action is always logged 158ms
 Test Files  1 passed (1)
      Tests  4 passed (4)
```

### Phase 7A API Tests (`apps/api/src/tests/phase7a_journeys.test.ts`)
```text
 ✓ apps/api/src/tests/phase7a_journeys.test.ts > SAATHI Phase 7A API Tests (Safe Journeys / Walk With Me) > 1. Reminder before lapse & lapse notifies ONLY an eligible checkin contact with plain text (no link, no location) 429ms
 ✓ apps/api/src/tests/phase7a_journeys.test.ts > SAATHI Phase 7A API Tests (Safe Journeys / Walk With Me) > 2. Eligibility gate via getNotifiableContacts(userId, "checkin"): does NOT notify contact if receives_checkin is false, contact is paused, or data_processing consent is revoked 251ms
 ✓ apps/api/src/tests/phase7a_journeys.test.ts > SAATHI Phase 7A API Tests (Safe Journeys / Walk With Me) > 3. Extend, Complete ("I'm safe"), Cancel, and Owner-only RBAC: complete and cancel stop timers so no reminder or lapse SMS is sent 346ms
 ✓ apps/api/src/tests/phase7a_journeys.test.ts > SAATHI Phase 7A API Tests (Safe Journeys / Walk With Me) > 4. Server restart recovery: re-reads active journeys on startup and never duplicates an already-sent reminder or lapse notice 384ms
 ✓ apps/api/src/tests/phase7a_journeys.test.ts > SAATHI Phase 7A API Tests (Safe Journeys / Walk With Me) > 5. No-tracking rule (critical): a completed or lapsed journey collects and leaves ZERO location_samples even when location consent is granted 196ms
 Test Files  1 passed (1)
      Tests  5 passed (5)
```

### Phase 7A Web UI Tests (`apps/web/src/tests/phase7a_journeys_ui.test.tsx`)
```text
 ✓ apps/web/src/tests/phase7a_journeys_ui.test.tsx > SAATHI Phase 7A Web UI Tests — Safe Journeys ("Walk with me") > 1. Start screen, honest no-tracking note ($t(app.name)), duration chips, contact picker, active countdown, reminder prompt, extend, and "I'm safe" completion (English + Hindi) 261ms
 ✓ apps/web/src/tests/phase7a_journeys_ui.test.tsx > SAATHI Phase 7A Web UI Tests — Safe Journeys ("Walk with me") > 2. Lapsed screen: displays lapsed warning, Call 112 link (tel:112), Send SOS button (triggers normal SOS flow), and I'm safe dismiss 78ms
 Test Files  1 passed (1)
      Tests  2 passed (2)
```

### Full Test Suite Totals (`/tmp/phase7a_full_suite.log`)
```text
 Test Files  18 passed (18)
      Tests  93 passed (93)
   Start at  07:33:08
   Duration  88.13s (tests 55%, environment 23%, import 19%, transform 2%)
```

---

## 4. Assumptions & Known Issues
- **Assumptions**:
  - `GET /api/journeys/active` returns the user's `active` journey, or if none is active, returns the user's most recent journey if its status is `lapsed` so the frontend can immediately display the lapsed screen with `"Call 112"` and `"Send SOS"` until the user taps `"I'm safe (close timer)"` or starts a new timer.
  - `lapsed_notified_at` is persisted on `journeys` so server restarts after a lapse never send duplicate plain-text SMS notices.
- **Known Issues**: None.

---

## 5. What the Next Phase Can Rely On
- `journeys` table (`0007_safe_journeys.sql`) and `journeyService.ts` / `journeysRouter` (`/api/journeys`, `/api/journeys/active`, `/api/journeys/:id/{extend|complete|cancel}`).
- Strict separation between Safe Journeys (zero location tracking, plain-text check-in lapse SMS gated by `getNotifiableContacts(userId, "checkin")`) and SOS Incidents (`incidents` state machine + consent-gated `location_samples`).
- Throttled responder list audit logging (at most once per 5 minutes per responder) alongside unthrottled detail-view and action audit logs in `incident_access_audit`.
