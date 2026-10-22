# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: shakti.spec.ts >> SHAKTI Phase 9C: Real-Browser End-to-End Scenarios (390x844) >> 2. Triple-tap trigger and disguise-mode unlock
- Location: e2e/shakti.spec.ts:134:3

# Error details

```
Test timeout of 45000ms exceeded.
```

```
Error: locator.click: Test timeout of 45000ms exceeded.
Call log:
  - waiting for getByTestId('calc-key-2')

```

# Page snapshot

```yaml
- generic [ref=f2e3]:
  - link "Skip to main content" [ref=f2e4] [cursor=pointer]:
    - /url: "#main-content"
  - region "Demo mode notice" [ref=f2e5]:
    - generic [ref=f2e6]: "DEMO MODE: no real alerts are sent"
    - generic [ref=f2e10]:
      - generic [ref=f2e11]: "SMS: MockSmsProvider [MOCK]"
      - generic [aria-hidden] [ref=f2e12]: ·
      - generic [ref=f2e13]: "Push: MockPushProvider [MOCK]"
      - generic [aria-hidden] [ref=f2e14]: ·
      - generic [ref=f2e15]: "112: MockEmergencyGateway [MOCK]"
  - banner [ref=f2e16]:
    - link "SHAKTI" [ref=f2e17] [cursor=pointer]:
      - /url: /home
    - generic [ref=f2e18]:
      - status [ref=f2e19]
      - group "Language" [ref=f2e24]:
        - button "English" [pressed] [ref=f2e25]
        - button "हिन्दी" [ref=f2e26]
      - button "Dark mode" [ref=f2e27]
      - button "Log Out" [ref=f2e30]
  - main [ref=f2e31]:
    - generic [ref=f2e32]:
      - status [ref=f2e33]
      - region "Trusted contact warning" [ref=f2e34]:
        - paragraph [ref=f2e38]: No one will be alerted yet. Add a trusted contact.
        - link "Add trusted contact" [ref=f2e39] [cursor=pointer]:
          - /url: /circle
      - region "Live alert status" [ref=f2e40]:
        - alert [ref=f2e41]:
          - generic [ref=f2e45]:
            - heading "No acknowledgement yet — Call 112 now" [level=2] [ref=f2e46]
            - paragraph [ref=f2e47]: Your contacts have not acknowledged the alert yet. Tap below to call 112 immediately.
          - link "Call 112 now" [ref=f2e48] [cursor=pointer]:
            - /url: tel:112
        - generic [ref=f2e53]:
          - generic [ref=f2e58]:
            - paragraph [ref=f2e59]: Contacts notified
            - heading "Contacts notified" [level=1] [ref=f2e60]
            - paragraph [ref=f2e61]: Contacts notified. Your trusted contacts have been alerted.
          - generic [ref=f2e62]:
            - button "I'm safe" [ref=f2e63]
            - generic [ref=f2e67]:
              - link "Call 112" [ref=f2e68] [cursor=pointer]:
                - /url: tel:112
              - link "Call 181" [ref=f2e73] [cursor=pointer]:
                - /url: tel:181
        - generic [ref=f2e78]:
          - generic [ref=f2e79]:
            - heading "What is happening? (Optional)" [level=2] [ref=f2e80]
            - paragraph [ref=f2e81]: Tap one if safe to do so. Skipping never delays your alert.
          - generic [ref=f2e82]:
            - button "Unsafe" [ref=f2e83]
            - button "Followed" [ref=f2e84]
            - button "Harassment" [ref=f2e85]
            - button "Medical" [ref=f2e86]
            - button "Other" [ref=f2e87]
        - generic [ref=f2e88]:
          - generic [ref=f2e89]:
            - heading "Sharing Preview" [level=2] [ref=f2e90]
            - generic [ref=f2e91]: Stops automatically in 60 min or when you tap I'm safe
          - generic [ref=f2e92]:
            - paragraph [ref=f2e93]: "Who will be alerted:"
            - paragraph [ref=f2e94]: No trusted contacts will be alerted yet.
          - generic [ref=f2e95]:
            - generic [ref=f2e96]: Alert Location Status
            - paragraph [ref=f2e101]: Location is off; contacts get the alert without it
  - contentinfo [ref=f2e102]:
    - paragraph [ref=f2e103]: SHAKTI complements India's 112 (ERSS) and 181 Women Helpline. In immediate life-threatening danger, dial 112 directly.
    - link "Emergency Data Policy" [ref=f2e105] [cursor=pointer]:
      - /url: /policy
  - navigation "Mobile bottom navigation" [ref=f2e106]:
    - link "Home" [ref=f2e107] [cursor=pointer]:
      - /url: /home
    - link "Trusted Circle" [ref=f2e112] [cursor=pointer]:
      - /url: /circle
    - link "Consent Center" [ref=f2e119] [cursor=pointer]:
      - /url: /consents
    - link "Settings" [ref=f2e124] [cursor=pointer]:
      - /url: /settings
```

# Test source

```ts
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
  71  |   await btn.dispatchEvent('mousedown');
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
> 153 |       await page.getByTestId(`calc-key-${key}`).click();
      |                                                 ^ Error: locator.click: Test timeout of 45000ms exceeded.
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
  172 |     await setCancelWindowSeconds(page, 5);
  173 |     await page.goto(`${baseURL}/home`);
  174 | 
  175 |     const beforeOutbox = await page.evaluate(async () => {
  176 |       const r = await fetch('/api/dev/outbox');
  177 |       return r.json();
  178 |     });
  179 |     const beforeCount = (beforeOutbox.messages || []).length;
  180 | 
  181 |     await holdSosButton(page);
  182 |     await expect(page.getByTestId('cancel-window-screen')).toBeVisible();
  183 |     await page.getByTestId('cancel-alert-btn').click();
  184 | 
  185 |     await expect(page.getByTestId('closed-status-screen')).toBeVisible();
  186 |     await expect(page.getByTestId('closed-status-screen')).toContainText(
  187 |       /Alert cancelled/i
  188 |     );
  189 | 
  190 |     const afterOutbox = await page.evaluate(async () => {
  191 |       const r = await fetch('/api/dev/outbox');
  192 |       return r.json();
  193 |     });
  194 |     expect((afterOutbox.messages || []).length).toBe(beforeCount);
  195 |   });
  196 | 
  197 |   test('4. Duress PIN: the user screen looks cancelled; a responder still sees the alert active; a responder closes it', async ({
  198 |     page,
  199 |     browser,
  200 |     baseURL,
  201 |   }) => {
  202 |     await loginViaApiOnPage(page, baseURL!, DEMO_USER_PHONE);
  203 |     await setCancelWindowSeconds(page, 2);
  204 |     await page.evaluate(async () => {
  205 |       await fetch('/api/settings/cancel-pin', {
  206 |         method: 'PUT',
  207 |         headers: { 'Content-Type': 'application/json' },
  208 |         body: JSON.stringify({ pin: '1234' }),
  209 |       });
  210 |       await fetch('/api/settings/duress-pin', {
  211 |         method: 'PUT',
  212 |         headers: { 'Content-Type': 'application/json' },
  213 |         body: JSON.stringify({ pin: '9999', cancel_pin: '1234' }),
  214 |       });
  215 |     });
  216 | 
  217 |     await page.goto(`${baseURL}/home`);
  218 |     await holdSosButton(page);
  219 |     await expect(page.getByTestId('cancel-window-screen')).toBeVisible();
  220 | 
  221 |     // Tap Cancel Alert and enter Duress PIN 9999
  222 |     await page.getByTestId('cancel-alert-btn').click();
  223 |     await expect(page.getByTestId('pin-keypad')).toBeVisible();
  224 |     for (let i = 0; i < 4; i++) {
  225 |       await page.getByRole('button', { name: 'Digit 9' }).click();
  226 |     }
  227 |     await page.getByTestId('pin-submit-btn').click();
  228 | 
  229 |     // User's screen looks completely cancelled
  230 |     await expect(page.getByTestId('closed-status-screen')).toBeVisible();
  231 |     await expect(page.getByTestId('closed-status-screen')).toContainText(
  232 |       /Alert cancelled/i
  233 |     );
  234 | 
  235 |     // Wait for 2s cancel window to pass so incident activates on server
  236 |     await page.waitForTimeout(2400);
  237 | 
  238 |     // Responder logs in inside a separate context and sees the active duress incident
  239 |     const responderContext = await browser.newContext({
  240 |       viewport: { width: 390, height: 844 },
  241 |     });
  242 |     const responderPage = await responderContext.newPage();
  243 |     await loginViaApiOnPage(responderPage, baseURL!, DEMO_RESPONDER_PHONE);
  244 |     await responderPage.goto(`${baseURL}/responder`);
  245 | 
  246 |     await expect(responderPage.getByText(/DURESS ALERT/i).first()).toBeVisible();
  247 |     await responderPage
  248 |       .getByRole('button', { name: /Resolve Incident/i })
  249 |       .click();
  250 |     await expect(responderPage.getByText(/RESOLVED/i).first()).toBeVisible();
  251 |     await responderContext.close();
  252 |   });
  253 | 
```