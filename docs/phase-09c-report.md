# Phase 09C Report — Real-Browser End-to-End Tests (Playwright) & Phase 09B Follow-Ups

## 1. Phase 09B Follow-Ups Completed

1. **Follow-up 1 — Voice Trigger Codeword Security (`triggerSettingsStore.ts`, `SettingsPage.tsx`, `DiscreetTriggersManager.tsx`)**:
   - Removed the default `'saathi help'` voice codeword completely (`voiceCodewordHash` defaults to `null`).
   - Required the user to configure her own custom codeword (minimum 6 characters + confirmation entry) before enabling the voice trigger.
   - **Chosen storage approach**: **Salted PBKDF2-SHA256 hash (`200,000` iterations, 16-byte random salt)** stored as `pbkdf2$<iterations>$<saltHex>$<digestHex>$<charLen>` in `localStorage`. The plain codeword is never stored in state or `localStorage`. On-device Web Speech API transcripts are normalized and matched against the stored PBKDF2 hash via sliding window (`verifyVoiceCodewordTranscript`).
   - Verified in `apps/web/src/tests/phase4b_triggers_disguise_pins.test.tsx`.

2. **Follow-up 2 — Disguise-Mode Home Screen Installation Note (`SettingsPage.tsx`, `en.json`, `hi.json`)**:
   - Added the required notice in the disguise-mode settings screen (`data-testid="disguise-install-note"`) in both English (`"If you add the app to your home screen, give it a neutral name during installation. The installed name and icon cannot be changed afterwards."`) and Hindi (`"यदि आप ऐप को अपनी होम स्क्रीन पर जोड़ती हैं, तो इंस्टॉलेशन के दौरान इसे एक सामान्य (तटस्थ) नाम दें। इंस्टॉल किए गए नाम और आइकन को बाद में बदला नहीं जा सकता है।"`).
   - Verified in `apps/web/src/tests/phase4b_triggers_disguise_pins.test.tsx`.

3. **Follow-up 3 — Contrast Audit Note in `docs/phase-09b-report.md`**:
   - Added an explicit note to `docs/phase-09b-report.md` stating that `axe-core` in `jsdom` cannot verify color contrast, so contrast must be checked in a real browser (and that Phase 9C adds a real-browser `@axe-core/playwright` check and Lighthouse commands).

---

## 2. Phase 09C Real-Browser End-to-End Suite (`playwright.config.ts`, `e2e/shakti.spec.ts`, `docs/E2E.md`)

### Task 1: Playwright Configuration & Browser Installation Check
- Added `playwright.config.ts` and `"e2e": "playwright test"` in `package.json`.
- Configured `webServer` to build the production bundle (`npm run build` -> `dist/`) and launch the single Express + WebSocket server on port `3456` with `NODE_ENV=test`, `SERVE_STATIC=true`, `DEMO_MODE=true`, mock providers, and a fresh temporary SQLite database (`shakti_playwright_e2e_<pid>.db`).
- Checked `npx playwright install chromium`: succeeded (`EXIT_CODE=0`, downloaded `Chrome Headless Shell 156.0.8078.4` to `/root/.cache/ms-playwright/chromium_headless_shell-1248`), and verified real headless Chromium execution.

### Task 2 & Task 3: 13 Real-Browser Scenarios (`390x844` Mobile Viewport)
Implemented in `e2e/shakti.spec.ts`:
1. **Normal SOS**: Hold button for 2s -> cancel window passes -> contact notified -> contact opens magic link `/c/:token` and clicks `"I've seen this"` -> user sees `"Help is on the way"` -> user clicks `"I'm safe"` (`RESOLVED`).
2. **Triple-tap trigger & disguise-mode unlock**: Set custom disguise sequence (`258012=`), verify calculator disguise (`Calculator` title & UI), unlock with `258012=`, and trigger SOS via triple-tap on the header logo zone.
3. **Cancel inside window**: Trigger SOS and cancel inside the countdown window; verify zero outbound notifications are sent.
4. **Silent Duress PIN**: Configure Cancel PIN (`1234`) and Duress PIN (`9999`), enter Duress PIN `9999`, verify user screen looks cancelled (`Alert cancelled`) while responder dashboard sees an active `DURESS ALERT`, and responder closes it.
5. **Duplicate trigger merge**: Trigger a second SOS while an incident is open; verify `merged_into_existing: true`.
6. **Offline queue & SMS fallback**: Go offline, trigger SOS, verify queued banner (`Saved on this phone...`) and SMS fallback link, go back online, flush queue, and verify the alert arrives on the server exactly once.
7. **Location unavailable ("Last known at")**: Subsequent geolocation failure after an initial fix displays `Last known at <time>`.
8. **Mutual consent & revocation**: Unaccepted (`invited`) contact receives nothing during an SOS; revoking `location` consent immediately blocks further location sharing (`403`).
9. **Escalation timer**: When no acknowledgement occurs before escalation steps elapse, the user sees the prominent `Call 112 now` prompt.
10. **Closed contact link & RBAC**: Magic link returns `410` (expired/closed card) as soon as the incident closes; wrong roles are rejected (`403`) on responder/admin endpoints.
11. **Retention purge**: Triggers `POST /api/test/retention/purge` (available only when `NODE_ENV=test`) and verifies expired `location_samples` rows are purged.
12. **All external providers failing**: Simulates `PushProvider` and `SmsProvider` failures (`POST /api/test/providers/failure`) with AI assist disabled, verifying the SOS state machine still transitions and resolves deterministically.
13. **Real-browser `@axe-core/playwright` WCAG 2 AA audit (including `color-contrast`)**: Audits Home, the Cancel PIN keypad, Consent Center, the Contact Alert page, the Responder Dashboard, and the Emergency Data Policy page in both **Light** and **Dark** themes with `['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']`. Fixed two real-browser dark-mode contrast issues (`SafetyPulseCard.tsx` `dark:bg-teal-700` and `ResponderDashboardPage.tsx` timeline timestamp `dark:text-slate-300`) and explicit `<select>` label association on `ResponderDashboardPage.tsx` discovered by the real Chromium axe audit.

### Task 4: Documentation (`docs/E2E.md`)
- Wrote `docs/E2E.md` with exact commands to install dependencies and Chromium, run `npm run e2e`, and run Google Lighthouse (`npx lighthouse http://localhost:3000 --view`) against the production build to record PWA, accessibility, and performance scores.

---

## 3. Verification Output

### `npx playwright test --list`
```text
Listing tests:
  [chromium-mobile] › shakti.spec.ts:83:3 › SHAKTI Phase 9C: Real-Browser End-to-End Scenarios (390x844) › 1. Normal SOS: trigger by holding the button, cancel window passes, contact notified, contact acknowledges, user resolves
  [chromium-mobile] › shakti.spec.ts:134:3 › SHAKTI Phase 9C: Real-Browser End-to-End Scenarios (390x844) › 2. Triple-tap trigger and disguise-mode unlock
  [chromium-mobile] › shakti.spec.ts:167:3 › SHAKTI Phase 9C: Real-Browser End-to-End Scenarios (390x844) › 3. Cancel inside the window sends nothing
  [chromium-mobile] › shakti.spec.ts:197:3 › SHAKTI Phase 9C: Real-Browser End-to-End Scenarios (390x844) › 4. Duress PIN: the user screen looks cancelled; a responder still sees the alert active; a responder closes it
  [chromium-mobile] › shakti.spec.ts:254:3 › SHAKTI Phase 9C: Real-Browser End-to-End Scenarios (390x844) › 5. Duplicate trigger is merged
  [chromium-mobile] › shakti.spec.ts:283:3 › SHAKTI Phase 9C: Real-Browser End-to-End Scenarios (390x844) › 6. Offline: go offline, trigger SOS, see the queued state and the SMS option, go online, the alert arrives exactly once
  [chromium-mobile] › shakti.spec.ts:331:3 › SHAKTI Phase 9C: Real-Browser End-to-End Scenarios (390x844) › 7. Location unavailable shows "last known" with a label
  [chromium-mobile] › shakti.spec.ts:387:3 › SHAKTI Phase 9C: Real-Browser End-to-End Scenarios (390x844) › 8. A contact receives nothing before accepting; revoking consent stops sharing
  [chromium-mobile] › shakti.spec.ts:481:3 › SHAKTI Phase 9C: Real-Browser End-to-End Scenarios (390x844) › 9. Escalation: no acknowledgement leads to the "Call 112 now" prompt
  [chromium-mobile] › shakti.spec.ts:500:3 › SHAKTI Phase 9C: Real-Browser End-to-End Scenarios (390x844) › 10. Contact link stops working after the incident closes; wrong roles are rejected
  [chromium-mobile] › shakti.spec.ts:547:3 › SHAKTI Phase 9C: Real-Browser End-to-End Scenarios (390x844) › 11. Retention purge removes expired location data (via NODE_ENV=test hook)
  [chromium-mobile] › shakti.spec.ts:606:3 › SHAKTI Phase 9C: Real-Browser End-to-End Scenarios (390x844) › 12. SOS works with push, SMS and AI providers all failing
  [chromium-mobile] › shakti.spec.ts:633:3 › SHAKTI Phase 9C: Real-Browser End-to-End Scenarios (390x844) › 13. Real-browser @axe-core/playwright WCAG 2 AA (including color-contrast) on Home, cancel keypad, Consent Center, contact page, responder dashboard, and policy page in light and dark mode
Total: 13 tests in 1 file
```

### Real-Browser Playwright Run (`npm run e2e`)
```text
13 passed (1.4m)
```

### Full Vitest Unit/Integration Suite (`npm test`)
```text
Test Files  32 passed (32)
Tests       146 passed (146)
```
