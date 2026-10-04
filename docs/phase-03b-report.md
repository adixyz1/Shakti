# Phase 03B Report: Notifications, Escalation and Realtime (Backend Only, Part 2 of 2)

## 1. Pre-Phase Fix: Salted Scrypt PIN Hashing & PIN Rate Limiting

1. **Slow Salted Async Scrypt PIN Hashing (`apps/api/src/core/security.ts`)**:
   - Replaced HMAC-SHA256 PIN hashing with non-blocking async `crypto.scrypt` (`N=16384, r=8, p=1`, 64-byte key length) using a random 16-byte per-PIN salt (`scrypt$<randomSalt>$<derivedKey>`), verified via `crypto.timingSafeEqual`.
2. **Per-Incident PIN Attempt Rate Limit (`POST /api/incidents/:id/cancel`)**:
   - Added `pin_attempts` column on `incidents`. After `PIN_MAX_ATTEMPTS_PER_INCIDENT` (default `5`) wrong PIN attempts on an incident, all subsequent PIN attempts on that incident are rejected with the exact same `400 Bad Request` (`{ detail: "Invalid PIN." }`) response shape without revealing that a rate limit or lockout exists.
3. **PIN Settings Endpoint Rate Limit (`PUT /api/settings/cancel-pin`, `PUT /api/settings/duress-pin`)**:
   - Added `pinSettingsRateLimitMiddleware` (`PIN_SETTINGS_RATE_LIMIT_PER_MINUTE`, default `10` requests/minute per user) returning `429 Too Many Requests` when exceeded.

---

## 2. What Was Built in Phase 3B

1. **Provider Interfaces & Mocks (`apps/api/src/providers/`)**:
   - `push.ts`: `PushProvider` interface + `MockPushProvider` (records sent pushes in memory and supports simulated failure modes).
   - `emergencyGateway.ts`: `EmergencyServiceGateway` interface + `MockEmergencyGateway` (records mock 112 escalation requests and supports `accept`, `reject`, and `throw` simulation modes).
   - `sms.ts`: Reused `SmsProvider` + `MockSmsProvider` from Phase 2, extended with simulated failure toggle for resilience testing.
   - `assist.ts`: `AssistProvider` interface + `NoopAssistProvider` default (`ENABLE_AI_ASSIST=false`). Verified that the SOS path (`incidentService.ts`, `notificationDispatcher.ts`, `scheduler.ts`) never imports or calls `AssistProvider`.
2. **Notifications Schema & New Versioned Migration (`0004_heavy_living_lightning.sql`)**:
   - Added `notifications` table: `id`, `incident_id`, `recipient_type` (`contact | responder | gateway_112`), `recipient_ref`, `channel` (`push | sms | gateway`), `status` (`queued | sent | delivered | failed`), `attempts`, `last_error`, `created_at`.
   - Added incident columns on `incidents`: `pin_attempts` (default `0`), `needs_user_action` (boolean, default `false`), and `escalation_stage` (integer, default `0`).
3. **Notification Dispatcher (`apps/api/src/services/notificationDispatcher.ts`)**:
   - Queries eligible contacts strictly via `getNotifiableContacts(userId, 'sos')` in priority order.
   - Includes coordinates only if the user has active `location` consent, a location sample exists, and the contact is eligible under `getNotifiableContacts(userId, 'live_location')`; otherwise sends the SOS alert without coordinates.
   - Dispatches `push` and `sms` independently with configurable retry + exponential backoff (`NOTIFICATION_MAX_ATTEMPTS=3`, `NOTIFICATION_RETRY_BASE_DELAY_MS=50`), logging every attempt in `notifications`.
   - Transitions the incident `ACTIVE -> NOTIFIED` when at least one notification is handed to a provider (`status === 'sent'`). Duress incidents (`is_duress = true`) dispatch identically to normal incidents.
4. **Escalation Ladder & Crash-Safe Scheduler (`apps/api/src/services/scheduler.ts`)**:
   - `t = 0` (upon `ACTIVE`): Notifies priority #1 eligible contact.
   - `t = N` seconds (`ESCALATION_STEP1_DELAY_SECONDS`, default `30s`) with no acknowledgement: Notifies remaining eligible contacts (`2..5`) and advances `escalation_stage = 1`.
   - `t = M` seconds (`ESCALATION_STEP2_DELAY_SECONDS`, default `60s`) with still no acknowledgement: Sets `needs_user_action = true` and `escalation_stage = 2` on the incident, and dispatches the `MockEmergencyGateway` (`112_erss`) request.
   - `recoverPendingIncidentsOnStartup()` resumes both `TRIGGERED` and unacknowledged `ACTIVE` / `NOTIFIED` incidents on server restart, checking existing `notifications` rows so already-sent notifications are never duplicated.
5. **Realtime Incident WebSocket (`apps/api/src/services/wsHub.ts`)**:
   - Added authenticated, owner-only WebSocket endpoint `/ws/incidents/:id` (and `/api/ws/incidents/:id`).
   - Rejects unauthenticated (`401`) or non-owner (`403`) connections.
   - Reconnect-safe: immediately sends `{ type: 'incident_state', incident }` on connect, then pushes `{ type: 'incident_updated', incident }` on every state change while preserving full owner duress masking (`status: 'CANCELLED'`, `needs_user_action: false`, `escalation_stage: 0`, `notifications: []`, and hiding post-duress escalation events from the owner view while responders/contacts/audit see real values).
6. **Location Retention Purge Job (`apps/api/src/services/retentionService.ts`)**:
   - `runLocationRetentionPurge(db, nowMs)` deletes only expired rows from `location_samples` (`expires_at <= nowMs`).
   - Scheduled automatically on server startup via `startRetentionPurgeSchedule()` and directly callable in tests.

---

## 3. Files Created / Changed

### Created
- `apps/api/src/db/migrations/0003_panoramic_stick.sql`
- `apps/api/src/db/migrations/0004_heavy_living_lightning.sql`
- `apps/api/src/providers/push.ts`
- `apps/api/src/providers/emergencyGateway.ts`
- `apps/api/src/providers/assist.ts`
- `apps/api/src/services/notificationDispatcher.ts`
- `apps/api/src/services/retentionService.ts`
- `apps/api/src/tests/phase3b_notifications_escalation.test.ts`
- `docs/phase-03b-report.md`

### Updated
- `apps/api/src/db/schema.ts`
- `apps/api/src/core/config.ts`
- `apps/api/src/core/security.ts`
- `apps/api/src/core/middleware.ts`
- `apps/api/src/schemas/incident.ts`
- `apps/api/src/services/incidentService.ts`
- `apps/api/src/services/scheduler.ts`
- `apps/api/src/services/wsHub.ts`
- `apps/api/src/routes/incidents.ts`
- `apps/api/server.ts`
- `apps/api/src/tests/phase3a_incidents.test.ts`

---

## 4. Commands to Run

- **Run Phase 3A & 3B Backend Tests:**
  ```bash
  npx vitest run apps/api/src/tests/phase3a_incidents.test.ts apps/api/src/tests/phase3b_notifications_escalation.test.ts --reporter=verbose
  ```
- **Run Full Test Suite (All Phases):**
  ```bash
  npm test
  ```

---

## 5. Real Test Output

```text
 RUN  v5.0.3 /app/applet

 ✓ apps/api/src/tests/phase3a_incidents.test.ts > SAATHI Phase 3A API Tests (SOS Engine Core, State Machine, Duress, Scheduler & Consent Rules) > Fix 1: seeds demo user with data_processing consent and exposes notifiable_contacts_count on contacts and incidents APIs 211ms
 ✓ apps/api/src/tests/phase3a_incidents.test.ts > SAATHI Phase 3A API Tests (SOS Engine Core, State Machine, Duress, Scheduler & Consent Rules) > allows SOS incident creation with no location consent and zero contacts 62ms
 ✓ apps/api/src/tests/phase3a_incidents.test.ts > SAATHI Phase 3A API Tests (SOS Engine Core, State Machine, Duress, Scheduler & Consent Rules) > transitions TRIGGERED -> ACTIVE after cancel window and rejects cancellation after window 1212ms
 ✓ apps/api/src/tests/phase3a_incidents.test.ts > SAATHI Phase 3A API Tests (SOS Engine Core, State Machine, Duress, Scheduler & Consent Rules) > cancels an incident inside the cancel window (plain cancel when no PIN configured) and records the CANCELLED event 48ms
 ✓ apps/api/src/tests/phase3a_incidents.test.ts > SAATHI Phase 3A API Tests (SOS Engine Core, State Machine, Duress, Scheduler & Consent Rules) > handles idempotent create and merges duplicate triggers within the 3-minute window 60ms
 ✓ apps/api/src/tests/phase3a_incidents.test.ts > SAATHI Phase 3A API Tests (SOS Engine Core, State Machine, Duress, Scheduler & Consent Rules) > Fix 2: enforces all 4 PIN cases when duress PIN and cancel PIN are configured (no PIN -> rejected, wrong PIN -> rejected, cancel PIN -> really cancels, duress PIN -> identical 200 CANCELLED response while incident continues) 1708ms
 ✓ apps/api/src/tests/phase3a_incidents.test.ts > SAATHI Phase 3A API Tests (SOS Engine Core, State Machine, Duress, Scheduler & Consent Rules) > Fix 3: for incidents with is_duress = true, owner-facing REST and WebSocket responses present status as CANCELLED while responders, contacts, and audit log see the real status 1516ms
 ✓ apps/api/src/tests/phase3a_incidents.test.ts > SAATHI Phase 3A API Tests (SOS Engine Core, State Machine, Duress, Scheduler & Consent Rules) > enforces state machine transitions, rejects invalid transitions, and records location samples + resolution 84ms
 ✓ apps/api/src/tests/phase3a_incidents.test.ts > SAATHI Phase 3A API Tests (SOS Engine Core, State Machine, Duress, Scheduler & Consent Rules) > resumes TRIGGERED incidents after simulated server restart via recoverPendingIncidentsOnStartup 269ms
 ✓ apps/api/src/tests/phase3a_incidents.test.ts > SAATHI Phase 3A API Tests (SOS Engine Core, State Machine, Duress, Scheduler & Consent Rules) > stores PINs with a slow salted scrypt hash and rate-limits PIN attempts (5 wrong attempts per incident then rejects further attempts with identical 400 Invalid PIN response, plus rate-limits PIN settings endpoints) 1193ms
 ✓ apps/api/src/tests/phase3b_notifications_escalation.test.ts > SAATHI Phase 3B API Tests (Notifications, Escalation, Realtime WebSockets & Retention Purge) > 1. Happy path: create -> ACTIVE -> NOTIFIED -> resolve, with notification rows and deterministic non-AI path 1402ms
 ✓ apps/api/src/tests/phase3b_notifications_escalation.test.ts > SAATHI Phase 3B API Tests (Notifications, Escalation, Realtime WebSockets & Retention Purge) > 2. Cancel inside the window creates zero notifications 1279ms
 ✓ apps/api/src/tests/phase3b_notifications_escalation.test.ts > SAATHI Phase 3B API Tests (Notifications, Escalation, Realtime WebSockets & Retention Purge) > 3. Only eligible contacts are notified; revoked consent excludes immediately; no-location-consent alert notifies without coordinates; duress incidents notify normally 2778ms
 ✓ apps/api/src/tests/phase3b_notifications_escalation.test.ts > SAATHI Phase 3B API Tests (Notifications, Escalation, Realtime WebSockets & Retention Purge) > 4. Escalation ladder fires on no acknowledgement (t=0 contact 1 -> t=N remaining contacts -> t=M needs_user_action + mock 112 gateway) and resumes after simulated restart without duplicate sends 550ms
 ✓ apps/api/src/tests/phase3b_notifications_escalation.test.ts > SAATHI Phase 3B API Tests (Notifications, Escalation, Realtime WebSockets & Retention Purge) > 5 & 8. One provider failing does not stop the others, and the whole flow passes even when ALL providers fail/reject 1027ms
 ✓ apps/api/src/tests/phase3b_notifications_escalation.test.ts > SAATHI Phase 3B API Tests (Notifications, Escalation, Realtime WebSockets & Retention Purge) > 6. WebSocket /ws/incidents/:id: sends current state on connect, pushes state changes to owner, and rejects a different user with 403 1337ms
 ✓ apps/api/src/tests/phase3b_notifications_escalation.test.ts > SAATHI Phase 3B API Tests (Notifications, Escalation, Realtime WebSockets & Retention Purge) > 7. Retention purge job deletes expired location_samples only and keeps unexpired samples 45ms

 Test Files  2 passed (2)
      Tests  17 passed (17)
```

---

## 6. Assumptions

1. **Per-Contact Channel Idempotency on Restart**: `alreadyDispatchedChannel(db, incidentId, recipientType, recipientRef, channel)` checks if a `notifications` row already exists for that `(incident_id, recipient_type, recipient_ref, channel)` tuple before dispatching, guaranteeing that server restart recovery never sends duplicate alerts to contacts who were already notified.
2. **Escalation Timers**: Configurable via `ESCALATION_STEP1_DELAY_SECONDS` (default `30s`) and `ESCALATION_STEP2_DELAY_SECONDS` (default `60s`), and overridable in tests.
3. **All Providers Down Behavior**: When every external provider (`PushProvider`, `SmsProvider`, `EmergencyServiceGateway`) fails, each channel retries up to `NOTIFICATION_MAX_ATTEMPTS` (`3`) and logs `status = 'failed'` with `last_error`. The incident remains `ACTIVE` with `needs_user_action = true` so the frontend can immediately prompt a 1-tap Call 112/181 fallback, and the user can still resolve the incident deterministically.

---

## 7. Known Issues
- None in Phase 3B scope.

---

## 8. What Phase 4 Can Rely On
- Complete SOS backend (`POST /api/incidents`, `GET /api/incidents/active`, `GET /api/incidents/:id`, `POST /api/incidents/:id/cancel`, `POST /api/incidents/:id/location`, `POST /api/incidents/:id/type`, `POST /api/incidents/:id/resolve`, `PUT /api/settings/cancel-window`, `PUT /api/settings/cancel-pin`, `PUT /api/settings/duress-pin`).
- Hydrated incident responses including `events`, `locations`, `notifications`, `needs_user_action`, `escalation_stage`, and `notifiable_contacts_count`.
- Reconnect-safe, owner-authenticated WebSocket stream at `/ws/incidents/:id` (with automatic duress masking).
