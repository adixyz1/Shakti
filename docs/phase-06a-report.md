# Phase 6A Report — Trusted Contact Experience, Magic Links & Duress-Aware Response

## 1. Code Verification Checklist (Yes / No with File & Line References)

| # | Requirement | Status | File & Line References |
|---|---|---|---|
| **a** | Disguise mode sequence uses PBKDF2 (WebCrypto, `>= 200000` iterations, random salt) with minimum length of 6, NOT salted SHA-256 | **YES** | `apps/web/src/store/triggerSettingsStore.ts:8` (`DISGUISE_PBKDF2_ITERATIONS = 200000`), `:9` (`MIN_DISGUISE_SEQUENCE_LENGTH = 6`), `:43-90` (`hashDisguiseSequence` using `window.crypto.subtle.importKey(..., 'PBKDF2', ...)` and `deriveBits({ name: 'PBKDF2', salt: saltBytes, iterations, hash: 'SHA-256' }, keyMaterial, 256)`), `:92-129` (`verifyDisguiseSequenceHash`), `:193-207` (`setDisguiseSequence` generates 16-byte random salt via `window.crypto.getRandomValues(new Uint8Array(16))` and enforces `trimmed.length < MIN_DISGUISE_SEQUENCE_LENGTH`). Tested in `apps/web/src/tests/phase4b_triggers_disguise_pins.test.tsx:662-751` (10 total tests in file). |
| **b** | Phase 5 Test 6 (offline -> online queue flush) passes, and the assertion was fixed by waiting properly, not loosened | **YES** | `apps/web/src/lib/offlineQueue.ts:206-225` (fixed race condition in `cancelQueuedAlert` where `notifyQueueChange()` fired before `offlineDb.queuedAlerts.delete()` resolved, causing listeners to repopulate `memoryQueuedAlerts`) and `apps/web/src/tests/phase5_offline_connectivity.test.tsx:761-769` (`waitFor(..., { timeout: 5000 })` keeping strict assertions `expect(remaining).toHaveLength(0)`, `/Alert received by SAATHI at/i`, and `expect(incidentsAfterOnline.body.incidents).toHaveLength(1)`). |
| **c** | The 6A contact link stops working after the incident closes, after the contact is paused/removed, and after consent is revoked (depends on `data_processing` consent only, same as `getNotifiableContacts('sos')`, not on `notifications` consent) | **YES** | `apps/api/src/services/contactIncidentTokenService.ts:156-205`: `validateContactIncidentMagicToken` checks `OPEN_INCIDENT_STATUSES.includes(inc.status)` (lines 177-184, throws `410 Gone` when closed/expired) and calls `getNotifiableContacts(inc.userId, 'sos', db)` on every request (lines 187-202, throws `403 Forbidden` if contact is paused/removed or if `data_processing` consent is revoked; `notifications` consent is not required). Tested in `apps/api/src/tests/phase6a_contact_magic_links.test.ts:195-335` (4 total tests in file). |
| **d** | Acknowledgement by a contact stops the escalation ladder from any open pre-acknowledgement state (`ACTIVE`, `NOTIFIED`) | **YES** | `apps/api/src/services/contactIncidentTokenService.ts:288-347`: when contact responds `seen` (`ACTIVE \| NOTIFIED -> ACKNOWLEDGED`), `on_my_way` (`ACTIVE \| NOTIFIED \| ACKNOWLEDGED -> RESPONDING`), `calling_her` (`ACTIVE \| NOTIFIED \| ACKNOWLEDGED -> RESPONDING`), or `confirm_safe` (`-> RESOLVED`), calls `cancelScheduledEscalation(inc.id)`. `apps/api/src/services/scheduler.ts:77-79, 107, 131`: `isUnacknowledgedOpenStatus` only allows Step 1 / Step 2 escalation if status is still `ACTIVE` or `NOTIFIED`. Tested in `apps/api/src/tests/phase6a_contact_magic_links.test.ts:368-477`. |
| **e** | For `is_duress` incidents the contact page shows the exact notice `"Her phone shows this alert as cancelled. She may not be able to talk safely. Do not call or message her. Consider contacting security or 112."` and hides `"I'm calling her"`; the owner's payloads reveal no contact activity and are structurally IDENTICAL to a genuine owner cancel | **YES** | `apps/api/src/services/contactIncidentTokenService.ts:21-22, 232-235, 297-302` (`DURESS_SAFETY_NOTICE_EN` + backend `400` rejection of `calling_her` on duress), `apps/web/src/pages/ContactAlertPage.tsx:246-263, 366-378, 412-423` (renders `contact-duress-warning-banner` with exact notice and hides `"I'm calling her"` and `"Call her"`), and `apps/api/src/services/wsHub.ts:81-147` (`maskIncidentForOwner` strips all contact/responder/system events and post-cancel location samples so owner REST & WS payloads are structurally identical to a genuine owner cancel). Tested in `apps/api/src/tests/phase6a_contact_magic_links.test.ts:479-652` and `apps/web/src/tests/phase6a_contact_page.test.tsx:167-203` (5 total tests in file). |
| **f** | The contact page has all actions: `seen` ("I've seen this"), `on_my_way` ("I'm on my way"), `calling_her` ("I'm calling her"), `cannot_help` ("I can't help right now"), `confirm_safe` ("She is safe (close alert)" — closes incident including duress), `Call 112`, and `Call her` | **YES** | `apps/web/src/pages/ContactAlertPage.tsx:346-425` (`contact-btn-seen`, `contact-btn-on-my-way`, `contact-btn-calling-her`, `contact-btn-cannot-help`, `contact-btn-confirm-safe`, `contact-call-112-btn` (`tel:112`), `contact-call-her-btn` (`tel:${summary.user_phone_e164}`)). Backend handling in `apps/api/src/services/contactIncidentTokenService.ts:273-387`. Tested in `apps/api/src/tests/phase6a_contact_magic_links.test.ts:337-477` and `apps/web/src/tests/phase6a_contact_page.test.tsx:79-165`. |
| **g** | Coordinates are omitted without `can_see_live_location` AND active `location` consent | **YES** | `apps/api/src/services/contactIncidentTokenService.ts:207-249`: checks both `liveLocationContacts.some((c) => c.id === contact.id)` (via `getNotifiableContacts(inc.userId, 'live_location', db)`, which requires contact `can_see_live_location === true`) AND `hasActiveLocationConsent(db, inc.userId)`. When either is false, `location` is omitted from the JSON payload (`...(canSeeLiveLocation && latestSample ? { location: ... } : {})`). Tested in `apps/api/src/tests/phase6a_contact_magic_links.test.ts:250-288` and `apps/web/src/tests/phase6a_contact_page.test.tsx:205-257`. |

---

## 2. Incident Statuses Used in Code

Every incident status string used in the codebase (`apps/api/src/db/schema.ts:36-46` and `apps/api/src/services/incidentStateMachine.ts:21-31`) comes strictly from the 9-state machine in `PROJECT_BRIEF.md`:

1. `TRIGGERED` (open, pre-activation cancel window)
2. `ACTIVE` (open, pre-acknowledgement)
3. `NOTIFIED` (open, pre-acknowledgement)
4. `ACKNOWLEDGED` (open, acknowledged)
5. `RESPONDING` (open, responding)
6. `RESOLVED` (closed / terminal)
7. `CANCELLED` (closed / terminal — used for both genuine owner cancellation and owner-facing duress cancellation)
8. `FALSE_ALARM` (closed / terminal)
9. `EXPIRED` (closed / terminal)

Non-spec strings `'ESCALATED'` and `'CANCELLED_BY_USER'` do not exist anywhere in the TypeScript or SQL codebase.

---

## 3. Route Names Actually Used

| Route / Endpoint | Purpose | Auth / Access |
|---|---|---|
| `/c/:token` | Frontend public Trusted Contact Emergency Alert page (`ContactAlertPage.tsx`) | Public (magic-link token in URL; no login required) |
| `GET /api/c/:token` | Fetch scoped incident summary + latest location point (if permitted) + duress safety notice | Public, rate-limited (`publicTokenRateLimiter`), validated via HMAC + SHA-256 DB hash + live `getNotifiableContacts(userId, 'sos')` |
| `POST /api/c/:token/respond` | Submit contact response (`seen`, `on_my_way`, `calling_her`, `cannot_help`, `confirm_safe`) | Public, rate-limited (`publicTokenRateLimiter`), validated via HMAC + SHA-256 DB hash + live `getNotifiableContacts(userId, 'sos')` |
| `/ws/c/:token` (and `/api/ws/c/:token`) | Live WebSocket stream for contact page status & location updates | Public, validated via `validateContactIncidentMagicToken` on connect and before every broadcast |
| `/invite/:token` | Frontend public Trusted Circle invitation acceptance page (`PublicInvitePage.tsx`) | Public (single-use invitation token) |
| `GET /api/invitations/:token` | Inspect pending Trusted Circle invitation | Public, rate-limited |
| `POST /api/invitations/:token/accept` | Accept Trusted Circle invitation | Public, rate-limited |
| `POST /api/invitations/:token/decline` | Decline Trusted Circle invitation | Public, rate-limited |

---

## 4. Browser / Environment Execution & Lighthouse Note

- **JSDOM vs. Real Browser:** All automated tests in this container environment (`vitest run`) executed in **JSDOM** (with `fake-indexeddb/auto` for Dexie/IndexedDB, Node `WebCrypto` `crypto.subtle` for PBKDF2-SHA-256, and an in-process HTTP + `ws` WebSocket server backed by a real SQLite database). In `apps/web/src/tests/phase6a_contact_page.test.tsx` (Test 5), the two-window live check was performed by mounting two isolated React DOM roots (`window1Container` for the authenticated owner on `/home` and `window2Container` for the unauthenticated contact on `/c/:token`) connected concurrently over real HTTP and WebSocket connections to the Express + SQLite backend.
- **Lighthouse Result:** Lighthouse could not be run in this container environment because no headless Chromium / Chrome binary (`google-chrome`, `chromium`, or `playwright` browser binaries) is installed in the sandboxed runtime image. Offline and low-connectivity behavior is verified via `apps/web/src/tests/phase5_offline_connectivity.test.tsx`, `apps/web/src/tests/phase6a_contact_page.test.tsx` (data-saver / offline text-coordinate fallback), and `scripts/verify_offline_prod.ts`.

---

## 5. Real Test Output Summary (from `/tmp/phase6a-test-runs.log`)

### Separate Per-File Runs

| Test File | Test Files | Tests Passed | Tests Failed | Duration |
|---|---|---|---|---|
| `apps/api/src/tests/phase6a_contact_magic_links.test.ts` | 1 passed (1) | **4 passed (4)** | 0 failed | 5.46s |
| `apps/web/src/tests/phase6a_contact_page.test.tsx` | 1 passed (1) | **5 passed (5)** | 0 failed | 4.50s |
| `apps/web/src/tests/phase4b_triggers_disguise_pins.test.tsx` | 1 passed (1) | **10 passed (10)** | 0 failed | 14.28s |
| `apps/web/src/tests/phase5_offline_connectivity.test.tsx` | 1 passed (1) | **6 passed (6)** | 0 failed | 4.41s |

### Full Suite Run (`npx vitest run --reporter=verbose`)

- **Test Files:** `12 passed (12)`
- **Tests:** `75 passed (75)`, `0 failed`
- **Duration:** `68.25s`

### Raw Output Excerpt from `/tmp/phase6a-test-runs.log`

```text
 RUN  v5.0.3 /app/applet
 ✓ apps/api/src/tests/phase6a_contact_magic_links.test.ts > SAATHI Phase 6A API Tests (Trusted Contact Magic Links, Scoping, Revocation, Escalation Stop & Duress Safety) > 1. Magic-link token issuance & hashed storage: stored hashed in DB, included in dev outbox SMS, scoped to ONE contact + ONE incident, and expires when incident closes 226ms
 ✓ apps/api/src/tests/phase6a_contact_magic_links.test.ts > SAATHI Phase 6A API Tests (Trusted Contact Magic Links, Scoping, Revocation, Escalation Stop & Duress Safety) > 2. Real-time contact & consent revocation via getNotifiableContacts: pausing/removing contact or revoking consent stops link immediately; omitting location permission or location consent omits coordinates 201ms
 ✓ apps/api/src/tests/phase6a_contact_magic_links.test.ts > SAATHI Phase 6A API Tests (Trusted Contact Magic Links, Scoping, Revocation, Escalation Stop & Duress Safety) > 3. Contact response actions, state transitions, escalation cancellation & WebSocket push to owner: seen -> ACKNOWLEDGED (stops escalation from ACTIVE and NOTIFIED), on_my_way/calling_her -> RESPONDING, cannot_help -> event only, confirm_safe -> RESOLVED 298ms
 ✓ apps/api/src/tests/phase6a_contact_magic_links.test.ts > SAATHI Phase 6A API Tests (Trusted Contact Magic Links, Scoping, Revocation, Escalation Stop & Duress Safety) > 4. Duress incident awareness & masking: contact payload shows real status + safety notice & rejects calling_her; owner payloads & WS reveal nothing about contact activity and are structurally IDENTICAL to a genuine cancel; confirm_safe truly closes the duress incident 1863ms
 Test Files  1 passed (1)
      Tests  4 passed (4)
   Start at  05:01:18
   Duration  5.46s (tests 49%, environment 23%, import 17%, transform 10%)

 RUN  v5.0.3 /app/applet
 ✓ apps/web/src/tests/phase6a_contact_page.test.tsx > SAATHI Phase 6A Web Tests (Trusted Contact Page, Duress Awareness, Data-Saver/Offline Coords & Two-Window Live Sync) > 1. Normal contact alert view: renders with no login, shows first name, time, emergency type, Leaflet map with last updated label, all 5 response buttons (56px), Call 112 + Call her links, and Hindi (hi) localization 315ms
 ✓ apps/web/src/tests/phase6a_contact_page.test.tsx > SAATHI Phase 6A Web Tests (Trusted Contact Page, Duress Awareness, Data-Saver/Offline Coords & Two-Window Live Sync) > 2. Duress awareness for contacts: displays calm safety notice ("Her phone shows this alert as cancelled...") and hides "I'm calling her" and "Call her" buttons 36ms
 ✓ apps/web/src/tests/phase6a_contact_page.test.tsx > SAATHI Phase 6A Web Tests (Trusted Contact Page, Duress Awareness, Data-Saver/Offline Coords & Two-Window Live Sync) > 3. Offline / Data-saver mode & Omitted location state: shows text coordinates instead of map tiles when offline or in data-saver mode, and shows clear notice when location permission is off 68ms
 ✓ apps/web/src/tests/phase6a_contact_page.test.tsx > SAATHI Phase 6A Web Tests (Trusted Contact Page, Duress Awareness, Data-Saver/Offline Coords & Two-Window Live Sync) > 4. Expired or closed state: renders clear expired/closed screen on 410/403/404 or after tapping "She is safe (close alert)" 14ms
 ✓ apps/web/src/tests/phase6a_contact_page.test.tsx > SAATHI Phase 6A Web Tests (Trusted Contact Page, Duress Awareness, Data-Saver/Offline Coords & Two-Window Live Sync) > 5. Two-Window Live Browser Check (Window 1: Authenticated Owner on /home, Window 2: Unauthenticated Contact opening magic link from /api/dev/outbox): Contact taps "I'm on my way" and Owner live status updates to RESPONDING in real time via WebSocket 435ms
 Test Files  1 passed (1)
      Tests  5 passed (5)
   Start at  05:01:25
   Duration  4.50s (import 34%, environment 26%, tests 20%, transform 19%)

 RUN  v5.0.3 /app/applet
 ✓ apps/web/src/tests/phase4b_triggers_disguise_pins.test.tsx > SAATHI Phase 4B Web Tests (Discreet Triggers, Disguise Mode & PIN Settings) > 1. Triple-tap trigger timing: 3 taps within 1s calls triggerSos("triple_tap"), while 3 taps spread over >1s does nothing 293ms
 ✓ apps/web/src/tests/phase4b_triggers_disguise_pins.test.tsx > SAATHI Phase 4B Web Tests (Discreet Triggers, Disguise Mode & PIN Settings) > 2. Keyboard shortcut trigger: pressing configured key combo calls triggerSos("keyboard_shortcut") 91ms
 ✓ apps/web/src/tests/phase4b_triggers_disguise_pins.test.tsx > SAATHI Phase 4B Web Tests (Discreet Triggers, Disguise Mode & PIN Settings) > 3. Shake detection trigger: simulated DeviceMotion events below threshold do nothing, at/above threshold call triggerSos("shake"), and iOS permission is handled 134ms
 ✓ apps/web/src/tests/phase4b_triggers_disguise_pins.test.tsx > SAATHI Phase 4B Web Tests (Discreet Triggers, Disguise Mode & PIN Settings) > 4. Voice code word trigger (experimental): disabled by default, requires explicit microphone consent step, and calls triggerSos("voice") when code word is spoken 129ms
 ✓ apps/web/src/tests/phase4b_triggers_disguise_pins.test.tsx > SAATHI Phase 4B Web Tests (Discreet Triggers, Disguise Mode & PIN Settings) > 5. Disguise mode: changes page title & icon, calculator actually calculates math, and secret sequence reveals the real SOS screen 188ms
 ✓ apps/web/src/tests/phase4b_triggers_disguise_pins.test.tsx > SAATHI Phase 4B Web Tests (Discreet Triggers, Disguise Mode & PIN Settings) > 6. PIN settings & Practice mode: rejects matching Cancel/Duress PINs, never stores PINs in browser storage, and practice mode fires trigger without creating an incident 481ms
 ✓ apps/web/src/tests/phase4b_triggers_disguise_pins.test.tsx > SAATHI Phase 4B Web Tests (Discreet Triggers, Disguise Mode & PIN Settings) > 7. Full E2E verification (JSDOM 390x844 connected to real Express + SQLite + WebSocket): Disguise unlock -> Triple-tap trigger reaches cancel window -> Duress PIN cancel looks normal while incident continues on server + Hindi strings check 3345ms
 ✓ apps/web/src/tests/phase4b_triggers_disguise_pins.test.tsx > SAATHI Phase 4B Web Tests (Discreet Triggers, Disguise Mode & PIN Settings) > 8. Fix 1 & Fix D: Disguise mode has NO default secret sequence, requires user to set & confirm her own sequence (min length 6), and stores only a PBKDF2 hash (200,000 iterations + random salt) on-device (never plain text in localStorage) 243ms
 ✓ apps/web/src/tests/phase4b_triggers_disguise_pins.test.tsx > SAATHI Phase 4B Web Tests (Discreet Triggers, Disguise Mode & PIN Settings) > 9. Fix 2: On an incident with is_duress = true, the owner's "I'm safe" (resolve) does NOT close the real incident (shows normal closed screen to owner, stays active on server until responder closes it) 2545ms
 ✓ apps/web/src/tests/phase4b_triggers_disguise_pins.test.tsx > SAATHI Phase 4B Web Tests (Discreet Triggers, Disguise Mode & PIN Settings) > 10. Fix 3: Shadow alert from re-triggering during a duress incident sends NO second set of notifications, and "Cancel" or "I'm safe" on the shadow flow never affects the real duress incident 3089ms
 Test Files  1 passed (1)
      Tests  10 passed (10)
   Start at  05:01:31
   Duration  14.28s (tests 75%, import 11%, environment 8%, transform 6%)

 RUN  v5.0.3 /app/applet
 ✓ apps/web/src/tests/phase5_offline_connectivity.test.tsx > SAATHI Phase 5 Web Tests (Offline Queue, Idempotency, SMS Fallback, Contact Cache & Low-Connectivity) > 1. Queue retry & exponential backoff with jitter: stores failed alerts in Dexie/IndexedDB and increments attempts & backoff delay on retry failure 26ms
 ✓ apps/web/src/tests/phase5_offline_connectivity.test.tsx > SAATHI Phase 5 Web Tests (Offline Queue, Idempotency, SMS Fallback, Contact Cache & Low-Connectivity) > 2. Idempotency: reusing client_request_id across two retries creates only ONE incident on the real backend 133ms
 ✓ apps/web/src/tests/phase5_offline_connectivity.test.tsx > SAATHI Phase 5 Web Tests (Offline Queue, Idempotency, SMS Fallback, Contact Cache & Low-Connectivity) > 3. Cancel while queued: cancelling during the cancel window while offline removes the alert from the queue so it is never sent on reconnect 304ms
 ✓ apps/web/src/tests/phase5_offline_connectivity.test.tsx > SAATHI Phase 5 Web Tests (Offline Queue, Idempotency, SMS Fallback, Contact Cache & Low-Connectivity) > 4. Auth while offline (401 refresh-and-retry): refreshes session on 401 and retries; if refresh fails, keeps alert queued with needs_reauth and never drops it silently 9ms
 ✓ apps/web/src/tests/phase5_offline_connectivity.test.tsx > SAATHI Phase 5 Web Tests (Offline Queue, Idempotency, SMS Fallback, Contact Cache & Low-Connectivity) > 5. SMS link builder & Contact cache: caches ONLY accepted+receives_sos contacts, encodes Android vs iOS sms: links properly, and clears cache on logout and consent revocation 12ms
 ✓ apps/web/src/tests/phase5_offline_connectivity.test.tsx > SAATHI Phase 5 Web Tests (Offline Queue, Idempotency, SMS Fallback, Contact Cache & Low-Connectivity) > 6. Full Offline-to-Online Production Flow (Real Express + SQLite + WebSocket): Load app -> go offline -> trigger SOS -> see honest queued state & SMS fallback -> go online -> confirm alert is delivered exactly once 440ms
 Test Files  1 passed (1)
      Tests  6 passed (6)
   Start at  05:01:47
   Duration  4.41s (import 33%, environment 26%, tests 22%, transform 19%)

 RUN  v5.0.3 /app/applet
 Test Files  12 passed (12)
      Tests  75 passed (75)
   Start at  05:01:52
   Duration  68.25s (tests 61%, environment 20%, import 17%, transform 2%)
```
