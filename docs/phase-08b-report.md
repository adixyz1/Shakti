# Phase 08B Report — Admin Dashboard, Admin Tools & Post-Incident Rating (Frontend + Admin Responder Endpoints)

## 1. What Was Built

1. **Admin Responder Endpoints (`apps/api/src/routes/responder.ts`, `apps/api/src/services/responderService.ts`)**:
   - `GET /api/admin/responders` (`requireRole('admin')`): Returns `id`, `name`, `organization_zone`, `active`, and `on_duty` for all responders. Never returns phone numbers or incident data.
   - `PATCH /api/admin/responders/:id` (`requireRole('admin')`): Strict request body validation accepting ONLY `{ active?: boolean, on_duty?: boolean }` and rejecting any extra fields, empty body, or non-boolean values with HTTP `400`.
   - Writes an immutable admin audit entry (`admin_update_responder`) recording who changed what and when.
   - If the update leaves an `organization_zone` with zero active, on-duty responders while that zone has an open incident, the update still applies and returns a `warning` string so the UI can display it in plain words. **Note**: Routing only applies to incidents that become `ACTIVE` after the change; existing assignments are not changed.

2. **Admin Analytics & Tools Page (`apps/web/src/pages/AdminPage.tsx`, routes `/admin` and `/admin/tools`, role `admin` only, English + Hindi)**:
   - **Chart Library Installed**: `recharts` (`BarChart` for notification delivery rate by channel and `LineChart` for weekly safety pulse average score & % avoided).
   - **Prototype & Honesty Rules**: Prominent `"Measured prototype values (test environment)"` banner; renders `"Not enough data yet"` whenever `insufficient_data` is `true` (never renders fabricated numbers); displays each metric's target beside its measured value.
   - **Alert-Initiation Separation & Clock-Skew Footnote**: Shows `queued-then-delivered` offline alerts in a separate card from `alert_initiation_time`, and includes the footnote with `excluded_implausible` count and `"client clocks can be wrong"`.
   - **Date-Range Filter & CSV Export**: `from` / `to` date inputs calling `GET /api/admin/metrics?from=&to=` and a CSV download button calling `GET /api/admin/metrics.csv?from=&to=`.
   - **Admin Tools Tab (`/admin/tools`)**:
     - **Responder Roster**: Lists responders with `Active` and `On Duty` toggles, requires an explicit confirmation tap (`Confirm Turn Off`) before turning a responder off, and displays the backend `warning` in plain words if a zone is left with zero active, on-duty responders during an open incident.
     - **Audit-Log Viewer**: Reads `GET /api/admin/audit-logs` with incident ID and actor-type (`contact` / `responder` / `admin`) filters.
     - **Resource Directory Editor**: Create, edit, and delete helpline/resource entries via `POST /api/admin/resources`, `PUT /api/admin/resources/:id`, and `DELETE /api/admin/resources/:id`.

3. **Post-Incident Rating Card (`apps/web/src/components/PostIncidentRatingCard.tsx`, integrated in `apps/web/src/pages/HomePage.tsx`)**:
   - Rendered only on the closed incident outcome screen (`CANCELLED`, `RESOLVED`, `FALSE_ALARM`, `EXPIRED`)—never during an active alert.
   - Uses `$t(app.name)` in `"How did $t(app.name)'s help feel? 1-5"`, submits to `POST /api/incidents/:id/rating`, and is skippable in one tap. For duress incidents, the owner's masked view shows the same closed screen and rating card with identical wording and timing.

---

## 2. Test Execution Environment
- Frontend tests in `apps/web/src/tests/phase8b_admin_ui.test.tsx` ran in **JSDOM** (via Vitest + React Testing Library), not a real headless browser.
- Backend tests in `apps/api/src/tests/phase8b_admin_responders.test.ts` ran against a real temporary SQLite database and Express app via Supertest.

---

## 3. What Was NOT Done (Out of Scope for Phase 8B)
- Privacy export / account deletion tools (deferred to Phase 8C).
- Guided Demo Mode (deferred to Phase 8D).

## 4. What the Next Phase (Phase 8C) Can Rely On
- Admin analytics (`/admin`), admin tools (`/admin/tools`), `GET/PATCH /api/admin/responders`, and post-incident ratings (`POST /api/incidents/:id/rating` + `PostIncidentRatingCard`) are complete and tested in English and Hindi.

## 5. Verification Totals
- `Test Files  26 passed (26) | Tests  123 passed (123)`
