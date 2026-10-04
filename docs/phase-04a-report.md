# Phase 04A Report: SOS Core Experience (Frontend, Part 1 of 2)

## 1. What Was Built in Phase 4A

1. **Home / SOS Screen & Unified `triggerSos(source)` (`apps/web/src/pages/HomePage.tsx`, `apps/web/src/lib/sos.ts`)**:
   - Implemented the one-handed, high-contrast circular **SOS Hold Button** (`w-44 h-44`, well above the 56px minimum touch target, with `focus-visible:ring-4`).
   - **2-Second Hold-to-Trigger**:
     - Holding for 2.0 seconds fills a visible SVG progress ring (`0% -> 100%`), triggers haptic feedback via `navigator.vibrate` (40ms on hold start, `[120, 60, 120]` on completion where supported), and announces hold progress and completion via an `aria-live="assertive"` screen-reader region.
     - Releasing early (`mouseUp`, `mouseLeave`, `touchEnd`, `touchCancel`, or `keyUp` before 2.0s) immediately cancels the timer, resets the progress ring to `0%`, announces early release to screen readers, and does not create an incident.
   - **Unified `triggerSos(source)` Entry Point**:
     - Built `triggerSos(source)` in `apps/web/src/lib/sos.ts` (and re-exported from `HomePage.tsx`), generating an idempotent `client_request_id` and calling `POST /api/incidents`. All future Phase 4B triggers (shake, voice, triple-tap, disguise) will call this same function.
   - **Calm Secondary Links**:
     - Below the SOS button and 56px `Call 112` / `Call 181` actions, rendered calm links to **Trusted Circle (`/circle`)**, **Consents & Privacy (`/consents`)**, and **Safety Guide (`/onboarding`)**.

2. **Zero-Contacts Warning Banner**:
   - When `notifiable_contacts_count === 0`, displays a calm amber banner at the top of Home (`"No one will be alerted yet. Add a trusted contact."`) with a direct link to `/circle`.
   - Never disables or blocks the SOS button.

3. **Cancel Window Screen & On-Screen Numeric PIN Keypad**:
   - After triggering (`status === 'TRIGGERED'`), transitions immediately to the Cancel Window screen showing a live countdown (`cancel_window_seconds`, read from `/api/me`, defaulting to `5s`) and a full-width 56px **Cancel Alert** button.
   - **Plain Cancel vs PIN Keypad**:
     - When no cancel/duress PIN is configured (`!user.has_cancel_pin && !user.has_duress_pin`), tapping **Cancel Alert** cancels the incident directly (`POST /api/incidents/:id/cancel` -> `CANCELLED`).
     - When a cancel or duress PIN is configured (`user.has_cancel_pin || user.has_duress_pin` from `/api/me`, or `POST /api/incidents/:id/cancel` returning `400 PIN is required to cancel an alert.`), tapping **Cancel Alert** opens a custom **Large Numeric PIN Keypad** (`0–9`, `Clear`, `Backspace`, `Confirm Cancel`, all `>= 56px` targets) with **zero `<input>` elements** so the mobile system keyboard never opens.
     - Entering either the real cancel PIN or the duress PIN produces the exact same visible `CANCELLED` UI state (`"Alert cancelled — Your alert was cancelled inside the window. No one was notified."`).
     - Entering a wrong PIN (including when rate-limited after 5 attempts) displays the same calm message (`"Incorrect PIN. Please try again."`) and never reveals that a PIN attempt limit exists.

4. **Duress Continuity (Silent Location Streaming After Duress-PIN Cancel)**:
   - On a **duress PIN** match in `cancelIncidentForUser` (`apps/api/src/services/incidentService.ts`), the backend returns `_duress_keep_location_active: true` alongside the masked `status: 'CANCELLED'` payload.
   - On a **normal cancel**, `_duress_keep_location_active` is completely omitted (`'_duress_keep_location_active' in response === false`).
   - When `HomePage.tsx` receives `_duress_keep_location_active: true`, it transitions the visible UI to the normal `"Alert cancelled"` screen (and back to the idle SOS button when the user taps `"Return to SOS Screen"`), while a background effect (`silentDuressIncidentId`) continues sending location samples silently to `POST /api/incidents/:id/location` without any visible UI indicator until the incident is resolved or auto-expires on the server.

5. **Configurable Incident Auto-Expiry (`EXPIRED`, Default 60 Minutes After `ACTIVE`)**:
   - Added `incidentAutoExpireMinutes` (default `60`, configurable via `INCIDENT_AUTO_EXPIRE_MINUTES` or `autoExpireMs` in `scheduleEscalationLadder`) in `apps/api/src/core/config.ts` and `apps/api/src/services/scheduler.ts`.
   - Exposed `auto_expire_minutes` on every `IncidentDto` (`toIncidentDto`) so the Sharing Preview UI reads the real duration from the server (`"Stops automatically in {{minutes}} min or when you tap I'm safe"`).
   - When the auto-expiry timer elapses while an incident is open (`ACTIVE`, `NOTIFIED`, `ACKNOWLEDGED`, `RESPONDING`), the scheduler cancels escalation timers, transitions the incident to `'EXPIRED'` (`TERMINAL_INCIDENT_STATUSES`), stops accepting location samples (`addIncidentLocationSample` rejects with `400`), and broadcasts the update over `/ws/incidents/:id` (while preserving `CANCELLED` masking for the owner if `is_duress === true`).

6. **Optional Emergency Type One-Tap Chips, Sharing Preview Panel & Alert-Only Location Capture**:
   - Rendered 56px one-tap chips (`Unsafe`, `Followed`, `Harassment`, `Medical`, `Other`) during an active alert, calling `POST /api/incidents/:id/type` non-blockingly.
   - **Sharing Preview Panel**: Displays who will be alerted from real `/api/contacts` data (ordered by priority), dynamic auto-stop notice from `incident.auto_expire_minutes`, and honest location consent status (`"Location is off; contacts get the alert without it"` when `location` consent is not granted).
   - **Alert-Only Geolocation**: Calls `navigator.geolocation.getCurrentPosition` **only** while an alert is open and **only** when `consents.current.location === true`, posting samples to `POST /api/incidents/:id/location` and displaying accuracy (`±m`) and last updated time (or `"Location unavailable"` if geolocation fails).

7. **Live Status Screen (`/ws/incidents/:id` + Reconnect + Plain Language + `needs_user_action`)**:
   - Connects to `/ws/incidents/:id` with automatic reconnect on close, processing `incident_state` (initial state on connect) and `incident_updated` frames.
   - Displays calm, plain-language headlines (`"Help is being notified"`, `"Alert sent"`, `"Help is on the way"`) — never raw enum names or error codes.
   - Always shows 56px `"I'm safe"` (`POST /api/incidents/:id/resolve`), `"Call 112"` (`tel:112`), and `"Call 181"` (`tel:181`) actions.
   - When `needs_user_action === true`, displays a prominent high-contrast `"No acknowledgement yet — Call 112 now"` banner and 56px `"Call 112 now"` button at the top of the screen.

8. **Resolved `/api/me` DTO Gap (`cancel_window_seconds`, `has_cancel_pin`, `has_duress_pin`)**:
   - Updated `UserResponseDto` (`apps/api/src/schemas/auth.ts`) and `toUserResponseDto` (`apps/api/src/services/authService.ts`) to expose `cancel_window_seconds: number`, `has_cancel_pin: boolean`, and `has_duress_pin: boolean` (booleans only, never PIN hashes).

---

## 2. Honest Note on Browser vs. JSDOM Mobile Viewport Verification

- **Did we open a real GUI/headless Chromium browser?** No — no headless browser binary (Playwright/Chromium) was launched. All verification was executed in **Vitest + React Testing Library (JSDOM)** configured at a `390x844` mobile viewport connected over real HTTP and `ws` sockets to a live **Express + SQLite + WebSocket** server (`Test 8`, `Test 9`, and `Test 10` in `apps/web/src/tests/phase4a_sos_core.test.tsx`).
- **Screen-by-screen DOM state verified in the `390x844` E2E test**:
  1. **Idle Home Screen with Zero-Contacts Warning**: Rendered `data-testid="zero-contacts-banner"` (`"No one will be alerted yet. Add a trusted contact."` with link to `/circle`) above the circular `data-testid="sos-hold-button"` (`SOS — Hold for 2 seconds to trigger emergency alert`, enabled) and 56px `Call 112` / `Call 181` links.
  2. **Cancel Window Screen (`status === 'TRIGGERED'`)**: After calling `triggerSos('button')`, the idle screen was replaced by `data-testid="cancel-window-screen"`, displaying `"Cancel Window Active"`, `"Alert starting"`, `data-testid="cancel-countdown"` (`"Sending alert in 1s"`), the 56px `data-testid="cancel-alert-btn"` (`"Cancel Alert"`), the 5 emergency-type chips (`Unsafe`, `Followed`, `Harassment`, `Medical`, `Other`), and the Sharing Preview panel showing `data-testid="sharing-auto-stop"` (`"Stops automatically in 60 min or when you tap I'm safe"`) and `"Location is off; contacts get the alert without it"`.
  3. **Working Cancel (`status === 'CANCELLED'`)**: Clicking `data-testid="cancel-alert-btn"` transitioned to `data-testid="closed-status-screen"` displaying `"Alert cancelled — Your alert was cancelled inside the window. No one was notified."` and `data-testid="return-home-btn"` (`"Return to SOS Screen"`).
  4. **Active -> Live Status Updates via WebSocket (`status === 'ACTIVE'` -> `'NOTIFIED'`)**: After adding and accepting contact `Meera Joshi` and triggering SOS again, the Cancel Window listed `#1 Meera Joshi` under `"Who will be alerted:"`. Once the 1s cancel window elapsed on the backend scheduler, the WebSocket `/ws/incidents/:id` pushed `incident_updated` frames transitioning the DOM to `data-testid="live-status-screen"` with `data-testid="live-status-heading"` reading `"Alert sent"` (`"Help is being notified. Your trusted contacts have been alerted."`), plus the 56px `"I'm safe"`, `"Call 112"`, and `"Call 181"` buttons.
  5. **"I'm safe" Resolution (`status === 'RESOLVED'`)**: Clicking `data-testid="im-safe-btn"` called `POST /api/incidents/:id/resolve` and transitioned the DOM to `data-testid="closed-status-screen"` displaying `"You marked yourself safe — Your emergency alert is now closed and location sharing has stopped."`.

---

## 3. Files Created / Updated

### Created
- `apps/web/src/lib/sos.ts`
- `apps/web/src/tests/phase4a_sos_core.test.tsx`
- `docs/phase-04a-report.md`

### Updated
- `apps/api/src/core/config.ts`
- `apps/api/src/schemas/auth.ts`
- `apps/api/src/schemas/incident.ts`
- `apps/api/src/services/authService.ts`
- `apps/api/src/services/incidentService.ts`
- `apps/api/src/services/scheduler.ts`
- `apps/web/src/store/authStore.ts`
- `apps/web/src/lib/api.ts`
- `apps/web/src/pages/HomePage.tsx`
- `apps/web/src/i18n/en.json`
- `apps/web/src/i18n/hi.json`

---

## 4. Real Test Output (`phase4a_sos_core.test.tsx`)

```text
 RUN  v5.0.3 /app/applet

 ✓ apps/web/src/tests/phase4a_sos_core.test.tsx > SAATHI Phase 4A Web Tests (SOS Core Experience) > 1. Zero-contacts warning banner: displays warning when notifiable_contacts_count is 0 without blocking the SOS button 117ms
 ✓ apps/web/src/tests/phase4a_sos_core.test.tsx > SAATHI Phase 4A Web Tests (SOS Core Experience) > 2. Hold-to-trigger timing & early release: releasing before 2 seconds does nothing; holding full 2 seconds triggers SOS via triggerSos(source) 121ms
 ✓ apps/web/src/tests/phase4a_sos_core.test.tsx > SAATHI Phase 4A Web Tests (SOS Core Experience) > 3. Cancel window countdown & plain cancel (no PIN configured): counts down and cancels directly 86ms
 ✓ apps/web/src/tests/phase4a_sos_core.test.tsx > SAATHI Phase 4A Web Tests (SOS Core Experience) > 4. PIN keypad cancel flow: opens large numeric keypad (no system input), rejects wrong PIN calmly without revealing limits, and cancels identically on cancel/duress PIN 545ms
 ✓ apps/web/src/tests/phase4a_sos_core.test.tsx > SAATHI Phase 4A Web Tests (SOS Core Experience) > 5. Live status screen, needs_user_action prompt, emergency type chips, and I am safe resolution 130ms
 ✓ apps/web/src/tests/phase4a_sos_core.test.tsx > SAATHI Phase 4A Web Tests (SOS Core Experience) > 6. Location capture happens ONLY during an open alert when location consent is granted, and triggerSos(source) works directly 95ms
 ✓ apps/web/src/tests/phase4a_sos_core.test.tsx > SAATHI Phase 4A Web Tests (SOS Core Experience) > 7. Honest server-unreachable state with Retry + Call 112 fallback and Hindi (hi) localization 123ms
 ✓ apps/web/src/tests/phase4a_sos_core.test.tsx > SAATHI Phase 4A Web Tests (SOS Core Experience) > 8. Mobile viewport (390x844) full E2E check against real Express + SQLite + WebSocket: zero-contacts warning -> cancel inside window -> trigger -> ACTIVE -> NOTIFIED live status via WS -> I am safe 1337ms
 ✓ apps/web/src/tests/phase4a_sos_core.test.tsx > SAATHI Phase 4A Web Tests (SOS Core Experience) > 9. Auto-expiry (EXPIRED): UI reads real auto_expire_minutes from server, backend transitions open incident to EXPIRED after timeout, rejects further location samples, notifies owner via WS, and preserves duress masking 944ms
 ✓ apps/web/src/tests/phase4a_sos_core.test.tsx > SAATHI Phase 4A Web Tests (SOS Core Experience) > 10. Duress continuity: normal cancel never contains _duress_keep_location_active; duress cancel includes it and client keeps sending location samples silently without visible UI change 835ms
 ✓ apps/web/src/tests/phase4a_sos_core.test.tsx > SAATHI Phase 4A Web Tests (SOS Core Experience) > 11. /api/me DTO exposes cancel_window_seconds, has_cancel_pin, and has_duress_pin booleans and never exposes PIN hashes 458ms
 ✓ apps/web/src/tests/phase4a_sos_core.test.tsx > SAATHI Phase 4A Web Tests (SOS Core Experience) > 12. Follow-up 1: Auto-expiry after simulated server restart is computed from activated_at (remaining time, or expires immediately if already past) 754ms
 ✓ apps/web/src/tests/phase4a_sos_core.test.tsx > SAATHI Phase 4A Web Tests (SOS Core Experience) > 13. Follow-up 2: Triggering SOS again while a duress incident is still open shows a normal new alert flow to the owner while the real duress incident stays active 2690ms

 Test Files  1 passed (1)
      Tests  13 passed (13)
```

---

## 5. Pre-Phase 4B Follow-ups Completed

1. **Follow-up 1: Auto-Expiry After Server Restart Computed from `activated_at` (`apps/api/src/services/scheduler.ts`)**:
   - In `recoverPendingIncidentsOnStartup`, `elapsedMs = Math.max(0, Date.now() - activatedMs)` is computed from `inc.activatedAt` (falling back to `inc.createdAt` only if `activatedAt` is null).
   - `remainingAutoExpireMs = baseAutoExpire - elapsedMs`.
   - If `remainingAutoExpireMs <= 0` on startup, the incident is transitioned to `'EXPIRED'` immediately and broadcast over WebSocket.
   - Otherwise, `scheduleEscalationLadder` is scheduled with `autoExpireMs: remainingAutoExpireMs` (never a fresh full duration).
   - Verified in Test 12 of `phase4a_sos_core.test.tsx`.

2. **Follow-up 2: Re-Triggering SOS While a Duress Incident Is Open (`apps/api/src/services/incidentService.ts` & `scheduler.ts`)**:
   - **Design Chosen**: When the user triggers SOS again within the duplicate-merge window while an open incident has `is_duress = true`, the real duress incident remains the single active incident in the backend (`merged_into_id = recentOpen.id`), and any new location samples or emergency-type updates from the duplicate trigger are forwarded to `recentOpen.id`.
   - For the owner-facing response and screen, the duplicate row starts in `'TRIGGERED'` (with `is_duress = false`) and `scheduleShadowMergedActivation` transitions it to match the real incident's active status (`ACTIVE` / `NOTIFIED`) after the user's cancel window elapses, pushing the update over WebSocket. Thus the owner (and anyone watching her screen) sees a completely normal new alert flow (`Cancel Window -> Live Status`), while the original duress incident stays active uninterrupted for contacts and responders.
   - Verified in Test 13 of `phase4a_sos_core.test.tsx`.

