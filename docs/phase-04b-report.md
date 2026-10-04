# Phase 04B Report: Discreet Triggers, Disguise Mode and PIN Settings (Frontend)

## 1. Pre-Phase 5 Fixes & Confirmations (Fixes 1, 2, and 3)

### Fix 1: Disguise Mode — No Default Sequence & Salted Hash Storage
- **No Default Sequence**: `DEFAULT_PERSISTED.disguiseSequenceHash` in `apps/web/src/store/triggerSettingsStore.ts` is initialized to `null`, and `setDisguiseEnabled(true)` refuses to enable disguise mode unless `disguiseSequenceHash` is already configured.
- **Required Custom Sequence + Confirmation Entry**: In `SettingsPage.tsx`, toggling Disguise Mode on when no sequence is configured requires the user to enter and re-enter (confirm) her own secret sequence of at least 4 characters ending with `=` (e.g. `2580=`). Mismatched or short sequences are rejected with a clear error message.
- **Where & How It Is Stored**: The sequence is **stored on-device in `localStorage` (`saathi_trigger_settings_v1`) strictly as a salted SHA-256 hash** (`sha256$<16-byte-random-salt-hex>$<sha256-digest-hex>$<length>`), generated via Web Crypto `crypto.subtle.digest('SHA-256', ...)` + `crypto.getRandomValues`. The plain sequence is **never** stored in `localStorage` or `sessionStorage`. When keys are pressed on `DisguiseCalculator.tsx`, the trailing key buffer is hashed with the stored salt and compared against the stored digest.

### Fix 2: Duress Incident Protection Against Owner "I'm Safe" (`resolve`)
- In `apps/api/src/services/incidentService.ts` (`resolveIncidentForUser`), if `inc.isDuress === true` and the caller is the incident owner (`!isResponderOrAdmin`), the server logs an audit event (`'Owner attempted resolve while incident is under duress; kept active silently'`), **does not transition or close the real incident**, and returns a masked owner-facing DTO with `status: 'RESOLVED'` and `is_duress: false`.
- The owner sees a normal-looking `"You marked yourself safe"` closed screen while the real duress incident remains `ACTIVE` on the server. Only a `responder` or `admin` (or a trusted contact once Phase 6 endpoints are added) can genuinely close a duress incident.
- Tested in `phase4b_triggers_disguise_pins.test.tsx` (Test 9).

### Fix 3: Shadow Alert Isolation During Duress
- Confirmed and hardened in `apps/api/src/services/incidentService.ts`:
  1. **Zero duplicate notifications**: When the user re-triggers SOS while a duress incident is open, `createIncidentForUser` creates a shadow `TRIGGERED` record (`mergedIntoId: existingOpen.id`) and schedules a timer that only transitions the shadow record's status to `ACTIVE` so the owner's screen looks normal — it **never** calls `notifyContactsForActiveIncident` or starts an escalation timer.
  2. **"Cancel" on the shadow flow**: `cancelIncidentForUser` checks `if (!inc.mergedIntoId)` before cancelling activation timers, so cancelling the shadow incident only transitions the shadow row to `CANCELLED` and never touches the real duress incident.
  3. **"I'm safe" (`resolve`) on the shadow flow**: `resolveIncidentForUser` checks `(!realInc.isDuress || isResponderOrAdmin)` before propagating resolution from a merged incident to `inc.mergedIntoId`. Resolving the shadow alert leaves the real duress incident `ACTIVE` and untouched.
- Tested in `phase4b_triggers_disguise_pins.test.tsx` (Test 10).

---

## 2. What Was Built in Phase 4B

1. **Triple-Tap Trigger (`apps/web/src/components/PageLayout.tsx`, `apps/web/src/store/triggerSettingsStore.ts`)**:
   - Configurable tap zone (`logo` header wordmark by default, or `footer` disclaimer area).
   - Tapping 3 times within `1000ms` calls `triggerSos('triple_tap')` and navigates to `/home` so the cancel window is immediately visible.
2. **Keyboard Shortcut Trigger (`apps/web/src/components/DiscreetTriggersManager.tsx`)**:
   - Configurable key combination (default `Shift+Escape`). Pressing the shortcut calls `triggerSos('keyboard_shortcut')`.
3. **Shake Detection Trigger (`apps/web/src/components/DiscreetTriggersManager.tsx`, `SettingsPage.tsx`)**:
   - Uses `DeviceMotionEvent` (`accelerationIncludingGravity`) with a configurable threshold (`15–45 m/s²`, default `25 m/s²`).
   - Handles iOS `DeviceMotionEvent.requestPermission()` with a dedicated button in Settings, and displays a clear unsupported message if `DeviceMotionEvent` is unavailable.
4. **Experimental Voice Code Word Trigger (`apps/web/src/components/DiscreetTriggersManager.tsx`, `SettingsPage.tsx`)**:
   - Uses Web Speech API (`SpeechRecognition` / `webkitSpeechRecognition`).
   - Off by default, labeled *"Experimental — may not work on all devices"*, and gated behind an explicit microphone consent step (`POST /api/consents` with `type: 'microphone'`).
5. **Disguise Mode (`apps/web/src/components/DisguiseCalculator.tsx`, `HomePage.tsx`, `SettingsPage.tsx`)**:
   - Replaces the home screen with a working standard calculator (`+`, `-`, `×`, `÷`, `%`, decimal, clear, backspace) and updates `document.title` (`"Calculator"`) and favicon while disguised.
   - Has **no default secret sequence**; requires custom sequence setup (min length 4, confirm entry) stored as a salted SHA-256 hash on-device.
6. **PIN Settings Screens (`SettingsPage.tsx`)**:
   - On-screen numeric keypad (all buttons `>= 56px`, two-step confirm entry, plain-language explanation) for Cancel PIN (`PUT /api/settings/cancel-pin`) and Silent Duress PIN (`PUT /api/settings/duress-pin`).
   - Rejects matching Cancel and Duress PINs both in the UI and via the backend (`400 Bad Request`). Never stores PINs in browser storage. Reads `has_cancel_pin` and `has_duress_pin` from `/api/me`.
7. **Other Settings & Practice Mode (`SettingsPage.tsx`, `apps/web/src/lib/sos.ts`)**:
   - Toggles for each trigger, cancel window length slider/presets (`0–10s`) via `PUT /api/settings/cancel-window`, disguise mode toggle, and a *"Test in Practice Mode"* button per trigger that intercepts `triggerSos(source)` so zero real incidents are created.
8. **Plain Safety Wording (`SettingsPage.tsx`, `en.json`, `hi.json`)**:
   - Plainly states that discreet triggers can fire by accident or fail on some devices, and that SAATHI complements 112/181.

## 3. Real Test Output (`phase4b_triggers_disguise_pins.test.tsx`)

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
```
