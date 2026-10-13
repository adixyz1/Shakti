# Phase 08C Report — Privacy Tools, Retention Purge & Emergency Data Policy

## 1. Personal Data Map (Task 1)

Every database table and column that holds personal data (names, phone numbers, locations, free-text notes, message bodies, recipient references, and tokens), what is stored in it, and what happens on account deletion (`DELETE /api/me`):

| Table | Personal Data Columns | What Is Stored | On Account Deletion (`DELETE /api/me`) | Why |
| :--- | :--- | :--- | :--- | :--- |
| `users` | `id`, `phone_e164`, `name`, `organization_zone`, `cancel_pin_hash`, `duress_pin_hash` | Account profile, phone number, display name, organization zone, and salted PBKDF2 PIN hashes. | **Deleted** (row removed from `users`). | Removes the user's account identity, phone number, name, and PIN hashes so she can no longer be identified or signed in. |
| `otp_codes` | `phone_e164`, `code_hash` | Pending 6-digit OTP verification hash for the user's phone number. | **Deleted** (rows matching the user's `phone_e164` removed; also auto-purged after expiry). | Prevents any leftover authentication codes tied to her phone number from remaining in the database. |
| `consents` | `user_id`, `type`, `granted`, `source`, `created_at` | Append-only consent ledger entries for the user. | **Deleted** (all rows with `user_id` removed). | Consent history belongs solely to the user and is no longer needed once her account and personal data are deleted. |
| `trusted_contacts` | `id`, `user_id`, `name`, `phone_e164`, `permissions`, `status` | Trusted contacts added by the user (their name, phone number, and sharing permissions). | **Deleted** (all rows with `user_id` removed). | Removes third-party contact names and phone numbers that the user uploaded. |
| `contact_invitations` | `contact_id`, `token_hash`, `accepted_at` | Signed invitation token hashes for the user's trusted contacts. | **Deleted** (all rows for the user's `contact_id`s removed; also auto-purged > 30 days after expiry). | Invalidates and removes all invitation tokens associated with her deleted trusted contacts. |
| `contact_incident_tokens` | `incident_id`, `contact_id`, `token_hash`, `expires_at` | Expiring magic-link token hashes scoped to one contact and one incident. | **Deleted** (all rows for the user's `incident_id`s and `contact_id`s removed; also auto-purged > 7 days after expiry). | Immediately revokes any emergency magic links for the user's incidents. |
| `location_samples` | `incident_id`, `lat`, `lng`, `accuracy_m`, `captured_at`, `expires_at` | GPS coordinates and accuracy captured during an active alert (with active `location` consent). | **Deleted** (all rows for the user's `incident_id`s removed; also auto-purged when `expires_at <= now`). | Ensures no location trail or coordinates remain for the deleted user. |
| `journeys` | `id`, `user_id`, `contact_id`, `note`, `started_at`, `ends_at`, `status` | Safe Journey check-in timers, chosen contact reference, and optional free-text `note` (up to 100 chars). | **Deleted** (all rows with `user_id` removed and any active timers cancelled; free-text `note` is also auto-cleared 7 days after journey ends). | Removes the user's check-in history and free-text notes completely. |
| `sent_messages` (dev outbox) | `to_phone_e164`, `body`, `metadata` (may contain `incident_id`, `journeyId`, `contact_id`, `inviter_name`, `contact_name`, `lat`, `lng`, `token`) | Mock SMS outbox records created in development/test environments for OTPs, invitations, SOS alerts, and journey lapses. | **Deleted** (all rows linked to the user's `phone_e164`, her contacts' `phone_e164`, her `incident_id`s, `journeyId`s, or `contact_id`s removed; also auto-purged after 7 days). | Scrubs development outbox message bodies, phone numbers, coordinates, and tokens related to the user. |
| `incidents` | `id`, `user_id`, `status`, `emergency_type`, `client_request_id`, `client_created_at`, `queued_offline`, `created_at`, `activated_at`, `closed_at`, `source_trigger`, `is_duress` | Emergency incident state and timestamps. | **Anonymized & Retained** (`user_id` set to `'deleted_user'`; `client_request_id` replaced with an unlinked random UUID; timestamps and status transitions kept). | Preserves honest, aggregated system-level safety metrics (alert-initiation time, time to active, cancellation/false-alarm rates) without linking any incident to a person. |
| `incident_events` | `incident_id`, `from_status`, `to_status`, `actor_type`, `actor_id`, `note`, `created_at` | Immutable state-machine transition log for each incident. | **Anonymized & Retained** (`actor_id` set to `NULL` and free-text `note` set to `NULL` for all events on the user's incidents; status transition and `created_at` retained). | Keeps state transition timestamps for aggregated response/resolution metrics and state-machine integrity while scrubbing all personal notes, names, and actor IDs. |
| `notifications` | `incident_id`, `recipient_type`, `recipient_ref`, `channel`, `status`, `attempts`, `last_error`, `created_at` | Notification dispatch records per channel (`push`, `sms`, `gateway`). | **Anonymized & Retained** (`recipient_ref` set to `'redacted'` and `last_error` set to `NULL` for the user's incidents; `channel`, `recipient_type`, `status`, and `created_at` retained). | Preserves honest notification delivery rate metrics per channel without retaining recipient references or error strings that could contain phone numbers. |
| `incident_assignments` | `incident_id`, `responder_id`, `responder_user_id`, `organization_zone`, `assigned_by_user_id`, `acknowledged_at`, `created_at` | Routing and acknowledgement records linking an incident to campus/community responders. | **Anonymized & Retained** (if a responder/admin deletes her own account, `responder_user_id` / `assigned_by_user_id` is set to `'deleted_user'`; timestamps retained). | Preserves responder acknowledgement metrics and routing audit integrity without retaining personal linkage to a deleted user. |
| `incident_access_audit` (`auditLog`) | `incident_id`, `actor_type`, `actor_id`, `actor_label`, `action`, `detail`, `created_at` | Immutable access audit log recording who viewed or acted on an incident (contacts, responders, admins). | **Anonymized & Retained** (for the user's incidents, `actor_id` is set to `'redacted'`, `actor_label` set to `NULL`, and `detail` set to `NULL` while keeping `incident_id`, `actor_type`, `action`, and `created_at` so audit completeness remains verifiable). | Preserves tamper-evident audit completeness (`responder_view_incident` / `contact_link_open`) while scrubbing contact/user names and free-text details. |
| `reports` | `id`, `category`, `lat` (3-decimal ~100 m grid), `lng` (3-decimal ~100 m grid), `note`, `anonymous`, `user_id`, `created_at` | Non-emergency safety reports (~100 m grid cell, optional note). Anonymous reports already store `user_id = NULL` and date-only `created_at`. | **Anonymized & Retained** (for any non-anonymous report where `user_id` matches the user: `user_id` set to `NULL`, `anonymous` set to `true`, `note` set to `NULL`, and `created_at` truncated to `YYYY-MM-DD`). | Unlinks the report from the user and strips any free-text note while preserving the ~100 m grid-cell count for the community safety layer. |
| `safety_pulses` | `id`, `user_id`, `safety_score`, `avoided_going_somewhere`, `created_at` | Weekly 2-question safety pulse responses. Anonymous pulses already store `user_id = NULL` and date-only `created_at`. | **Anonymized & Retained** (for any non-anonymous pulse where `user_id` matches the user: `user_id` set to `NULL` and `created_at` truncated to `YYYY-MM-DD`). | Unlinks the pulse from the user while preserving weekly aggregated safety scores and % avoided metrics. |
| `post_incident_ratings` | `incident_id`, `score`, `created_at` | Optional 1–5 post-incident rating (already stores no `user_id`, no notes, and no identity). | **Retained** (already anonymous; parent `incidents.user_id` is anonymized to `'deleted_user'`). | Preserves aggregated post-incident rating average with zero personal linkage. |
| `responders` | `id`, `user_id`, `organization_zone`, `active`, `on_duty` | Responder duty status row linked to a responder's `user_id`. | **Deleted** (if a responder deletes her account, her `responders` row is removed). | Removes responder duty profile for a deleted account. |
| `resources` | `id`, `name`, `category`, `phone`, `description`, `available_hours`, `active` | Public helpline and support directory entries (e.g., 112, 181, One Stop Centre, Campus Security). | **Retained (Not User Data)** | System-wide public helpline directory; contains no user personal data. |

---

## 2. What Was Implemented (Tasks 2–5)

### Task 2 — Data Export (`GET /api/me/export`)
- Returns a downloadable JSON payload (`Content-Disposition: attachment`) containing **only** the signed-in user's own data:
  - `profile`: id, phone_e164, name, role, language, organization_zone, cancel_window_seconds, `has_cancel_pin`, `has_duress_pin`, created_at.
  - `consent_ledger`: current state map and full append-only history.
  - `contacts`: contacts she added (`id`, `name`, `phone_e164`, `priority`, `status`, `permissions`, `created_at`).
  - `incidents`: her incidents and events **as she sees them** — duress masking applies (`is_duress = true` incidents appear `CANCELLED` with `is_duress` omitted and responder/post-cancel internal events hidden).
  - `journeys`: her Safe Journey walk timers.
  - `reports`: her own non-anonymous community reports (`anonymous = false`).
  - `pulses`: her own non-anonymous weekly safety pulses (`user_id = user.id`).
- **Never includes**: PIN hashes, invitation or magic-link token hashes, responder notes, access audit logs, or any other user's data.

### Task 3 — Account Deletion (`DELETE /api/me`) & Retention Purge
- **Re-authentication & Confirmation**: Requires `confirmation === "DELETE"` AND a **fresh 6-digit OTP code (`otp_code`) ONLY** for the user's phone number. Attempting to use `cancel_pin` is rejected with `400`.
- **Open-Incident Refusal (Genuine & Duress)**: If the user has any open incident (`TRIGGERED`, `CREATED`, `CANCEL_WINDOW`, `ACTIVE`, `ESCALATED`, `ACKNOWLEDGED`, or any `is_duress = true` incident not yet `RESOLVED` or `FALSE_ALARM`), deletion is refused with HTTP `409` and the exact same neutral message: `"Account deletion isn't available right now. Try again later."`
- **Single-Transaction Deletion & Anonymization**:
  - Deletes: `users`, `otp_codes`, `consents`, `trusted_contacts`, `contact_invitations`, `contact_incident_tokens`, `location_samples`, `journeys`, `responders` (if any), and matching `sent_messages` (dev outbox).
  - Anonymizes: `incidents` (`user_id = 'deleted_user'`, randomized `client_request_id`), `incident_events` (`actor_id = NULL`, `note = NULL`), `notifications` (`recipient_ref = 'redacted'`, `last_error = NULL`), `incident_access_audit` (`actor_id = 'redacted'`, `actor_label = NULL`, `detail = NULL`), `reports` (`user_id = NULL`, `anonymous = true`, `note = NULL`, `created_at` truncated to `YYYY-MM-DD`), and `safety_pulses` (`user_id = NULL`, `created_at` truncated to `YYYY-MM-DD`).
  - Clears auth cookies (`saathi_access_token`, `saathi_refresh_token`) so both `/api/me` and `/api/auth/refresh` immediately return `401`.
- **Retention Purge (`runLocationRetentionPurge`)**:
  - `location_samples` with `expires_at <= now` deleted.
  - `contact_incident_tokens` expired > 7 days deleted.
  - `contact_invitations` expired > 30 days deleted.
  - `journeys.note` cleared to `NULL` 7 days after journey ends (`ends_at <= now - 7d`).
  - `otp_codes` with `expires_at <= now` deleted.
  - `sent_messages` (dev outbox) older than 7 days deleted.

### Task 4 — Privacy Tools UI (`/settings`)
- Added bilingual (English + Hindi) **Privacy Tools & Your Data** section in `/settings`:
  1. **Download my data (JSON)**: triggers `GET /api/me/export` and downloads `saathi-my-data-YYYY-MM-DD.json`.
  2. **Clear local data on this device**: clears IndexedDB (`saathi_offline_db`), `localStorage`, `sessionStorage`, and Service Worker Cache Storage without deleting the server account.
  3. **Delete my account**: requires re-authenticating with a **fresh 6-digit OTP code ONLY** and typing `DELETE` in capital letters, calls `DELETE /api/me`, clears local device data (`IndexedDB` queue, contact cache, `localStorage`, `sessionStorage`, and Service Worker `CacheStorage`), and navigates to `/login`.

### Task 5 — Emergency Data Policy (`/policy`) & Policy-vs-Code Verification
- Public bilingual (English + Hindi) page at `/policy` with 5 clear sections matching the actual code:
  1. What SAATHI collects — and only when.
  2. Who can see your data — and under which consent.
  3. How long each item is kept (retention schedule).
  4. What happens when you revoke consent or delete your account.
  5. What SAATHI never does (no background tracking, never replaces 112/181 or claims guaranteed police arrival).
- Linked from Onboarding (`/onboarding`), Consent Center (`/consents`), Settings (`/settings`), and the global footer (`PageLayout`).

#### Policy-vs-Code Mismatches Found and Fixed / Sentence-by-Sentence Audit
1. **Mismatch found and fixed in Section 4 (`policy.section4Items.delete`)**: The initial policy sentence did not explicitly state that account deletion requires a fresh 6-digit OTP code + typing `DELETE` and is refused while an incident is open. Updated both `en.json` and `hi.json` (`policy.section4Items.delete`) and `privacyService.ts` / `SettingsPage.tsx` so policy and code match 100%.
2. **Checked Section 1 (`policy.section1Items.*`) against `schema.ts`, `incidentService.ts`, `journeyService.ts`, `reportService.ts`, `resourcePulseService.ts`**:
   - Account stores phone, name, language, organization zone, and salted PBKDF2 PIN hashes (`users` table).
   - Consent ledger is append-only (`consents` table, `consentService.ts`).
   - Trusted circle is capped at 5 contacts (`MAX_CONTACTS_PER_USER = 5` in `contactService.ts`).
   - Location samples are stored only while an alert is open AND `location` consent is granted (`addIncidentLocationSample` in `incidentService.ts`).
   - Safe Journeys store start/end times and optional note (`<= 100` chars) and never collect location (`journeyService.ts`).
   - Anonymous reports and pulses store `userId = null` and `createdAt = YYYY-MM-DD` (`reportService.ts`, `resourcePulseService.ts`).
3. **Checked Section 2 (`policy.section2Items.*`) against `notificationDispatcher.ts`, `contactIncidentTokenService.ts`, `responderService.ts`, `metricsService.ts`, `reportService.ts`**:
   - Contacts are notified only when `data_processing` consent is granted, `status === 'accepted'`, and the specific permission flag is true; live location requires both `location` consent and `can_see_live_location`.
   - Responders see first name, emergency category, and latest location (if `location` consent is granted); victim phone is hidden (`user_phone_e164: null`) until a responder acknowledges (`responderService.ts`).
   - Admin metrics enforce `MINIMUM_SAMPLE_SIZE = 5` (`metricsService.ts`), and public safety-layer grid cells enforce `k >= 5` (`reportService.ts`).
4. **Checked Section 3 (`policy.section3Items.*`) against `retentionService.ts`**:
   - `location_samples` purged when `expires_at <= now` (7 days default via `LOCATION_RETENTION_DAYS`).
   - `contact_incident_tokens` purged > 7 days after `expires_at`.
   - `contact_invitations` purged > 30 days after `expires_at`.
   - `journeys.note` cleared to `NULL` > 7 days after `ends_at`.
   - `otp_codes` purged when `expires_at <= now`, and `sent_messages` purged > 7 days after `created_at`.
5. **Checked Section 5 (`policy.section5Items.*`) against service worker (`vite.config.ts`), `offlineQueue.ts`, and `journeyService.ts`**:
   - No background location tracking, no Background Sync registration, and no guaranteed police arrival claims anywhere in the codebase.

---

## 3. Verification & Requirement-to-Test Map

| Requirement | Test Name | File |
| :--- | :--- | :--- |
| **a.** Export contains only the user's own data; no hashes, tokens, PIN data | `1. GET /api/me/export: returns ONLY the signed-in user data, applies duress masking (duress incident appears CANCELLED), excludes anonymous reports/pulses, and never leaks PIN hashes, tokens, or responder notes` | `apps/api/src/tests/phase8c_privacy.test.ts` |
| **b.** A duress incident appears as cancelled in the export | `1. GET /api/me/export: returns ONLY the signed-in user data, applies duress masking (duress incident appears CANCELLED), excludes anonymous reports/pulses, and never leaks PIN hashes, tokens, or responder notes` | `apps/api/src/tests/phase8c_privacy.test.ts` |
| **c.** Delete requires a fresh OTP (OTP ONLY) | `2. DELETE /api/me: requires a fresh OTP ONLY (rejects Cancel PIN) and confirmation="DELETE", deletes all personal rows in one transaction, passes a full 17-table PII scan, leaves a second user untouched, and invalidates sessions` | `apps/api/src/tests/phase8c_privacy.test.ts` |
| **d.** Delete is refused for an open GENUINE incident | `3. DELETE /api/me is refused when the user has an open GENUINE incident or an open DURESS incident, returning the exact same 409 status and neutral message` | `apps/api/src/tests/phase8c_privacy.test.ts` |
| **e.** Delete is refused for an open DURESS incident, with the SAME message and HTTP status as (d) | `3. DELETE /api/me is refused when the user has an open GENUINE incident or an open DURESS incident, returning the exact same 409 status and neutral message` | `apps/api/src/tests/phase8c_privacy.test.ts` |
| **f.** After successful deletion a PII SCAN of every table finds no trace of her phone number, her name, or her contacts' phone numbers (or a documented retained anonymized field) | `2. DELETE /api/me: requires a fresh OTP ONLY (rejects Cancel PIN) and confirmation="DELETE", deletes all personal rows in one transaction, passes a full 17-table PII scan, leaves a second user untouched, and invalidates sessions` | `apps/api/src/tests/phase8c_privacy.test.ts` |
| **g.** A second user's data is untouched | `2. DELETE /api/me: requires a fresh OTP ONLY (rejects Cancel PIN) and confirmation="DELETE", deletes all personal rows in one transaction, passes a full 17-table PII scan, leaves a second user untouched, and invalidates sessions` | `apps/api/src/tests/phase8c_privacy.test.ts` |
| **h.** Her sessions are invalid after deletion | `2. DELETE /api/me: requires a fresh OTP ONLY (rejects Cancel PIN) and confirmation="DELETE", deletes all personal rows in one transaction, passes a full 17-table PII scan, leaves a second user untouched, and invalidates sessions` | `apps/api/src/tests/phase8c_privacy.test.ts` |
| **i.** Client caches (IndexedDB queue, contact cache, local settings, service worker caches) are cleared on delete | `1. Settings Privacy Tools: Download my data, Clear local data, and Delete my account (requires fresh OTP ONLY + DELETE confirmation, and clears IndexedDB queue, contact cache, localStorage, sessionStorage, and service worker CacheStorage)` | `apps/web/src/tests/phase8c_privacy_ui.test.tsx` |
| **j.** Policy page renders in English and Hindi | `2. Emergency Data Policy page (/policy): renders all 5 sections in English + Hindi and is linked from Onboarding, Consent Center, Settings, and Footer` | `apps/web/src/tests/phase8c_privacy_ui.test.tsx` |

### Tables Covered by the Post-Deletion PII Scan (Requirement f)
`users`, `otp_codes`, `consents`, `trusted_contacts`, `contact_invitations`, `contact_incident_tokens`, `incidents`, `incident_events`, `location_samples`, `notifications`, `sent_messages`, `responders`, `incident_assignments`, `incident_access_audit` (`audit_log`), `journeys`, `reports`, `resources`, `safety_pulses`, and `post_incident_ratings`.

---

## 4. What the Next Phase Can Rely On
- `GET /api/me/export` and `DELETE /api/me` (fresh OTP only + `"DELETE"` confirmation, neutral `409` refusal on open genuine or duress incidents, full 17-table PII scrub) are live and tested end-to-end.
- `runLocationRetentionPurge(db, nowMs)` purges expired location samples, magic-link tokens (>7d), contact invitations (>30d), journey notes (>7d), expired OTPs, and dev outbox messages (>7d).
- `/policy` is publicly accessible in English and Hindi and linked across Onboarding, Consent Center, Settings, and the footer.
- Full test suite: `Test Files  28 passed (28) | Tests  129 passed (129)`.

