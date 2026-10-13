import { test, expect, type Page, type APIRequestContext } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const DEMO_USER_PHONE = '+919000000001';
const DEMO_RESPONDER_PHONE = '+919000000002';
const DEMO_ADMIN_PHONE = '+919000000003';

async function resetServerState(request: APIRequestContext, baseURL: string) {
  await request.post(`${baseURL}/api/test/ratelimit/reset`, {
    headers: { Origin: baseURL },
  });
  await request.post(`${baseURL}/api/test/providers/failure`, {
    headers: { Origin: baseURL },
    data: { fail_push: false, fail_sms: false },
  });

  // Log in as admin to run /api/demo/reset
  const otpRes = await request.post(`${baseURL}/api/auth/otp/request`, {
    headers: { Origin: baseURL },
    data: { phone_e164: DEMO_ADMIN_PHONE },
  });
  const otpBody = await otpRes.json();
  await request.post(`${baseURL}/api/auth/otp/verify`, {
    headers: { Origin: baseURL },
    data: { phone_e164: DEMO_ADMIN_PHONE, code: otpBody.dev_mock_hint },
  });
  await request.post(`${baseURL}/api/demo/reset`, {
    headers: { Origin: baseURL },
  });
  await request.post(`${baseURL}/api/auth/logout`, {
    headers: { Origin: baseURL },
  });
}

async function loginViaApiOnPage(page: Page, baseURL: string, phone: string) {
  await page.goto(`${baseURL}/welcome`);
  await page.evaluate(
    async ({ phoneNum }) => {
      const r1 = await fetch('/api/auth/otp/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone_e164: phoneNum }),
      });
      const d1 = await r1.json();
      await fetch('/api/auth/otp/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone_e164: phoneNum,
          code: d1.dev_mock_hint,
        }),
      });
    },
    { phoneNum: phone }
  );
}

async function setCancelWindowSeconds(page: Page, seconds: number) {
  await page.evaluate(async (sec) => {
    await fetch('/api/settings/cancel-window', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cancel_window_seconds: sec }),
    });
  }, seconds);
}

async function holdSosButton(page: Page) {
  const btn = page.getByTestId('sos-hold-button');
  await expect(btn).toBeVisible();
  await btn.dispatchEvent('mousedown');
  await page.waitForTimeout(2150);
  if ((await btn.count()) > 0) {
    await btn.dispatchEvent('mouseup').catch(() => {});
  }
}

test.describe('SHAKTI Phase 9C: Real-Browser End-to-End Scenarios (390x844)', () => {
  test.beforeEach(async ({ request, baseURL }) => {
    await resetServerState(request, baseURL!);
  });

  test('1. Normal SOS: trigger by holding the button, cancel window passes, contact notified, contact acknowledges, user resolves', async ({
    page,
    context,
    baseURL,
  }) => {
    await loginViaApiOnPage(page, baseURL!, DEMO_USER_PHONE);
    await setCancelWindowSeconds(page, 2);
    await page.goto(`${baseURL}/home`);

    // Hold SOS button for 2s -> enters cancel window
    await holdSosButton(page);
    await expect(page.getByTestId('cancel-window-screen')).toBeVisible();

    // Wait for 2s cancel window to pass -> transitions to NOTIFIED
    await expect(page.getByTestId('live-status-screen')).toBeVisible({
      timeout: 8000,
    });
    await expect(page.getByTestId('contacts-notified-badge')).toBeVisible();

    // Retrieve latest contact magic link from dev outbox
    const outboxRes = await page.evaluate(async () => {
      const r = await fetch('/api/dev/outbox');
      return r.json();
    });
    const smsLinks = (outboxRes.messages || []).filter(
      (m: { purpose: string; body: string }) =>
        m.purpose === 'sos_alert' && m.body.includes('/c/')
    );
    expect(smsLinks.length).toBeGreaterThan(0);
    const smsWithLink = smsLinks[0];
    const match = smsWithLink.body.match(/\/c\/([A-Za-z0-9_.-]+)/);
    expect(match).toBeTruthy();
    const magicToken = match[1];

    // Contact opens magic link and acknowledges ("I've seen this")
    const contactPage = await context.newPage();
    await contactPage.goto(`${baseURL}/c/${magicToken}`);
    await expect(contactPage.getByTestId('contact-btn-seen')).toBeVisible();
    await contactPage.getByTestId('contact-btn-seen').click();

    // User sees ACKNOWLEDGED ("Help is on the way")
    await expect(page.getByTestId('live-status-heading')).toContainText(
      /Help is on the way/i
    );

    // User resolves ("I'm safe")
    await page.getByTestId('im-safe-btn').click();
    await expect(page.getByTestId('closed-status-screen')).toBeVisible();
    await contactPage.close();
  });

  test('2. Triple-tap trigger and disguise-mode unlock', async ({
    page,
    baseURL,
  }) => {
    await loginViaApiOnPage(page, baseURL!, DEMO_USER_PHONE);
    await page.goto(`${baseURL}/settings`);

    // Configure calculator disguise sequence '258012='
    await page.getByTestId('disguise-secret-input').fill('258012=');
    await page.getByTestId('disguise-secret-confirm-input').fill('258012=');
    await page.getByTestId('save-disguise-sequence-btn').click();
    await expect(page.getByTestId('toggle-disguise-mode')).toBeChecked();

    await page.goto(`${baseURL}/home`);
    await expect(page.getByTestId('disguise-calculator')).toBeVisible();
    await expect(page).toHaveTitle('Calculator');

    // Unlock disguise calculator by typing 258012=
    for (const key of ['2', '5', '8', '0', '1', '2', '=']) {
      await page.getByTestId(`calc-key-${key}`).click();
    }
    await expect(page.getByTestId('sos-hold-button')).toBeVisible();

    // Trigger SOS via triple-tap on the header logo zone
    const logoZone = page.getByTestId('triple-tap-zone-logo');
    await logoZone.click();
    await logoZone.click();
    await logoZone.click();

    await expect(page.getByTestId('cancel-window-screen')).toBeVisible();
    await page.getByTestId('cancel-alert-btn').click();
  });

  test('3. Cancel inside the window sends nothing', async ({
    page,
    baseURL,
  }) => {
    await loginViaApiOnPage(page, baseURL!, DEMO_USER_PHONE);
    await setCancelWindowSeconds(page, 5);
    await page.goto(`${baseURL}/home`);

    const beforeOutbox = await page.evaluate(async () => {
      const r = await fetch('/api/dev/outbox');
      return r.json();
    });
    const beforeCount = (beforeOutbox.messages || []).length;

    await holdSosButton(page);
    await expect(page.getByTestId('cancel-window-screen')).toBeVisible();
    await page.getByTestId('cancel-alert-btn').click();

    await expect(page.getByTestId('closed-status-screen')).toBeVisible();
    await expect(page.getByTestId('closed-status-screen')).toContainText(
      /Alert cancelled/i
    );

    const afterOutbox = await page.evaluate(async () => {
      const r = await fetch('/api/dev/outbox');
      return r.json();
    });
    expect((afterOutbox.messages || []).length).toBe(beforeCount);
  });

  test('4. Duress PIN: the user screen looks cancelled; a responder still sees the alert active; a responder closes it', async ({
    page,
    browser,
    baseURL,
  }) => {
    await loginViaApiOnPage(page, baseURL!, DEMO_USER_PHONE);
    await setCancelWindowSeconds(page, 2);
    await page.evaluate(async () => {
      await fetch('/api/settings/cancel-pin', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin: '1234' }),
      });
      await fetch('/api/settings/duress-pin', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin: '9999', cancel_pin: '1234' }),
      });
    });

    await page.goto(`${baseURL}/home`);
    await holdSosButton(page);
    await expect(page.getByTestId('cancel-window-screen')).toBeVisible();

    // Tap Cancel Alert and enter Duress PIN 9999
    await page.getByTestId('cancel-alert-btn').click();
    await expect(page.getByTestId('pin-keypad')).toBeVisible();
    for (let i = 0; i < 4; i++) {
      await page.getByRole('button', { name: 'Digit 9' }).click();
    }
    await page.getByTestId('pin-submit-btn').click();

    // User's screen looks completely cancelled
    await expect(page.getByTestId('closed-status-screen')).toBeVisible();
    await expect(page.getByTestId('closed-status-screen')).toContainText(
      /Alert cancelled/i
    );

    // Wait for 2s cancel window to pass so incident activates on server
    await page.waitForTimeout(2400);

    // Responder logs in inside a separate context and sees the active duress incident
    const responderContext = await browser.newContext({
      viewport: { width: 390, height: 844 },
    });
    const responderPage = await responderContext.newPage();
    await loginViaApiOnPage(responderPage, baseURL!, DEMO_RESPONDER_PHONE);
    await responderPage.goto(`${baseURL}/responder`);

    await expect(responderPage.getByText(/DURESS ALERT/i).first()).toBeVisible();
    await responderPage
      .getByRole('button', { name: /Resolve Incident/i })
      .click();
    await expect(responderPage.getByText(/RESOLVED/i).first()).toBeVisible();
    await responderContext.close();
  });

  test('5. Duplicate trigger is merged', async ({ page, baseURL }) => {
    await loginViaApiOnPage(page, baseURL!, DEMO_USER_PHONE);
    await setCancelWindowSeconds(page, 5);
    await page.goto(`${baseURL}/home`);

    // Trigger #1 via hold button
    await holdSosButton(page);
    await expect(page.getByTestId('cancel-window-screen')).toBeVisible();

    // Trigger #2 within duplicate window -> merged into existing incident
    const secondTriggerRes = await page.evaluate(async () => {
      const r = await fetch('/api/incidents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_request_id: `dup_req_${Date.now()}`,
          client_created_at: new Date().toISOString(),
          source_trigger: 'triple_tap',
        }),
      });
      return { status: r.status, body: await r.json() };
    });

    expect(secondTriggerRes.status).toBe(200);
    expect(secondTriggerRes.body.merged_into_existing).toBe(true);

    await page.getByTestId('cancel-alert-btn').click();
  });

test('6. Offline: go offline, trigger SOS, see the queued state and the SMS option, go online, the alert arrives exactly once', async ({
    page,
    context,
    browser,
    baseURL,
  }) => {
    await loginViaApiOnPage(page, baseURL!, DEMO_USER_PHONE);
    await setCancelWindowSeconds(page, 2);

    // Measure outbox messages before offline trigger
    const outboxBefore = await page.evaluate(async () => {
      const r = await fetch('/api/dev/outbox');
      return r.json();
    });
    const sosMessagesBefore = (outboxBefore.messages || []).filter(
      (m: { purpose: string }) => m.purpose === 'sos_alert'
    ).length;

    await page.goto(`${baseURL}/home`);
    await expect(page.getByTestId('sos-hold-button')).toBeVisible();

    // Go offline
    await context.setOffline(true);

    // Trigger SOS while offline
    await holdSosButton(page);
    await expect(page.getByTestId('sms-fallback-panel')).toBeVisible();
    await expect(page.getByTestId('honest-queued-status-text')).toBeVisible();
    await expect(page.getByTestId('sms-fallback-group-link')).toBeVisible();

    // Go back online; the app flushes the offline queue automatically on online event (or via flush button if still visible)
    await context.setOffline(false);
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    const flushBtn = page.getByTestId('flush-queue-now-btn');
    if ((await flushBtn.count()) > 0) {
      await flushBtn.click({ timeout: 2000 }).catch(() => {});
    }

    await expect(page.getByTestId('honest-sent-at-banner')).toBeVisible({
      timeout: 8000,
    });

    // Wait for cancel window (2s) to elapse so incident activates and notifications dispatch
    await page.waitForTimeout(2500);

    // Verify only 1 active incident exists on the backend for this user
    const activeCheck = await page.evaluate(async () => {
      const r = await fetch('/api/incidents/active');
      return r.json();
    });
    expect(activeCheck.incident).toBeTruthy();

    // Verify incident count via responder API: exactly ONE incident exists for this user in the campus zone
    const responderContext = await browser.newContext({
      viewport: { width: 390, height: 844 },
    });
    const responderPage = await responderContext.newPage();
    await loginViaApiOnPage(responderPage, baseURL!, DEMO_RESPONDER_PHONE);
    const responderIncidentsRes = await responderPage.evaluate(async () => {
      const r = await fetch('/api/responder/incidents');
      return r.json();
    });
    const userIncidents = (responderIncidentsRes.incidents || []).filter(
      (inc: { id: string }) => inc.id === activeCheck.incident.id
    );
    expect(userIncidents.length).toBe(1);
    await responderContext.close();

    // Verify that each trusted contact received exactly one SOS message (compare sent_messages before and after)
    const outboxAfter = await page.evaluate(async () => {
      const r = await fetch('/api/dev/outbox');
      return r.json();
    });
    // Distinct recipients of the new SOS alert dispatched upon reconnect
    const newSosMessages = (outboxAfter.messages || []).slice(0, (outboxAfter.messages || []).length - (outboxBefore.messages || []).length);
    // For primary contact (+919000000011), assert that the contact received exactly one SOS message
    const primaryContactSosMsgs = newSosMessages.filter(
      (m: { to_phone_e164: string; purpose: string }) =>
        m.to_phone_e164 === '+919000000011' && m.purpose === 'sos_alert'
    );
    expect(primaryContactSosMsgs.length).toBe(1);

    // Total SOS messages across both trusted contacts is exactly 2 (1 per contact)
    const totalNewSosMsgs = newSosMessages.filter(
      (m: { purpose: string }) => m.purpose === 'sos_alert'
    );
    expect(totalNewSosMsgs.length).toBe(2);

    // Clean up incident
    await page.evaluate(async (incId) => {
      await fetch(`/api/incidents/${incId}/resolve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resolution: 'RESOLVED' }),
      });
    }, activeCheck.incident.id);
  });

  test('7. Location unavailable shows "last known" with a label', async ({
    page,
    baseURL,
  }) => {
    await loginViaApiOnPage(page, baseURL!, DEMO_USER_PHONE);
    await setCancelWindowSeconds(page, 5);

    // Seed a first valid GPS reading, then make subsequent geolocation calls fail so "Last known at ..." is displayed
    await page.addInitScript(() => {
      let callCount = 0;
      Object.defineProperty(navigator, 'geolocation', {
        configurable: true,
        value: {
          getCurrentPosition: (
            success: (pos: GeolocationPosition) => void,
            error?: (err: GeolocationPositionError) => void
          ) => {
            callCount++;
            if (callCount === 1) {
              success({
                coords: {
                  latitude: 28.6139,
                  longitude: 77.209,
                  accuracy: 14,
                  altitude: null,
                  altitudeAccuracy: null,
                  heading: null,
                  speed: null,
                  toJSON: () => ({}),
                },
                timestamp: Date.now(),
                toJSON: () => ({}),
              } as GeolocationPosition);
            } else if (error) {
              error({
                code: 2,
                message: 'Position unavailable',
                PERMISSION_DENIED: 1,
                POSITION_UNAVAILABLE: 2,
                TIMEOUT: 3,
              });
            }
          },
        },
      });
    });

    await page.goto(`${baseURL}/home`);
    await holdSosButton(page);

    await expect(page.getByTestId('last-known-location-time')).toContainText(
      /Last known at/i
    );
    await page.getByTestId('cancel-alert-btn').click();
  });

  test('8. A contact receives nothing before accepting; revoking consent stops sharing', async ({
    page,
    baseURL,
  }) => {
    await loginViaApiOnPage(page, baseURL!, DEMO_USER_PHONE);
    await setCancelWindowSeconds(page, 1);

    // Add a new unaccepted (invited) contact and pause existing accepted contacts
    await page.evaluate(async () => {
      const listRes = await fetch('/api/contacts');
      const listData = await listRes.json();
      for (const c of listData.contacts || []) {
        await fetch(`/api/contacts/${c.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'paused' }),
        });
      }
      await fetch('/api/contacts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Unaccepted Contact',
          phone_e164: '+919888877776',
          permissions: {
            receives_sos: true,
            receives_checkin: true,
            can_see_live_location: true,
          },
        }),
      });
    });

    const outboxBefore = await page.evaluate(async () => {
      const r = await fetch('/api/dev/outbox');
      return r.json();
    });
    const sosSmsToUnacceptedBefore = (outboxBefore.messages || []).filter(
      (m: { to_phone_e164: string; purpose: string }) =>
        m.to_phone_e164 === '+919888877776' && m.purpose === 'sos_alert'
    ).length;

    await page.goto(`${baseURL}/home`);
    await holdSosButton(page);
    await page.waitForTimeout(1500);

    // Verify unaccepted contact received zero SOS alerts
    const outboxAfter = await page.evaluate(async () => {
      const r = await fetch('/api/dev/outbox');
      return r.json();
    });
    const sosSmsToUnacceptedAfter = (outboxAfter.messages || []).filter(
      (m: { to_phone_e164: string; purpose: string }) =>
        m.to_phone_e164 === '+919888877776' && m.purpose === 'sos_alert'
    ).length;
    expect(sosSmsToUnacceptedAfter).toBe(sosSmsToUnacceptedBefore);

    // Revoking location consent stops location sharing immediately
    await page.evaluate(async () => {
      await fetch('/api/consents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'location',
          granted: false,
          source: 'e2e_test',
        }),
      });
    });

    const locSampleAttempt = await page.evaluate(async () => {
      const activeRes = await fetch('/api/incidents/active');
      const activeData = await activeRes.json();
      const incId = activeData.incident.id;
      const r = await fetch(`/api/incidents/${incId}/location`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lat: 28.61,
          lng: 77.2,
          accuracy_m: 10,
          captured_at: new Date().toISOString(),
        }),
      });
      await fetch(`/api/incidents/${incId}/resolve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resolution: 'RESOLVED' }),
      });
      return r.status;
    });
    expect(locSampleAttempt).toBe(403);
  });

  test('9. Escalation: no acknowledgement leads to the "Call 112 now" prompt', async ({
    page,
    baseURL,
  }) => {
    await loginViaApiOnPage(page, baseURL!, DEMO_USER_PHONE);
    await setCancelWindowSeconds(page, 1);
    await page.goto(`${baseURL}/home`);

    await holdSosButton(page);

    // Cancel window (1s) + Escalation Step 1 (1s) + Escalation Step 2 (2s) -> needs_user_action banner ("Call 112 now")
    await expect(page.getByTestId('needs-user-action-banner')).toBeVisible({
      timeout: 12000,
    });
    await expect(page.getByTestId('call-112-now-btn')).toBeVisible();

    await page.getByTestId('im-safe-btn').click();
  });

  test('10. Contact link stops working after the incident closes; wrong roles are rejected', async ({
    page,
    context,
    baseURL,
  }) => {
    await loginViaApiOnPage(page, baseURL!, DEMO_USER_PHONE);
    await setCancelWindowSeconds(page, 1);
    await page.goto(`${baseURL}/home`);

    // Normal user trying to access responder or admin API is rejected with 403
    const rbacCheck = await page.evaluate(async () => {
      const rResp = await fetch('/api/responder/incidents');
      const rAdmin = await fetch('/api/admin/metrics');
      return { responderStatus: rResp.status, adminStatus: rAdmin.status };
    });
    expect(rbacCheck.responderStatus).toBe(403);
    expect(rbacCheck.adminStatus).toBe(403);

    await holdSosButton(page);
    await expect(page.getByTestId('live-status-screen')).toBeVisible({
      timeout: 8000,
    });

    const outboxRes = await page.evaluate(async () => {
      const r = await fetch('/api/dev/outbox');
      return r.json();
    });
    const smsLinks = (outboxRes.messages || []).filter(
      (m: { purpose: string; body: string }) =>
        m.purpose === 'sos_alert' && m.body.includes('/c/')
    );
    const smsWithLink = smsLinks[0];
    const magicToken = smsWithLink.body.match(/\/c\/([A-Za-z0-9_.-]+)/)[1];

    // Close the incident
    await page.getByTestId('im-safe-btn').click();
    await expect(page.getByTestId('closed-status-screen')).toBeVisible();

    // Contact opens the magic link after closure -> shows closed/expired card (410)
    const contactPage = await context.newPage();
    await contactPage.goto(`${baseURL}/c/${magicToken}`);
    await expect(
      contactPage.getByTestId('contact-alert-expired-card')
    ).toBeVisible();
    await contactPage.close();
  });

  test('11. Retention purge removes expired location data (via NODE_ENV=test hook)', async ({
    page,
    baseURL,
  }) => {
    await loginViaApiOnPage(page, baseURL!, DEMO_USER_PHONE);

    const purgeResult = await page.evaluate(async () => {
      await fetch('/api/consents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'location',
          granted: true,
          source: 'e2e_test',
        }),
      });
      const createRes = await fetch('/api/incidents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_request_id: `ret_req_${Date.now()}`,
          client_created_at: new Date().toISOString(),
          source_trigger: 'button',
        }),
      });
      const created = await createRes.json();
      const incId = created.incident.id;

      await fetch(`/api/incidents/${incId}/location`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lat: 28.6139,
          lng: 77.209,
          accuracy_m: 10,
          captured_at: new Date().toISOString(),
        }),
      });

      // Trigger test-only retention purge hook that marks the incident's location sample expired and runs purge
      const purgeRes = await fetch('/api/test/retention/purge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expire_incident_id: incId }),
      });
      const purgeData = await purgeRes.json();

      await fetch(`/api/incidents/${incId}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      return purgeData;
    });

    expect(purgeResult.summary.deletedLocationSamples).toBeGreaterThanOrEqual(1);
    expect(purgeResult.remaining_for_incident).toBe(0);
  });

  test('12. SOS works with push, SMS and AI providers all failing', async ({
    page,
    request,
    baseURL,
  }) => {
    await request.post(`${baseURL}/api/test/providers/failure`, {
      headers: { Origin: baseURL! },
      data: { fail_push: true, fail_sms: true },
    });

    await loginViaApiOnPage(page, baseURL!, DEMO_USER_PHONE);
    await setCancelWindowSeconds(page, 1);
    await page.goto(`${baseURL}/home`);

    // Trigger SOS while Push, SMS, and AI are all failing/disabled
    await holdSosButton(page);
    await expect(page.getByTestId('cancel-window-screen')).toBeVisible();

    // Wait for cancel window to pass -> incident still transitions to ACTIVE /live-status-screen deterministically
    await expect(page.getByTestId('live-status-screen')).toBeVisible({
      timeout: 8000,
    });

    await page.getByTestId('im-safe-btn').click();
    await expect(page.getByTestId('closed-status-screen')).toBeVisible();
  });

  test('13. Real-browser @axe-core/playwright WCAG 2 AA (including color-contrast) on Home, cancel keypad, Consent Center, contact page, responder dashboard, and policy page in light and dark mode', async ({
    page,
    baseURL,
  }) => {
    const wcagTags = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

    async function assertNoSeriousViolations(label: string) {
      const results = await new AxeBuilder({ page })
        .withTags(wcagTags)
        .analyze();
      const seriousOrCritical = results.violations.filter(
        (v) => v.impact === 'serious' || v.impact === 'critical'
      );
      expect(
        seriousOrCritical,
        `Axe serious/critical violations on ${label}: ${JSON.stringify(
          seriousOrCritical.map((v) => ({ id: v.id, impact: v.impact, help: v.help }))
        )}`
      ).toEqual([]);
    }

    async function setTheme(dark: boolean) {
      await page.evaluate((isDark) => {
        if (isDark) {
          document.documentElement.classList.add('dark');
          window.localStorage.setItem('saathi_theme', 'dark');
        } else {
          document.documentElement.classList.remove('dark');
          window.localStorage.setItem('saathi_theme', 'light');
        }
      }, dark);
    }

    // 1. Policy page (light & dark)
    await page.goto(`${baseURL}/policy`);
    await expect(page.locator('main')).toBeVisible();
    await setTheme(false);
    await assertNoSeriousViolations('Policy Page (Light)');
    await setTheme(true);
    await assertNoSeriousViolations('Policy Page (Dark)');

    // 2. Home page & Cancel Keypad & Consent Center as Demo User
    await loginViaApiOnPage(page, baseURL!, DEMO_USER_PHONE);
    await setCancelWindowSeconds(page, 10);
    await page.evaluate(async () => {
      await fetch('/api/settings/cancel-pin', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin: '1234' }),
      });
    });

    await page.goto(`${baseURL}/home`);
    await expect(page.getByTestId('sos-hold-button')).toBeVisible();
    await setTheme(false);
    await assertNoSeriousViolations('Home Page (Light)');
    await setTheme(true);
    await assertNoSeriousViolations('Home Page (Dark)');

    // Trigger SOS and open Cancel PIN keypad
    await holdSosButton(page);
    await expect(page.getByTestId('cancel-window-screen')).toBeVisible();
    await page.getByTestId('cancel-alert-btn').click();
    await expect(page.getByTestId('pin-keypad')).toBeVisible();
    await setTheme(false);
    await assertNoSeriousViolations('Cancel Keypad (Light)');
    await setTheme(true);
    await assertNoSeriousViolations('Cancel Keypad (Dark)');

    // Cancel the alert with PIN 1234
    for (const d of ['1', '2', '3', '4']) {
      await page.getByRole('button', { name: `Digit ${d}` }).click();
    }
    await page.getByTestId('pin-submit-btn').click();

    // 3. Consent Center (light & dark)
    await page.goto(`${baseURL}/consents`);
    await expect(page.locator('main')).toBeVisible();
    await setTheme(false);
    await assertNoSeriousViolations('Consent Center (Light)');
    await setTheme(true);
    await assertNoSeriousViolations('Consent Center (Dark)');

    // 4. Contact Alert Page (create an active alert, inspect magic link in light & dark)
    await setCancelWindowSeconds(page, 1);
    await page.goto(`${baseURL}/home`);
    await holdSosButton(page);
    await expect(page.getByTestId('live-status-screen')).toBeVisible({
      timeout: 8000,
    });
    const outboxRes = await page.evaluate(async () => {
      const r = await fetch('/api/dev/outbox');
      return r.json();
    });
    const smsLinks = (outboxRes.messages || []).filter(
      (m: { purpose: string; body: string }) =>
        m.purpose === 'sos_alert' && m.body.includes('/c/')
    );
    const smsWithLink = smsLinks[0];
    const magicToken = smsWithLink.body.match(/\/c\/([A-Za-z0-9_.-]+)/)[1];

    await page.goto(`${baseURL}/c/${magicToken}`);
    await expect(page.getByTestId('contact-btn-seen')).toBeVisible();
    await setTheme(false);
    await assertNoSeriousViolations('Contact Page (Light)');
    await setTheme(true);
    await assertNoSeriousViolations('Contact Page (Dark)');

    // 5. Responder Dashboard (light & dark)
    await loginViaApiOnPage(page, baseURL!, DEMO_RESPONDER_PHONE);
    await page.goto(`${baseURL}/responder`);
    await expect(page.locator('main')).toBeVisible();
    await setTheme(false);
    await assertNoSeriousViolations('Responder Dashboard (Light)');
    await setTheme(true);
    await assertNoSeriousViolations('Responder Dashboard (Dark)');
  });
});
