# Real-Browser End-to-End (Playwright) & Lighthouse Testing Guide

This guide explains how to run the **SHAKTI** real-browser Playwright end-to-end test suite (12 functional scenarios + 1 real-browser `@axe-core/playwright` WCAG 2.2 AA & color-contrast check) and how to run Google Lighthouse against the production build.

---

## 1. Install Dependencies & Chromium Browser

From the repository root on your computer:

```bash
# 1. Install project dependencies
npm install

# 2. Install Playwright's headless Chromium browser binary
npx playwright install chromium
```

> If you are on a fresh Linux machine and need system libraries for Chromium, run:
> ```bash
> npx playwright install --with-deps chromium
> ```

---

## 2. Run the End-to-End Suite (`npm run e2e`)

The `npm run e2e` script uses `playwright.config.ts` to:
1. Build the production frontend bundle (`npm run build` -> `dist/`).
2. Start the single-process Express + WebSocket server on a dedicated test port (`3456`) with:
   - `NODE_ENV=test`
   - `SERVE_STATIC=true` (serves the built production bundle from `dist/`)
   - `DEMO_MODE=true` (seeds demo accounts, accepted contacts, responder, and resources)
   - A fresh temporary SQLite database in the OS temp directory (`DATABASE_URL=file:/tmp/shakti_playwright_e2e_<pid>.db`)
   - Mock SMS, Push, OTP, and 112 Gateway providers

```bash
# List all 13 Playwright E2E scenarios
npx playwright test --list

# Run all 13 Playwright E2E scenarios in headless Chromium (390x844 mobile viewport)
npm run e2e
```

### Scenarios Covered (`e2e/shakti.spec.ts`)
1. **Normal SOS**: Trigger by holding the SOS button for 2 seconds, cancel window passes, trusted contact is notified via SMS magic link, contact acknowledges ("I've seen this"), and user resolves ("I'm safe").
2. **Triple-tap trigger & disguise-mode unlock**: Configure calculator disguise sequence, verify page title/UI is disguised as `Calculator`, unlock with secret sequence, and trigger SOS via triple-tapping the header logo zone.
3. **Cancel inside window**: Trigger SOS and cancel inside the countdown window; verify zero outbound notifications are dispatched.
4. **Silent Duress PIN**: Configure Cancel PIN (`1234`) and Duress PIN (`9999`), cancel with Duress PIN `9999`, verify user screen looks cancelled (`Alert cancelled`) while responder dashboard sees an active `DURESS ALERT`, and responder closes it.
5. **Duplicate trigger merge**: Trigger a second SOS while an incident is already open within the duplicate window; verify `merged_into_existing: true`.
6. **Offline queue & SMS fallback**: Go offline, trigger SOS, verify honest queued banner (`Saved on this phone...`) and one-tap SMS fallback link, go back online, flush queue, and verify the alert arrives on the server exactly once.
7. **Location unavailable ("Last known at")**: When subsequent GPS fixes fail after an initial reading, verify the alert screen displays `Last known at <time>`.
8. **Mutual consent & revocation**: Verify an unaccepted (`invited`) contact receives nothing during an SOS, and revoking `location` consent immediately blocks further location sharing (`403`).
9. **Escalation timer**: Verify that when no contact or responder acknowledges before the escalation steps elapse, the user sees the prominent `Call 112 now` banner.
10. **Closed contact link & RBAC**: Verify the contact magic link stops working (`410`) as soon as the incident closes, and non-privileged roles are rejected (`403`) on responder/admin endpoints.
11. **Retention purge**: Trigger the `NODE_ENV=test`-only hook (`POST /api/test/retention/purge`) and verify expired `location_samples` rows are deleted.
12. **Deterministic SOS with all external providers failing**: Simulate `PushProvider` and `SmsProvider` failures (`POST /api/test/providers/failure`) with AI assist disabled, and verify the core SOS state machine still transitions and resolves cleanly.
13. **Real-browser `@axe-core/playwright` WCAG 2 AA audit (including color-contrast)**: Runs `AxeBuilder` with tags `['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']` on Home, the Cancel PIN keypad, Consent Center, the Contact Alert page, the Responder Dashboard, and the Emergency Data Policy page in both **Light** and **Dark** themes, failing on any `serious` or `critical` violation.

---

## 3. Run Lighthouse (PWA, Accessibility & Performance Scores)

To record Lighthouse scores against the production build on a normal computer:

```bash
# Terminal 1: Build the production bundle and start the single server on port 3000
npm run build
JWT_SECRET_KEY="production-test-secret-key-at-least-32-chars" \
HMAC_SECRET_KEY="production-test-hmac-secret-at-least-32-chars" \
ALLOW_MOCK_PROVIDERS=true \
NODE_ENV=production \
npx tsx apps/api/server.ts
```

```bash
# Terminal 2: Run Lighthouse against http://localhost:3000
npx lighthouse http://localhost:3000 --view

# Or save an HTML + JSON report without opening a browser window:
npx lighthouse http://localhost:3000 \
  --output html --output json \
  --output-path ./lighthouse-report \
  --chrome-flags="--headless=new --no-sandbox"
```
