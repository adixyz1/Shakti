# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: shakti.spec.ts >> SHAKTI Phase 9C: Real-Browser End-to-End Scenarios (390x844) >> 8. A contact receives nothing before accepting; revoking consent stops sharing
- Location: e2e/shakti.spec.ts:437:3

# Error details

```
Test timeout of 45000ms exceeded.
```

```
Error: locator.dispatchEvent: Test timeout of 45000ms exceeded.
Call log:
  - waiting for getByTestId('sos-hold-button')

```

# Page snapshot

```yaml
- generic [ref=f1e3]:
  - link "Skip to main content" [ref=f1e4] [cursor=pointer]:
    - /url: "#main-content"
  - region "Demo mode notice" [ref=f1e5]:
    - generic [ref=f1e6]: "DEMO MODE: no real alerts are sent"
    - generic [ref=f1e10]:
      - generic [ref=f1e11]: "SMS: MockSmsProvider [MOCK]"
      - generic [aria-hidden] [ref=f1e12]: ·
      - generic [ref=f1e13]: "Push: MockPushProvider [MOCK]"
      - generic [aria-hidden] [ref=f1e14]: ·
      - generic [ref=f1e15]: "112: MockEmergencyGateway [MOCK]"
  - banner [ref=f1e16]:
    - link "SHAKTI" [ref=f1e17] [cursor=pointer]:
      - /url: /home
    - generic [ref=f1e18]:
      - status [ref=f1e19]
      - group "Language" [ref=f1e24]:
        - button "English" [pressed] [ref=f1e25]
        - button "हिन्दी" [ref=f1e26]
      - button "Dark mode" [ref=f1e27]
      - button "Log Out" [ref=f1e30]
  - main [ref=f1e31]:
    - generic [ref=f1e32]:
      - status [ref=f1e33]
      - region "Trusted contact warning" [ref=f1e34]:
        - paragraph [ref=f1e38]: No one will be alerted yet. Add a trusted contact.
        - link "Add trusted contact" [ref=f1e39] [cursor=pointer]:
          - /url: /circle
      - region "Live alert status" [ref=f1e40]:
        - alert [ref=f1e41]:
          - generic [ref=f1e45]:
            - heading "No acknowledgement yet — Call 112 now" [level=2] [ref=f1e46]
            - paragraph [ref=f1e47]: Your contacts have not acknowledged the alert yet. Tap below to call 112 immediately.
          - link "Call 112 now" [ref=f1e48] [cursor=pointer]:
            - /url: tel:112
        - generic [ref=f1e53]:
          - generic [ref=f1e58]:
            - paragraph [ref=f1e59]: Contacts notified
            - heading "Contacts notified" [level=1] [ref=f1e60]
            - paragraph [ref=f1e61]: Contacts notified. Your trusted contacts have been alerted.
          - generic [ref=f1e62]:
            - button "I'm safe" [ref=f1e63]
            - generic [ref=f1e67]:
              - link "Call 112" [ref=f1e68] [cursor=pointer]:
                - /url: tel:112
              - link "Call 181" [ref=f1e73] [cursor=pointer]:
                - /url: tel:181
        - generic [ref=f1e78]:
          - generic [ref=f1e79]:
            - heading "What is happening? (Optional)" [level=2] [ref=f1e80]
            - paragraph [ref=f1e81]: Tap one if safe to do so. Skipping never delays your alert.
          - generic [ref=f1e82]:
            - button "Unsafe" [ref=f1e83]
            - button "Followed" [ref=f1e84]
            - button "Harassment" [ref=f1e85]
            - button "Medical" [ref=f1e86]
            - button "Other" [ref=f1e87]
        - generic [ref=f1e88]:
          - generic [ref=f1e89]:
            - heading "Sharing Preview" [level=2] [ref=f1e90]
            - generic [ref=f1e91]: Stops automatically in 60 min or when you tap I'm safe
          - generic [ref=f1e92]:
            - paragraph [ref=f1e93]: "Who will be alerted:"
            - paragraph [ref=f1e94]: No trusted contacts will be alerted yet.
          - generic [ref=f1e95]:
            - generic [ref=f1e96]: Alert Location Status
            - paragraph [ref=f1e101]: Location is off; contacts get the alert without it
  - contentinfo [ref=f1e102]:
    - paragraph [ref=f1e103]: SHAKTI complements India's 112 (ERSS) and 181 Women Helpline. In immediate life-threatening danger, dial 112 directly.
    - link "Emergency Data Policy" [ref=f1e105] [cursor=pointer]:
      - /url: /policy
  - navigation "Mobile bottom navigation" [ref=f1e106]:
    - link "Home" [ref=f1e107] [cursor=pointer]:
      - /url: /home
    - link "Trusted Circle" [ref=f1e112] [cursor=pointer]:
      - /url: /circle
    - link "Consent Center" [ref=f1e119] [cursor=pointer]:
      - /url: /consents
    - link "Settings" [ref=f1e124] [cursor=pointer]:
      - /url: /settings
```

# Test source

```ts
  1   | import { test, expect, type Page, type APIRequestContext } from '@playwright/test';
  2   | import AxeBuilder from '@axe-core/playwright';
  3   | 
  4   | const DEMO_USER_PHONE = '+919000000001';
  5   | const DEMO_RESPONDER_PHONE = '+919000000002';
  6   | const DEMO_ADMIN_PHONE = '+919000000003';
  7   | 
  8   | async function resetServerState(request: APIRequestContext, baseURL: string) {
  9   |   await request.post(`${baseURL}/api/test/ratelimit/reset`, {
  10  |     headers: { Origin: baseURL },
  11  |   });
  12  |   await request.post(`${baseURL}/api/test/providers/failure`, {
  13  |     headers: { Origin: baseURL },
  14  |     data: { fail_push: false, fail_sms: false },
  15  |   });
  16  | 
  17  |   // Log in as admin to run /api/demo/reset
  18  |   const otpRes = await request.post(`${baseURL}/api/auth/otp/request`, {
  19  |     headers: { Origin: baseURL },
  20  |     data: { phone_e164: DEMO_ADMIN_PHONE },
  21  |   });
  22  |   const otpBody = await otpRes.json();
  23  |   await request.post(`${baseURL}/api/auth/otp/verify`, {
  24  |     headers: { Origin: baseURL },
  25  |     data: { phone_e164: DEMO_ADMIN_PHONE, code: otpBody.dev_mock_hint },
  26  |   });
  27  |   await request.post(`${baseURL}/api/demo/reset`, {
  28  |     headers: { Origin: baseURL },
  29  |   });
  30  |   await request.post(`${baseURL}/api/auth/logout`, {
  31  |     headers: { Origin: baseURL },
  32  |   });
  33  | }
  34  | 
  35  | async function loginViaApiOnPage(page: Page, baseURL: string, phone: string) {
  36  |   await page.goto(`${baseURL}/welcome`);
  37  |   await page.evaluate(
  38  |     async ({ phoneNum }) => {
  39  |       const r1 = await fetch('/api/auth/otp/request', {
  40  |         method: 'POST',
  41  |         headers: { 'Content-Type': 'application/json' },
  42  |         body: JSON.stringify({ phone_e164: phoneNum }),
  43  |       });
  44  |       const d1 = await r1.json();
  45  |       await fetch('/api/auth/otp/verify', {
  46  |         method: 'POST',
  47  |         headers: { 'Content-Type': 'application/json' },
  48  |         body: JSON.stringify({
  49  |           phone_e164: phoneNum,
  50  |           code: d1.dev_mock_hint,
  51  |         }),
  52  |       });
  53  |     },
  54  |     { phoneNum: phone }
  55  |   );
  56  | }
  57  | 
  58  | async function setCancelWindowSeconds(page: Page, seconds: number) {
  59  |   await page.evaluate(async (sec) => {
  60  |     await fetch('/api/settings/cancel-window', {
  61  |       method: 'PUT',
  62  |       headers: { 'Content-Type': 'application/json' },
  63  |       body: JSON.stringify({ cancel_window_seconds: sec }),
  64  |     });
  65  |   }, seconds);
  66  | }
  67  | 
  68  | async function holdSosButton(page: Page) {
  69  |   const btn = page.getByTestId('sos-hold-button');
  70  |   await expect(btn).toBeVisible();
> 71  |   await btn.dispatchEvent('mousedown');
      |             ^ Error: locator.dispatchEvent: Test timeout of 45000ms exceeded.
  72  |   await page.waitForTimeout(2150);
  73  |   if ((await btn.count()) > 0) {
  74  |     await btn.dispatchEvent('mouseup').catch(() => {});
  75  |   }
  76  | }
  77  | 
  78  | test.describe('SHAKTI Phase 9C: Real-Browser End-to-End Scenarios (390x844)', () => {
  79  |   test.beforeEach(async ({ request, baseURL }) => {
  80  |     await resetServerState(request, baseURL!);
  81  |   });
  82  | 
  83  |   test('1. Normal SOS: trigger by holding the button, cancel window passes, contact notified, contact acknowledges, user resolves', async ({
  84  |     page,
  85  |     context,
  86  |     baseURL,
  87  |   }) => {
  88  |     await loginViaApiOnPage(page, baseURL!, DEMO_USER_PHONE);
  89  |     await setCancelWindowSeconds(page, 2);
  90  |     await page.goto(`${baseURL}/home`);
  91  | 
  92  |     // Hold SOS button for 2s -> enters cancel window
  93  |     await holdSosButton(page);
  94  |     await expect(page.getByTestId('cancel-window-screen')).toBeVisible();
  95  | 
  96  |     // Wait for 2s cancel window to pass -> transitions to NOTIFIED
  97  |     await expect(page.getByTestId('live-status-screen')).toBeVisible({
  98  |       timeout: 8000,
  99  |     });
  100 |     await expect(page.getByTestId('contacts-notified-badge')).toBeVisible();
  101 | 
  102 |     // Retrieve latest contact magic link from dev outbox
  103 |     const outboxRes = await page.evaluate(async () => {
  104 |       const r = await fetch('/api/dev/outbox');
  105 |       return r.json();
  106 |     });
  107 |     const smsLinks = (outboxRes.messages || []).filter(
  108 |       (m: { purpose: string; body: string }) =>
  109 |         m.purpose === 'sos_alert' && m.body.includes('/c/')
  110 |     );
  111 |     expect(smsLinks.length).toBeGreaterThan(0);
  112 |     const smsWithLink = smsLinks[0];
  113 |     const match = smsWithLink.body.match(/\/c\/([A-Za-z0-9_.-]+)/);
  114 |     expect(match).toBeTruthy();
  115 |     const magicToken = match[1];
  116 | 
  117 |     // Contact opens magic link and acknowledges ("I've seen this")
  118 |     const contactPage = await context.newPage();
  119 |     await contactPage.goto(`${baseURL}/c/${magicToken}`);
  120 |     await expect(contactPage.getByTestId('contact-btn-seen')).toBeVisible();
  121 |     await contactPage.getByTestId('contact-btn-seen').click();
  122 | 
  123 |     // User sees ACKNOWLEDGED ("Help is on the way")
  124 |     await expect(page.getByTestId('live-status-heading')).toContainText(
  125 |       /Help is on the way/i
  126 |     );
  127 | 
  128 |     // User resolves ("I'm safe")
  129 |     await page.getByTestId('im-safe-btn').click();
  130 |     await expect(page.getByTestId('closed-status-screen')).toBeVisible();
  131 |     await contactPage.close();
  132 |   });
  133 | 
  134 |   test('2. Triple-tap trigger and disguise-mode unlock', async ({
  135 |     page,
  136 |     baseURL,
  137 |   }) => {
  138 |     await loginViaApiOnPage(page, baseURL!, DEMO_USER_PHONE);
  139 |     await page.goto(`${baseURL}/settings`);
  140 | 
  141 |     // Configure calculator disguise sequence '258012='
  142 |     await page.getByTestId('disguise-secret-input').fill('258012=');
  143 |     await page.getByTestId('disguise-secret-confirm-input').fill('258012=');
  144 |     await page.getByTestId('save-disguise-sequence-btn').click();
  145 |     await expect(page.getByTestId('toggle-disguise-mode')).toBeChecked();
  146 | 
  147 |     await page.goto(`${baseURL}/home`);
  148 |     await expect(page.getByTestId('disguise-calculator')).toBeVisible();
  149 |     await expect(page).toHaveTitle('Calculator');
  150 | 
  151 |     // Unlock disguise calculator by typing 258012=
  152 |     for (const key of ['2', '5', '8', '0', '1', '2', '=']) {
  153 |       await page.getByTestId(`calc-key-${key}`).click();
  154 |     }
  155 |     await expect(page.getByTestId('sos-hold-button')).toBeVisible();
  156 | 
  157 |     // Trigger SOS via triple-tap on the header logo zone
  158 |     const logoZone = page.getByTestId('triple-tap-zone-logo');
  159 |     await logoZone.click();
  160 |     await logoZone.click();
  161 |     await logoZone.click();
  162 | 
  163 |     await expect(page.getByTestId('cancel-window-screen')).toBeVisible();
  164 |     await page.getByTestId('cancel-alert-btn').click();
  165 |   });
  166 | 
  167 |   test('3. Cancel inside the window sends nothing', async ({
  168 |     page,
  169 |     baseURL,
  170 |   }) => {
  171 |     await loginViaApiOnPage(page, baseURL!, DEMO_USER_PHONE);
```