# Phase 05 Report: Offline and Low Connectivity

## 1. Summary of Pre-Phase 5 Confirmations & Fixes (Phase 4B Fixes 1–3)

1. **Fix 1 (No Default Disguise Sequence & Salted Hash Storage)**:
   - Removed any default unlock sequence (`disguiseSequenceHash: null`). Enabling Disguise Mode requires the user to enter and confirm her own sequence (minimum 4 characters, ending with `=`).
   - **Where it is stored**: Stored **on-device in `localStorage` (`saathi_trigger_settings_v1`) as a salted SHA-256 hash** (`sha256$<16-byte-salt-hex>$<sha256-digest-hex>$<length>`) computed via Web Crypto `crypto.subtle.digest('SHA-256', ...)`. The plain sequence is never stored in `localStorage` or `sessionStorage`.
2. **Fix 2 (Owner "I'm Safe" Does Not Close a Duress Incident)**:
   - Updated `resolveIncidentForUser` in `apps/api/src/services/incidentService.ts` so that when `inc.isDuress === true` and the caller is the owner (`!isResponderOrAdmin`), the server records an audit note, returns a masked `RESOLVED` DTO so her screen looks normally closed, and keeps the real incident `ACTIVE` on the server until a responder (or trusted contact in Phase 6) resolves it.
3. **Fix 3 (Shadow Alert Isolation During Duress)**:
   - Confirmed and tested that re-triggering SOS during an open duress incident creates a shadow `TRIGGERED` record that sends **no second set of notifications**, and that tapping *"Cancel"* or *"I'm safe"* on the shadow alert never cancels or resolves the real duress incident.

---

## 2. What Was Built in Phase 5

1. **Service Worker & Installable PWA (`vite.config.ts`, `public/manifest.webmanifest`, `public/icons/*`, `apps/web/src/components/PWAInstallButton.tsx`)**:
   - Configured `vite-plugin-pwa` (Workbox `generateSW`) to precache the app shell (`index.html`, JS/CSS bundles, English & Hindi locales, SVG and PNG icons — 12 precache entries).
   - Configured **CacheFirst** runtime caching for static assets (`png`, `svg`, `ico`, `woff2`) and **NetworkFirst** (4s timeout) for `/api/*` requests, with navigation fallback `/index.html` (excluding `/api/*` and `/ws/*`).
   - Updated `public/manifest.webmanifest` with `display: "standalone"`, `theme_color: "#0F766E"`, `background_color: "#0F172A"`, and generated `192x192` and `512x512` PNG icons (`any` and `maskable`) alongside `icon.svg`.
   - Added `"start:prod": "npm run build && NODE_ENV=production tsx apps/api/server.ts"` and `"test:offline:prod": "npm run build && tsx scripts/verify_offline_prod.ts"` in `package.json` to test offline behavior against a production build served by Express.

2. **Offline Queue in IndexedDB (`apps/web/src/lib/offlineQueue.ts`, `apps/web/src/lib/sos.ts`)**:
   - Created `SaathiOfflineDatabase` using **Dexie** (`saathi_offline_db`) with `queuedAlerts` (`client_request_id`, `client_created_at`, `source_trigger`, `emergency_type`, `location`, `attempts`, `next_retry_at`, `status`, `last_error`) and `cachedContacts`.
   - When `navigator.onLine === false` or `POST /api/incidents` fails due to network error, `triggerSos(source)` stores the alert in IndexedDB, registers a Background Sync tag (`saathi-sos-queue-sync`) where supported, and retries automatically on `window` `online` and `focus` events using exponential backoff with jitter (`computeBackoffDelayMs`).

3. **Idempotency (`apps/web/src/lib/offlineQueue.ts`)**:
   - Every retry reuses the original `client_request_id` so the backend's idempotency check returns `idempotent_replay: true` and never creates duplicate incidents.

4. **Cancel While Queued (`apps/web/src/pages/HomePage.tsx`, `apps/web/src/lib/offlineQueue.ts`)**:
   - If the user cancels during the cancel window while the alert is queued offline, `cancelQueuedAlert(client_request_id)` deletes the entry from IndexedDB immediately so it is never sent when connectivity returns.

5. **Auth While Offline (`apps/web/src/lib/offlineQueue.ts`, `apps/web/src/lib/api.ts`)**:
   - When flushing a queued alert after reconnecting, if `POST /api/incidents` returns `401`, `apiRequest` automatically calls `POST /api/auth/refresh` and retries the request.
   - If the token refresh also fails (`401`), `flushOfflineAlertQueue` keeps the alert in IndexedDB with `status: 'needs_reauth'`, displays a prominent sign-in prompt (`queued-reauth-banner`), and **never drops the alert silently**.

6. **Location Fallback (`apps/web/src/pages/HomePage.tsx`)**:
   - Captures GPS coordinates at trigger time (even when offline) and keeps the most recent fix in memory and in the queued alert record **only while an alert is active or queued**, displaying `"Last known at HH:MM"`. Clears `latestLocation` as soon as no alert is active or queued.

7. **SMS Fallback (`apps/web/src/lib/offlineQueue.ts`, `apps/web/src/pages/HomePage.tsx`)**:
   - When an alert is queued or unsent, displays a one-tap `"Send by SMS to Priority Contacts"` button plus individual per-contact SMS buttons (since group SMS can be unreliable on iOS), pre-filled with a short emergency message and a `https://maps.google.com/?q=<lat>,<lng>` link to the last known location.
   - Handles Android (`sms:+91...,+91...?body=...`) vs. iOS single (`sms:+91...&body=...`) vs. iOS group (`sms://open?addresses=+91...,+91...&body=...`) URI formats (`buildSmsFallbackHref`).
   - Never claims the SMS was sent automatically; after opening the SMS composer, prompts the user (`"Did you send the SMS in your messaging app?"` -> `"Yes, I sent the SMS"`).

8. **Contact Cache for Offline SMS (`apps/web/src/lib/offlineQueue.ts`, `PageLayout.tsx`, `ConsentCenterPage.tsx`)**:
   - **Note for Phase 8 Emergency Data Policy page**: SAATHI caches **only** the `id`, `name`, `phone_e164`, and `priority_order` of `accepted` trusted contacts who have `receives_sos: true` in on-device IndexedDB (`saathi_offline_db.cachedContacts`) so offline SMS fallback links can be constructed without internet access. This cache is refreshed when online and is **immediately cleared on logout** (`PageLayout.tsx`) or when **`data_processing` consent is revoked** (`ConsentCenterPage.tsx`).

9. **Honest Status UI (`apps/web/src/components/PageLayout.tsx`, `apps/web/src/pages/HomePage.tsx`)**:
   - Persistent connectivity indicator in the top bar (`"Online — Connected to SAATHI"` / `"Offline — Alerts will queue & offer SMS fallback"`).
   - Displays `"Not sent yet. Retrying. Tap to send by SMS"` while queued, and only shows `"Sent at HH:MM"` after the server confirms creation/activation. Includes direct `Call 112` and `Call 181` buttons on the offline/queued panel.

10. **Low-Battery / Data-Saver Mode (`apps/web/src/store/triggerSettingsStore.ts`, `SettingsPage.tsx`, `HomePage.tsx`)**:
    - Added a setting in `SettingsPage.tsx` (plus an automatic suggestion banner when `navigator.getBattery()` reports `<= 20%` and not charging) that disables the SVG hold-progress ring and CSS scale animations, avoids map tiles, and uses text-only status updates.

11. **Flush on Reconnect (`apps/web/src/lib/offlineQueue.ts`, `HomePage.tsx`, `PageLayout.tsx`)**:
    - Queued alerts flush in FIFO order (`orderBy('client_created_at')`) on the `online` event, `focus` event, or manual retry tap. Once delivered, `subscribeQueueFlushed` transitions the UI from the queued state to the live server incident and connects the WebSocket automatically.

---

## 3. Real Test & Production Verification Output

### A. Automated Web Tests (`phase4b_triggers_disguise_pins.test.tsx` & `phase5_offline_connectivity.test.tsx`)

```text
 ✓ apps/web/src/tests/phase4b_triggers_disguise_pins.test.tsx (10 tests) 11936ms
   ✓ 1. Triple-tap trigger timing: 3 taps within 1s calls triggerSos("triple_tap"), while 3 taps spread over >1s does nothing 487ms
   ✓ 2. Keyboard shortcut trigger: pressing configured key combo calls triggerSos("keyboard_shortcut") 112ms
   ✓ 3. Shake detection trigger: simulated DeviceMotion events below threshold do nothing, at/above threshold call triggerSos("shake"), and iOS permission is handled 168ms
   ✓ 4. Voice code word trigger (experimental): disabled by default, requires explicit microphone consent step, and calls triggerSos("voice") when code word is spoken 230ms
   ✓ 5. Disguise mode: changes page title & icon, calculator actually calculates math, and secret sequence reveals the real SOS screen 230ms
   ✓ 6. PIN settings & Practice mode: rejects matching Cancel/Duress PINs, never stores PINs in browser storage, and practice mode fires trigger without creating an incident 311ms
   ✓ 7. Full E2E verification (JSDOM 390x844 connected to real Express + SQLite + WebSocket): Disguise unlock -> Triple-tap trigger reaches cancel window -> Duress PIN cancel looks normal while incident continues on server + Hindi strings check 3510ms
   ✓ 8. Fix 1: Disguise mode has NO default secret sequence, requires user to set & confirm her own sequence (min length 4), and stores only a salted SHA-256 hash on-device (never plain text in localStorage) 180ms
   ✓ 9. Fix 2: On an incident with is_duress = true, the owner's "I'm safe" (resolve) does NOT close the real incident (shows normal closed screen to owner, stays active on server until responder closes it) 3187ms
   ✓ 10. Fix 3: Shadow alert from re-triggering during a duress incident sends NO second set of notifications, and "Cancel" or "I'm safe" on the shadow flow never affects the real duress incident 3518ms
 ✓ apps/web/src/tests/phase5_offline_connectivity.test.tsx (6 tests) 3082ms
   ✓ 1. Queue retry & exponential backoff with jitter: stores failed alerts in Dexie/IndexedDB and increments attempts & backoff delay on retry failure 98ms
   ✓ 2. Idempotency: reusing client_request_id across two retries creates only ONE incident on the real backend 1117ms
   ✓ 3. Cancel while queued: cancelling during the cancel window while offline removes the alert from the queue so it is never sent on reconnect 269ms
   ✓ 4. Auth while offline (401 refresh-and-retry): refreshes session on 401 and retries; if refresh fails, keeps alert queued with needs_reauth and never drops it silently 49ms
   ✓ 5. SMS link builder & Contact cache: caches ONLY accepted+receives_sos contacts, encodes Android vs iOS sms: links properly, and clears cache on logout and consent revocation 64ms
   ✓ 6. Full Offline-to-Online Production Flow (Real Express + SQLite + WebSocket): Load app -> go offline -> trigger SOS -> see honest queued state & SMS fallback -> go online -> confirm alert is delivered exactly once 1480ms

 Test Files  2 passed (2)
      Tests  16 passed (16)
```

### B. Production Build Offline Run (`npm run test:offline:prod`)
- **Browser / Environment Disclosure**: I did **not** use a real headless Chromium/Playwright browser binary because Chromium is not installed in this container environment. Instead, I verified the production build (`vite build` + Workbox `dist/sw.js` served by the real Express server) using two complementary runs:
  1. `phase5_offline_connectivity.test.tsx` (Test 6): Renders the React app in JSDOM (`fake-indexeddb` + `WebSocket`) against a live **Express + SQLite + WebSocket** server, loads the app online (caching accepted SOS contacts), switches `navigator.onLine = false` and cuts network requests, triggers SOS, verifies `"Not sent yet. Retrying. Tap to send by SMS"` and the `sms:` links, switches back online (`window.dispatchEvent(new Event('online'))`), and confirms the queued alert is flushed and delivered to the server **exactly once** with `"Sent at HH:MM"`.
  2. `npm run test:offline:prod` (`scripts/verify_offline_prod.ts`): Builds the production bundle (`dist/sw.js`, `dist/workbox-*.js`, `dist/manifest.webmanifest`, `dist/index.html`), mounts `dist/` on the Express server, verifies HTTP 200 responses for `/sw.js`, `/manifest.webmanifest`, and `/home`, and runs the offline-to-online queue and SMS fallback flow against the server:

```text
PWA v2.0.0
mode      generateSW
precache  12 entries (926.70 KiB)
files generated
  dist/sw.js
  dist/workbox-8d0d8005.js
=== SAATHI Phase 5 Production Offline Verification ===
[1] Production build verified: dist/sw.js (2257 bytes), manifest display="standalone", icons=4
[2] Express production server serving /sw.js (200), /manifest.webmanifest (200), and SPA shell /home (200)
[3] Loaded app online & cached 1 consented SOS contact(s) in IndexedDB: Meera Nair (+919000000011)
[4] Triggered SOS while offline -> queued_offline=true, queue length=1, client_request_id=sos_1791156654759_m7q4l04h
[5] SMS Fallback link ready: sms:+919000000011?body=SAATHI%20SOS%20Emergency%20Alert%20from%20Aarohi%20Sharma%20(11%3A30%20PM).%20I%20need%20help.%20Last%20known%20location%3A%20https%3A%2F%2Fmaps.google.com%2F%3Fq%3D28.61390%2C77.20900
[6] Went online & flushed queue -> delivered=1, remaining=0, server active incident id=59a62635-fb00-4136-ad67-7fbdd0245420 (client_request_id=sos_1791156654759_m7q4l04h)
=== ALL PRODUCTION OFFLINE CHECKS PASSED ===
```

### C. Lighthouse PWA / Installability Result
- **Why Lighthouse CLI could not be run**: The `lighthouse` CLI and a local Chrome/Chromium binary are not installed in this container environment.
- **Static Installability & Manifest Verification**: Verified via `npm run test:offline:prod` that `/manifest.webmanifest` is linked in `index.html`, served with `200 OK`, and contains `id: "/"`, `name`, `short_name`, `start_url: "/"`, `scope: "/"`, `display: "standalone"`, `theme_color: "#0F766E"`, `background_color: "#0F172A"`, `192x192` and `512x512` PNG icons (`any` and `maskable`), and that `dist/sw.js` (Workbox `generateSW`, 12 precached entries) is generated and registered via `registerSW.js`.

---

## 4. What Was Not Done (Out of Scope for Phase 5)
- Real third-party SMS provider integration.
- Contact and responder live-incident pages (scheduled for Phase 6).
