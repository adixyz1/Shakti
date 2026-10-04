# Phase 03A Report: SOS Engine Core (Backend Only, Part 1 of 2)

## 1. Pre-Phase Confirmation & `getNotifiableContacts` Consent Fix

### A. `GET /api/invitations/:token` Privacy Confirmation
Verified in `apps/api/src/services/contactService.ts` (`getInvitationDetailsByToken`) that `GET /api/invitations/:token` returns **only**:
- `inviter_name`
- `contact_name`
- `permissions` (`{ receives_sos, receives_checkin, can_see_live_location }`)
- `status` (`pending | accepted | declined | expired`)
- `expires_at`
It never returns the inviter's phone number, user ID, or any other contact's details.

### B. `getNotifiableContacts(userId, purpose)` Before vs. After
- **Previous logic (Phase 2):**
  ```ts
  const latestDataProcessing = ledgerRows.find((r) => r.type === 'data_processing');
  if (latestDataProcessing && !latestDataProcessing.granted) {
    return [];
  }
  if (permissionKey === 'can_see_live_location') {
    const latestLocation = ledgerRows.find((r) => r.type === 'location');
    if (latestLocation && !latestLocation.granted) {
      return [];
    }
  }
  ```
  *Issue:* If `data_processing` had never been granted (`latestDataProcessing === undefined`), contacts were still returned instead of requiring an active `data_processing` consent.
- **Updated logic (Phase 3A):**
  ```ts
  // Active data_processing consent is required before notifying any contact
  const latestDataProcessing = ledgerRows.find((r) => r.type === 'data_processing');
  if (!latestDataProcessing || !latestDataProcessing.granted) {
    return [];
  }

  // Location consent is only checked when purpose is live_location
  if (permissionKey === 'can_see_live_location') {
    const latestLocation = ledgerRows.find((r) => r.type === 'location');
    if (!latestLocation || !latestLocation.granted) {
      return [];
    }
  }
  ```
  *Result:*
  1. For `purpose = 'sos'` (and `'checkin'`), a contact is eligible when `status === 'accepted'`, `receives_sos === true`, and the user has an active `data_processing` consent (`granted === true`).
  2. The user's `location` consent is **never** required to alert a contact for `sos` — a user with no `location` consent (or revoked `location` consent) still alerts their contacts (without location).
  3. Revoking `data_processing` (or never granting it) immediately returns `[]`.

---

## 2. What Was Built

1. **Schema & New Versioned Migration (`0002_cheerful_hannibal_king.sql`)**:
   - Added without modifying `0000_charming_kat_farrell.sql` or `0001_mixed_solo.sql`:
     - `incidents`: `id`, `user_id`, `status`, `emergency_type` (nullable), `client_request_id` (unique per user via `idx_incidents_user_client_request`), `created_at`, `activated_at`, `closed_at`, `merged_into_id`, `source_trigger`, `is_duress`.
     - `incident_events` (append-only): `id`, `incident_id`, `from_status` (nullable), `to_status`, `actor_type` (`user | contact | responder | system`), `actor_id`, `note`, `created_at`.
     - `location_samples`: `id`, `incident_id`, `lat`, `lng`, `accuracy_m`, `captured_at`, `expires_at`.
     - User settings columns on `users`: `cancel_window_seconds` (default `5`, allowed `0-10`) and `duress_pin_hash` (nullable HMAC-SHA256 hash).
2. **Transactional State Machine (`apps/api/src/services/incidentStateMachine.ts`)**:
   - Enforces the exact state graph from `PROJECT_BRIEF.md`:
     `TRIGGERED -> ACTIVE -> NOTIFIED -> ACKNOWLEDGED -> RESPONDING -> RESOLVED`
     with side exits `CANCELLED` (from `TRIGGERED` only), `FALSE_ALARM`, and `EXPIRED`.
   - Exposes `transition(incidentId, toStatus, actor, note, dbInstance)` which validates the transition and writes the `incidents` status update + immutable `incident_events` row inside the **same SQLite transaction**.
3. **In-Process Activation Scheduler (`apps/api/src/services/scheduler.ts`)**:
   - Automatically transitions `TRIGGERED -> ACTIVE` after the user's `cancel_window_seconds`.
   - `recoverPendingIncidentsOnStartup()` re-reads all `TRIGGERED` incidents on server boot and schedules their remaining activation window so a process restart never loses an alert.
4. **Core SOS Incident Service (`apps/api/src/services/incidentService.ts`)**:
   - **Always-allowed SOS creation**: Users can always create an incident regardless of consent toggles or having zero contacts. Location capture is included only if `location` consent is not revoked.
   - **Idempotency**: Duplicate `client_request_id` for the same user returns the existing incident (`200 OK`, `idempotent_replay: true`).
   - **Duplicate merge**: A new incident from the same user within the configurable duplicate window (`DUPLICATE_INCIDENT_WINDOW_SECONDS`, default 180s / 3 min) while one is open sets `merged_into_id`, records an audit event on both rows, and returns the existing open incident.
   - **Duress PIN**: Supplying the user's duress PIN to `POST /api/incidents/:id/cancel` returns a spoofed `200 OK` `CANCELLED` response while keeping the incident active in the database and setting `is_duress = true`. Supplying a wrong PIN returns `400 Bad Request` (`Invalid PIN.`), never revealing duress behavior.
   - **Location samples**: Stored only while the incident is open; when the incident transitions to a terminal state, `expires_at` is set to 7 days after incident closure (`LOCATION_RETENTION_DAYS=7`).

---

## 3. Table of New Phase 3A Endpoints

| Method | Path | Auth | Description |
| :--- | :--- | :--- | :--- |
| `POST` | `/api/incidents` | `requireAuth` | Creates a `TRIGGERED` incident (idempotent by `client_request_id`; merges into open incident if within 3-min window); exposes `notifiable_contacts_count` |
| `GET` | `/api/incidents/active` | `requireAuth` | Returns the authenticated user's currently open incident with `events`, `locations`, and `notifiable_contacts_count` (returns `incident: null` if `is_duress = true`) |
| `GET` | `/api/incidents/:id` | `requireAuth` | Returns a specific incident hydrated with `events`, `locations`, and `notifiable_contacts_count` (owner view masks `is_duress = true` as `CANCELLED`; responders see real status) |
| `POST` | `/api/incidents/:id/cancel` | `requireAuth` | Cancels a `TRIGGERED` incident inside the cancel window; enforces `cancel_pin_hash` vs `duress_pin_hash` when configured |
| `POST` | `/api/incidents/:id/location` | `requireAuth` | Appends a `location_samples` row (`lat`, `lng`, `accuracy_m`, `expires_at`) to an open incident |
| `POST` | `/api/incidents/:id/type` | `requireAuth` | Sets optional `emergency_type` on an incident and logs an `incident_events` row |
| `POST` | `/api/incidents/:id/resolve` | `requireAuth` | Resolves an open incident (`RESOLVED` or `FALSE_ALARM`) and updates location sample expiry to 7 days after close |
| `PUT` | `/api/settings/cancel-window` | `requireAuth` | Updates user's `cancel_window_seconds` (`0` to `10`, default `5`) |
| `PUT` | `/api/settings/cancel-pin` | `requireAuth` | Sets or clears user's real `cancel_pin_hash` (4-8 digit PIN, stored as HMAC-SHA256) |
| `PUT` | `/api/settings/duress-pin` | `requireAuth` | Sets or clears user's `duress_pin_hash` (4-8 digit PIN, stored as HMAC-SHA256) |

---

## 4. Files Created / Changed
- `apps/api/src/db/schema.ts`
- `apps/api/src/db/migrations/0002_cheerful_hannibal_king.sql`
- `apps/api/src/db/migrations/meta/_journal.json`, `apps/api/src/db/migrations/meta/0002_snapshot.json`
- `apps/api/src/core/config.ts`, `apps/api/src/core/security.ts`
- `apps/api/src/services/authService.ts`, `apps/api/src/services/contactService.ts`
- `apps/api/src/schemas/incident.ts`
- `apps/api/src/services/incidentStateMachine.ts`
- `apps/api/src/services/scheduler.ts`
- `apps/api/src/services/incidentService.ts`
- `apps/api/src/routes/incidents.ts`
- `apps/api/server.ts`
- `apps/api/src/tests/phase3a_incidents.test.ts`

---

## 5. Commands to Run
- **Run Phase 3A API Tests:**
  ```bash
  npx vitest run apps/api/src/tests/phase3a_incidents.test.ts --reporter=verbose
  ```
- **Run Full Test Suite (All Phases):**
  ```bash
  npm test
  ```

---

## 6. Real Test Output
```text
 ✓ apps/api/src/tests/phase3a_incidents.test.ts > SAATHI Phase 3A API Tests (SOS Engine Core, State Machine, Duress, Scheduler & Consent Rules) > Consent Rule: user with NO location consent still alerts contacts for sos; user who revoked data_processing alerts nobody
 ✓ apps/api/src/tests/phase3a_incidents.test.ts > SAATHI Phase 3A API Tests (SOS Engine Core, State Machine, Duress, Scheduler & Consent Rules) > allows SOS incident creation with no location consent and zero contacts
 ✓ apps/api/src/tests/phase3a_incidents.test.ts > SAATHI Phase 3A API Tests (SOS Engine Core, State Machine, Duress, Scheduler & Consent Rules) > transitions TRIGGERED -> ACTIVE after cancel window and rejects cancellation after window 1200ms
 ✓ apps/api/src/tests/phase3a_incidents.test.ts > SAATHI Phase 3A API Tests (SOS Engine Core, State Machine, Duress, Scheduler & Consent Rules) > cancels an incident inside the cancel window and records the CANCELLED event 54ms
 ✓ apps/api/src/tests/phase3a_incidents.test.ts > SAATHI Phase 3A API Tests (SOS Engine Core, State Machine, Duress, Scheduler & Consent Rules) > handles idempotent create and merges duplicate triggers within the 3-minute window 46ms
 ✓ apps/api/src/tests/phase3a_incidents.test.ts > SAATHI Phase 3A API Tests (SOS Engine Core, State Machine, Duress, Scheduler & Consent Rules) > enforces duress PIN: wrong PIN returns 400, duress PIN returns normal-looking CANCELLED response while keeping incident active with is_duress=true 1220ms
 ✓ apps/api/src/tests/phase3a_incidents.test.ts > SAATHI Phase 3A API Tests (SOS Engine Core, State Machine, Duress, Scheduler & Consent Rules) > enforces state machine transitions, rejects invalid transitions, and records location samples + resolution 90ms
 ✓ apps/api/src/tests/phase3a_incidents.test.ts > SAATHI Phase 3A API Tests (SOS Engine Core, State Machine, Duress, Scheduler & Consent Rules) > resumes TRIGGERED incidents after simulated server restart via recoverPendingIncidentsOnStartup 318ms

 Test Files  6 passed (6)
      Tests  26 passed (26)
```

---

## 7. Assumptions
1. **Duress Response Spoofing**: When the valid duress PIN is submitted to `POST /api/incidents/:id/cancel`, the HTTP response returns `200 OK` with `status: 'CANCELLED'` and `is_duress: false` in the response payload so a coercer watching the screen cannot detect duress, while the database record remains open (`TRIGGERED` -> `ACTIVE`) with `is_duress = true`.
2. **Duplicate Window**: Defaults to 180 seconds (`DUPLICATE_INCIDENT_WINDOW_SECONDS=180`).
3. **Location Retention**: Location samples receive a 7-day retention timestamp (`LOCATION_RETENTION_DAYS=7`) which is refreshed to `closed_at + 7 days` when the incident reaches a terminal state.

---

## 8. Known Issues
- None in Phase 3A scope.

---

## 9. What Phase 3B Can Rely On
- `transition(incidentId, toStatus, actor, note)` in `apps/api/src/services/incidentStateMachine.ts` for all incident state transitions.
- `scheduler.ts` (`scheduleIncidentActivation`, `recoverPendingIncidentsOnStartup`) ready to hook into Phase 3B notification dispatch, escalation ladders, and acknowledgement timers.
- `getNotifiableContacts(userId, 'sos')` and `getNotifiableContacts(userId, 'live_location')` in `apps/api/src/services/contactService.ts`.
