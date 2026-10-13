# Phase 6B Report — Responder Dashboard, Organization Routing, Duress-Aware Responder Workflow & Incident Access Audit Log

## 1. Summary of What Was Implemented in Phase 6B

### Task 1: Responder Model & Organization/Zone Routing
- **Database Schema (`apps/api/src/db/schema.ts`, `apps/api/src/db/migrations/0006_responders_routing_audit.sql`)**:
  - Added `organizationZone` (`organization_zone`, default `'Demo Campus Zone'`) to `users`.
  - Added `responders` table (`id`, `user_id`, `organization_zone`, `active`, `on_duty`, `created_at`, `updated_at`) with unique index on `user_id` and index on `organization_zone`.
  - Added `incident_assignments` table (`id`, `incident_id`, `responder_id`, `responder_user_id`, `organization_zone`, `assigned_by_user_id`, `acknowledged_at`, `created_at`).
- **Seed Data (`apps/api/src/core/seed.ts`)**:
  - Seeds the demo organization `'Demo Campus Zone'` (`DEFAULT_ORGANIZATION_ZONE`) across baseline accounts and creates an active, on-duty responder profile in `responders` for `Inspector Kavita Rao` (`+919000000002`, role `responder`).
- **Modular Routing & t=0 Dispatcher Notification (`apps/api/src/services/responderService.ts`, `apps/api/src/services/notificationDispatcher.ts`)**:
  - `routeActiveIncidentToResponders(incidentId, db)` routes an `ACTIVE` incident to all `active = true` and `on_duty = true` responders matching the user's `organization_zone` and stores routing rows in `incident_assignments`.
  - At `t=0` (`dispatchInitialActiveNotifications`), routed responders are notified via `PushProvider` (`MockPushProvider`) with `recipient_type = 'responder'` and `channel = 'push'`.

### Task 2: Responder Endpoints & Minimal Data Exposure (`apps/api/src/routes/responder.ts`, `apps/api/src/services/responderService.ts`)
- All `/api/responder/*` routes enforce `requireAuth` + `requireRole('responder')`:
  - `GET /api/responder/incidents`: Returns only incidents routed to this responder's `organization_zone`, sorted with open incidents first (`OPEN_INCIDENT_STATUSES`), then newest `created_at` descending.
  - `GET /api/responder/incidents/:id`: Returns the real status (using only the 9 state-machine statuses from `PROJECT_BRIEF.md`), `is_duress` flag, `duress_notice`, `mock_112_gateway` status (explicitly labeled `MOCK`), latest location point **only** if the user has active `location` consent, and the sanitized `events` timeline.
  - `POST /api/responder/incidents/:id/acknowledge|assign|note|responding|resolve|false-alarm`:
    - Writes `incident_events` with `actor_type = 'responder'`.
    - Transitions state strictly through `transition()` in `incidentStateMachine.ts` (`ACKNOWLEDGED`, `RESPONDING`, `RESOLVED`, `FALSE_ALARM`) and rejects invalid state transitions on closed incidents (`400`).
    - Stops the scheduled escalation ladder immediately on `acknowledge` (and `responding`/`resolve`/`false-alarm`).
    - Never reveals responder events or status changes to the owner of an `is_duress = true` incident (`maskIncidentForOwner` in `incidentService.ts` and `wsHub.ts`), while responder `resolve` truly closes the duress incident (`status = 'RESOLVED'`, `closed_at` populated).
- **Strict Minimum Data Exposure**:
  - Responders see only `user_first_name`, `emergency_type`, `created_at` / `activated_at`, and `latest_location` (when location consent is active).
  - `user_phone_e164` is `null` until this responder acknowledges the incident (`acknowledged_by_responder === true`), after which `user_phone_e164` is revealed.
  - No consent ledger (`consents`) and no other trusted contacts' names, phones, or IDs are ever returned to responders.

### Task 3: Incident Access Audit Log (`apps/api/src/services/auditService.ts`, `apps/api/src/routes/responder.ts`)
- Added `incident_access_audit` table (`id`, `incident_id`, `actor_type`, `actor_id`, `actor_label`, `action`, `detail`, `created_at`).
- Records every non-owner access to an incident:
  - Trusted contact magic-link opens (`contact_link_open`) and actions (`contact_action:<action>`) in `contactIncidentTokenService.ts`.
  - Responder incident list reads (`responder_list_incidents`), detail views (`responder_view_incident`), and responder actions (`responder_action:<action>`) in `responderService.ts`.
- Exposed admin-only read endpoints `GET /api/admin/audit-log` and `GET /api/admin/audit-logs` (`requireAuth`, `requireRole('admin')` in `apps/api/src/routes/responder.ts`), with optional `?incident_id=` filter.

### Task 4: Responder Dashboard Web UI (`apps/web/src/pages/ResponderDashboardPage.tsx`)
- Mounted at `/responder` (`ProtectedRoute` with `allowedRoles={['responder']}`).
- Bilingual English (`en`) + Hindi (`hi`) strings under `responderDashboard.*` using `$t(app.name)` for the product name.
- Features:
  - Live incident list (open first) with status filter (`All` / `Open` / `Closed`, `responder-status-filter`), WebSocket `/ws` updates, polling fallback, and a reactive freshness label (`responder-list-freshness-label`).
  - Live response timer (`responder-response-timer`) that counts elapsed seconds while unacknowledged and stops on acknowledge (`(stopped on acknowledge)`).
  - Mock 112 gateway status indicator (`responder-mock-112-status`) explicitly labeled `MOCK` (`responder-mock-112-badge`).
  - Leaflet map (`responder-leaflet-map`) of the selected incident's latest location with a `"Last updated"` freshness label (`responder-map-last-updated`).
  - Prominent Duress Warning Banner (`responder-duress-banner`) when `is_duress === true`: `"Silent alert: do not contact her directly."`
  - Large (`>=56px`) high-contrast action buttons for **Acknowledge Alert**, **Mark Responding (En Route)**, **Resolve Incident**, **Mark False Alarm** (with required reason note), **Assign / Reassign Responder**, and **Add Note**.

---

## 2. Requirement-to-Test Verification Map (a–q)

| Req | Requirement | Initial Status (Before Gap Tests) | Final Proving Test(s) |
| --- | --- | --- | --- |
| **a** | Responders see only incidents routed to their organization | Covered | `apps/api/src/tests/phase6b_responder_dashboard.test.ts` → `1. Routing & RBAC: routes ACTIVE incident to active on-duty responders in user organization, notifies via PushProvider at t=0, blocks role=user with 403, and isolates responders in other organizations` |
| **b** | Non-responder roles are rejected on `/api/responder/*` | Covered | `apps/api/src/tests/phase6b_responder_dashboard.test.ts` → `1. Routing & RBAC: routes ACTIVE incident to active on-duty responders in user organization, notifies via PushProvider at t=0, blocks role=user with 403, and isolates responders in other organizations` |
| **c** | Phone number hidden until this responder acknowledges | Covered | `apps/api/src/tests/phase6b_responder_dashboard.test.ts` → `2. Minimal Exposure & Consent-Gated Location: responder sees first name only, phone ONLY after acknowledging, no consent ledger or other contacts details, and location ONLY when location consent is active` |
| **d** | Location hidden without the user's location consent | Covered | `apps/api/src/tests/phase6b_responder_dashboard.test.ts` → `2. Minimal Exposure & Consent-Gated Location: responder sees first name only, phone ONLY after acknowledging, no consent ledger or other contacts details, and location ONLY when location consent is active` |
| **e** | Responder actions write `incident_events` with `actor_type` responder and only make valid state transitions | Partially covered (valid transitions tested; invalid after-close transition added) | `apps/api/src/tests/phase6b_responder_dashboard.test.ts` → `3. Responder Actions & State Machine: assign, note, responding, resolve, and false-alarm (requires note) write responder events and transition state` + `apps/api/src/tests/phase6b_verification_gaps.test.ts` → `1. Duress resolve & invalid transition rejection (e, h, q)...` |
| **f** | Acknowledge stops the escalation ladder | Covered | `apps/api/src/tests/phase6b_responder_dashboard.test.ts` → `2. Minimal Exposure & Consent-Gated Location...` and `4. End-to-End Integration (Genuine + Duress) & Audit Log...` |
| **g** | The owner of a duress incident sees nothing of responder activity | Covered | `apps/api/src/tests/phase6b_responder_dashboard.test.ts` → `4. End-to-End Integration (Genuine + Duress) & Audit Log...` |
| **h** | A responder resolve truly closes a duress incident | NOT COVERED initially → Added | `apps/api/src/tests/phase6b_verification_gaps.test.ts` → `1. Duress resolve & invalid transition rejection (e, h, q): responder resolve truly closes a duress incident while keeping owner view masked, rejects invalid state transitions after close, and includes MOCK 112 gateway status` |
| **i** | `audit_log` rows for responder list/view/actions | NOT COVERED initially (`list` was missing) → Fixed & Added | `apps/api/src/tests/phase6b_verification_gaps.test.ts` → `2. Audit log for responder list/view/actions & GET /api/admin/audit-log admin-only route (i, k)` |
| **j** | `audit_log` rows for contact magic-link opens | Covered | `apps/api/src/tests/phase6b_responder_dashboard.test.ts` → `4. End-to-End Integration (Genuine + Duress) & Audit Log...` |
| **k** | `GET /api/admin/audit-log` exists and is admin-only (file and route) | NOT COVERED initially (only plural `/api/admin/audit-logs` was mounted) → Mounted singular `/api/admin/audit-log` in `apps/api/src/routes/responder.ts` (`responderRouter.get(['/admin/audit-log', '/admin/audit-logs'], requireAuth, requireRole('admin'), ...)`) & Added test | `apps/api/src/tests/phase6b_verification_gaps.test.ts` → `2. Audit log for responder list/view/actions & GET /api/admin/audit-log admin-only route (i, k)` |
| **l** | UI: incident list and status filter | NOT COVERED initially (status filter missing) → Fixed & Added | `apps/web/src/tests/phase6b_verification_gaps.test.tsx` → `1. Verifies status filter (l), response timer stopping on acknowledge (m), duress banner "Silent alert: do not contact her directly." (n), and Mock 112 gateway status labeled MOCK (q)` |
| **m** | UI: response timer stops on acknowledge | NOT COVERED initially → Fixed & Added | `apps/web/src/tests/phase6b_verification_gaps.test.tsx` → `1. Verifies status filter (l), response timer stopping on acknowledge (m), duress banner "Silent alert: do not contact her directly." (n), and Mock 112 gateway status labeled MOCK (q)` |
| **n** | UI: duress banner `"Silent alert: do not contact her directly."` | NOT COVERED initially (wording differed) → Fixed & Added | `apps/web/src/tests/phase6b_verification_gaps.test.tsx` → `1. Verifies status filter (l), response timer stopping on acknowledge (m), duress banner "Silent alert: do not contact her directly." (n), and Mock 112 gateway status labeled MOCK (q)` |
| **o** | UI: phone hidden until acknowledge | Covered | `apps/web/src/tests/phase6b_responder_dashboard.test.tsx` → `1. Renders live incident list, freshness label, map with last updated label, duress warning banner, and hides victim phone until responder acknowledges` |
| **p** | UI: Hindi strings present | Covered | `apps/web/src/tests/phase6b_responder_dashboard.test.tsx` → `2. Supports responding, assign, note, resolve, false-alarm (with required note), and English + Hindi i18n` |
| **q** | Mock 112 gateway status shown and labeled `MOCK` | NOT COVERED initially → Fixed & Added | `apps/api/src/tests/phase6b_verification_gaps.test.ts` → `1. Duress resolve & invalid transition rejection (e, h, q)...` + `apps/web/src/tests/phase6b_verification_gaps.test.tsx` → `1. Verifies status filter (l), response timer stopping on acknowledge (m), duress banner "Silent alert: do not contact her directly." (n), and Mock 112 gateway status labeled MOCK (q)` |

---

## 3. Final Full Test Suite Totals (`/tmp/final.log`)

```text
 Test Files  16 passed (16)
      Tests  84 passed (84)
   Start at  06:52:03
   Duration  82.16s (tests 56%, environment 23%, import 19%, transform 2%)
```
