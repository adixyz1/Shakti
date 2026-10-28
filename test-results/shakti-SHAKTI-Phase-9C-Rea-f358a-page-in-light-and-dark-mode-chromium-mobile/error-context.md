# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: shakti.spec.ts >> SHAKTI Phase 9C: Real-Browser End-to-End Scenarios (390x844) >> 13. Real-browser @axe-core/playwright WCAG 2 AA (including color-contrast) on Home, cancel keypad, Consent Center, contact page, responder dashboard, and policy page in light and dark mode
- Location: e2e/shakti.spec.ts:683:3

# Error details

```
Error: Axe serious/critical violations on Consent Center (Dark): [{"id":"color-contrast","impact":"serious","help":"Elements must meet minimum color contrast ratio thresholds"}]

expect(received).toEqual(expected) // deep equality

- Expected  -   1
+ Received  + 391

- Array []
+ Array [
+   Object {
+     "description": "Ensure the contrast between foreground and background colors meets WCAG 2 AA minimum contrast ratio thresholds",
+     "help": "Elements must meet minimum color contrast ratio thresholds",
+     "helpUrl": "https://dequeuniversity.com/rules/axe/4.13/color-contrast?application=playwright",
+     "id": "color-contrast",
+     "impact": "serious",
+     "nodes": Array [
+       Object {
+         "all": Array [],
+         "any": Array [
+           Object {
+             "data": Object {
+               "bgColor": "#020719",
+               "contrastRatio": 3.74,
+               "expectedContrastRatio": "4.5:1",
+               "fgColor": "#00786f",
+               "fontSize": "9.0pt (12px)",
+               "fontWeight": "normal",
+               "messageKey": null,
+             },
+             "id": "color-contrast",
+             "impact": "serious",
+             "message": "Element has insufficient color contrast of 3.74 (foreground color: #00786f, background color: #020719, font size: 9.0pt (12px), font weight: normal). Expected contrast ratio of 4.5:1",
+             "relatedNodes": Array [
+               Object {
+                 "html": "<div class=\"min-h-screen flex flex-col bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 transition-colors\">",
+                 "target": Array [
+                   ".min-h-screen",
+                 ],
+               },
+             ],
+           },
+         ],
+         "failureSummary": "Fix any of the following:
+   Element has insufficient color contrast of 3.74 (foreground color: #00786f, background color: #020719, font size: 9.0pt (12px), font weight: normal). Expected contrast ratio of 4.5:1",
+         "html": "<a data-testid=\"consents-policy-link\" class=\"text-xs font-mono font-semibold text-teal-700 underline underline-offset-4 hover:text-teal-800\" href=\"/policy\" data-discover=\"true\">Read Emergency Data Policy</a>",
+         "impact": "serious",
+         "none": Array [],
+         "target": Array [
+           ".underline-offset-4",
+         ],
+       },
+       Object {
+         "all": Array [],
+         "any": Array [
+           Object {
+             "data": Object {
+               "bgColor": "#0f172a",
+               "contrastRatio": 3.32,
+               "expectedContrastRatio": "4.5:1",
+               "fgColor": "#00786f",
+               "fontSize": "9.0pt (12px)",
+               "fontWeight": "normal",
+               "messageKey": null,
+             },
+             "id": "color-contrast",
+             "impact": "serious",
+             "message": "Element has insufficient color contrast of 3.32 (foreground color: #00786f, background color: #0f172a, font size: 9.0pt (12px), font weight: normal). Expected contrast ratio of 4.5:1",
+             "relatedNodes": Array [
+               Object {
+                 "html": "<article class=\"bg-surface p-4 border border-line rounded-xl flex flex-col gap-3\">",
+                 "target": Array [
+                   "article:nth-child(1)",
+                 ],
+               },
+             ],
+           },
+         ],
+         "failureSummary": "Fix any of the following:
+   Element has insufficient color contrast of 3.32 (foreground color: #00786f, background color: #0f172a, font size: 9.0pt (12px), font weight: normal). Expected contrast ratio of 4.5:1",
+         "html": "<span class=\"font-semibold text-teal-700\">Granted</span>",
+         "impact": "serious",
+         "none": Array [],
+         "target": Array [
+           "article:nth-child(1) > .justify-between.gap-3.flex > .min-w-0.flex-col.flex > .tabular-nums.gap-2.flex > .text-teal-700.font-semibold",
+         ],
+       },
+       Object {
+         "all": Array [],
+         "any": Array [
+           Object {
+             "data": Object {
+               "bgColor": "#0f172a",
+               "contrastRatio": 3.32,
+               "expectedContrastRatio": "4.5:1",
+               "fgColor": "#00786f",
+               "fontSize": "9.0pt (12px)",
+               "fontWeight": "bold",
+               "messageKey": null,
+             },
+             "id": "color-contrast",
+             "impact": "serious",
+             "message": "Element has insufficient color contrast of 3.32 (foreground color: #00786f, background color: #0f172a, font size: 9.0pt (12px), font weight: bold). Expected contrast ratio of 4.5:1",
+             "relatedNodes": Array [
+               Object {
+                 "html": "<button type=\"button\" aria-pressed=\"true\" aria-label=\"Revoke Permission Core Safety Data Processing\" class=\"h-11 px-3 border border-line rounded-xl flex items-center gap-2 cursor-pointer select-none transition-none shrink-0 bg-surface disabled:opacity-50\">",
+                 "target": Array [
+                   "article:nth-child(1) > .justify-between.gap-3.flex > .h-11.px-3.cursor-pointer",
+                 ],
+               },
+             ],
+           },
+         ],
+         "failureSummary": "Fix any of the following:
+   Element has insufficient color contrast of 3.32 (foreground color: #00786f, background color: #0f172a, font size: 9.0pt (12px), font weight: bold). Expected contrast ratio of 4.5:1",
+         "html": "<span class=\"text-xs font-mono font-bold text-teal-700\">On</span>",
+         "impact": "serious",
+         "none": Array [],
+         "target": Array [
+           "article:nth-child(1) > .justify-between.gap-3.flex > .h-11.px-3.cursor-pointer > .text-teal-700.font-bold.font-mono",
+         ],
+       },
+       Object {
+         "all": Array [],
+         "any": Array [
+           Object {
+             "data": Object {
+               "bgColor": "#0f172a",
+               "contrastRatio": 3.32,
+               "expectedContrastRatio": "4.5:1",
+               "fgColor": "#00786f",
+               "fontSize": "9.0pt (12px)",
+               "fontWeight": "normal",
+               "messageKey": null,
+             },
+             "id": "color-contrast",
+             "impact": "serious",
+             "message": "Element has insufficient color contrast of 3.32 (foreground color: #00786f, background color: #0f172a, font size: 9.0pt (12px), font weight: normal). Expected contrast ratio of 4.5:1",
+             "relatedNodes": Array [
+               Object {
+                 "html": "<article class=\"bg-surface p-4 border border-line rounded-xl flex flex-col gap-3\">",
+                 "target": Array [
+                   "article:nth-child(2)",
+                 ],
+               },
+             ],
+           },
+         ],
+         "failureSummary": "Fix any of the following:
+   Element has insufficient color contrast of 3.32 (foreground color: #00786f, background color: #0f172a, font size: 9.0pt (12px), font weight: normal). Expected contrast ratio of 4.5:1",
+         "html": "<span class=\"font-semibold text-teal-700\">Granted</span>",
+         "impact": "serious",
+         "none": Array [],
+         "target": Array [
+           "article:nth-child(2) > .justify-between.gap-3.flex > .min-w-0.flex-col.flex > .tabular-nums.gap-2.flex > .text-teal-700.font-semibold",
+         ],
+       },
+       Object {
+         "all": Array [],
+         "any": Array [
+           Object {
+             "data": Object {
+               "bgColor": "#0f172a",
+               "contrastRatio": 3.32,
+               "expectedContrastRatio": "4.5:1",
+               "fgColor": "#00786f",
+               "fontSize": "9.0pt (12px)",
+               "fontWeight": "bold",
+               "messageKey": null,
+             },
+             "id": "color-contrast",
+             "impact": "serious",
+             "message": "Element has insufficient color contrast of 3.32 (foreground color: #00786f, background color: #0f172a, font size: 9.0pt (12px), font weight: bold). Expected contrast ratio of 4.5:1",
+             "relatedNodes": Array [
+               Object {
+                 "html": "<button type=\"button\" aria-pressed=\"true\" aria-label=\"Revoke Permission Emergency & Check-In Location\" class=\"h-11 px-3 border border-line rounded-xl flex items-center gap-2 cursor-pointer select-none transition-none shrink-0 bg-surface disabled:opacity-50\">",
+                 "target": Array [
+                   "article:nth-child(2) > .justify-between.gap-3.flex > .h-11.px-3.cursor-pointer",
+                 ],
+               },
+             ],
+           },
+         ],
+         "failureSummary": "Fix any of the following:
+   Element has insufficient color contrast of 3.32 (foreground color: #00786f, background color: #0f172a, font size: 9.0pt (12px), font weight: bold). Expected contrast ratio of 4.5:1",
+         "html": "<span class=\"text-xs font-mono font-bold text-teal-700\">On</span>",
+         "impact": "serious",
+         "none": Array [],
+         "target": Array [
+           "article:nth-child(2) > .justify-between.gap-3.flex > .h-11.px-3.cursor-pointer > .text-teal-700.font-bold.font-mono",
+         ],
+       },
+       Object {
+         "all": Array [],
+         "any": Array [
+           Object {
+             "data": Object {
+               "bgColor": "#0f172a",
+               "contrastRatio": 3.32,
+               "expectedContrastRatio": "4.5:1",
+               "fgColor": "#00786f",
+               "fontSize": "9.0pt (12px)",
+               "fontWeight": "normal",
+               "messageKey": null,
+             },
+             "id": "color-contrast",
+             "impact": "serious",
+             "message": "Element has insufficient color contrast of 3.32 (foreground color: #00786f, background color: #0f172a, font size: 9.0pt (12px), font weight: normal). Expected contrast ratio of 4.5:1",
+             "relatedNodes": Array [
+               Object {
+                 "html": "<article class=\"bg-surface p-4 border border-line rounded-xl flex flex-col gap-3\">",
+                 "target": Array [
+                   "article:nth-child(3)",
+                 ],
+               },
+             ],
+           },
+         ],
+         "failureSummary": "Fix any of the following:
+   Element has insufficient color contrast of 3.32 (foreground color: #00786f, background color: #0f172a, font size: 9.0pt (12px), font weight: normal). Expected contrast ratio of 4.5:1",
+         "html": "<span class=\"font-semibold text-teal-700\">Granted</span>",
+         "impact": "serious",
+         "none": Array [],
+         "target": Array [
+           "article:nth-child(3) > .justify-between.gap-3.flex > .min-w-0.flex-col.flex > .tabular-nums.gap-2.flex > .text-teal-700.font-semibold",
+         ],
+       },
+       Object {
+         "all": Array [],
+         "any": Array [
+           Object {
+             "data": Object {
+               "bgColor": "#0f172a",
+               "contrastRatio": 3.32,
+               "expectedContrastRatio": "4.5:1",
+               "fgColor": "#00786f",
+               "fontSize": "9.0pt (12px)",
+               "fontWeight": "bold",
+               "messageKey": null,
+             },
+             "id": "color-contrast",
+             "impact": "serious",
+             "message": "Element has insufficient color contrast of 3.32 (foreground color: #00786f, background color: #0f172a, font size: 9.0pt (12px), font weight: bold). Expected contrast ratio of 4.5:1",
+             "relatedNodes": Array [
+               Object {
+                 "html": "<button type=\"button\" aria-pressed=\"true\" aria-label=\"Revoke Permission Safety Check-In Notifications\" class=\"h-11 px-3 border border-line rounded-xl flex items-center gap-2 cursor-pointer select-none transition-none shrink-0 bg-surface disabled:opacity-50\">",
+                 "target": Array [
+                   "article:nth-child(3) > .justify-between.gap-3.flex > .h-11.px-3.cursor-pointer",
+                 ],
+               },
+             ],
+           },
+         ],
+         "failureSummary": "Fix any of the following:
+   Element has insufficient color contrast of 3.32 (foreground color: #00786f, background color: #0f172a, font size: 9.0pt (12px), font weight: bold). Expected contrast ratio of 4.5:1",
+         "html": "<span class=\"text-xs font-mono font-bold text-teal-700\">On</span>",
+         "impact": "serious",
+         "none": Array [],
+         "target": Array [
+           "article:nth-child(3) > .justify-between.gap-3.flex > .h-11.px-3.cursor-pointer > .text-teal-700.font-bold.font-mono",
+         ],
+       },
+       Object {
+         "all": Array [],
+         "any": Array [
+           Object {
+             "data": Object {
+               "bgColor": "#0e162a",
+               "contrastRatio": 3.35,
+               "expectedContrastRatio": "4.5:1",
+               "fgColor": "#00786f",
+               "fontSize": "9.0pt (12px)",
+               "fontWeight": "bold",
+               "messageKey": null,
+             },
+             "id": "color-contrast",
+             "impact": "serious",
+             "message": "Element has insufficient color contrast of 3.35 (foreground color: #00786f, background color: #0e162a, font size: 9.0pt (12px), font weight: bold). Expected contrast ratio of 4.5:1",
+             "relatedNodes": Array [
+               Object {
+                 "html": "<div class=\"rounded-2xl bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border border-slate-200/90 dark:border-slate-800 p-5 shadow-sm divide-y divide-line p-0 bg-surface border border-line\">",
+                 "target": Array [
+                   ".rounded-2xl",
+                 ],
+               },
+               Object {
+                 "html": "<div class=\"min-h-screen flex flex-col bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 transition-colors\">",
+                 "target": Array [
+                   ".min-h-screen",
+                 ],
+               },
+             ],
+           },
+         ],
+         "failureSummary": "Fix any of the following:
+   Element has insufficient color contrast of 3.35 (foreground color: #00786f, background color: #0e162a, font size: 9.0pt (12px), font weight: bold). Expected contrast ratio of 4.5:1",
+         "html": "<span class=\"font-bold text-teal-700\">GRANTED</span>",
+         "impact": "serious",
+         "none": Array [],
+         "target": Array [
+           ".p-3\\.5.flex-wrap.tabular-nums:nth-child(1) > .gap-2.flex.items-center > .text-teal-700.font-bold",
+         ],
+       },
+       Object {
+         "all": Array [],
+         "any": Array [
+           Object {
+             "data": Object {
+               "bgColor": "#0e162a",
+               "contrastRatio": 3.35,
+               "expectedContrastRatio": "4.5:1",
+               "fgColor": "#00786f",
+               "fontSize": "9.0pt (12px)",
+               "fontWeight": "bold",
+               "messageKey": null,
+             },
+             "id": "color-contrast",
+             "impact": "serious",
+             "message": "Element has insufficient color contrast of 3.35 (foreground color: #00786f, background color: #0e162a, font size: 9.0pt (12px), font weight: bold). Expected contrast ratio of 4.5:1",
+             "relatedNodes": Array [
+               Object {
+                 "html": "<div class=\"rounded-2xl bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border border-slate-200/90 dark:border-slate-800 p-5 shadow-sm divide-y divide-line p-0 bg-surface border border-line\">",
+                 "target": Array [
+                   ".rounded-2xl",
+                 ],
+               },
+               Object {
+                 "html": "<div class=\"min-h-screen flex flex-col bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 transition-colors\">",
+                 "target": Array [
+                   ".min-h-screen",
+                 ],
+               },
+             ],
+           },
+         ],
+         "failureSummary": "Fix any of the following:
+   Element has insufficient color contrast of 3.35 (foreground color: #00786f, background color: #0e162a, font size: 9.0pt (12px), font weight: bold). Expected contrast ratio of 4.5:1",
+         "html": "<span class=\"font-bold text-teal-700\">GRANTED</span>",
+         "impact": "serious",
+         "none": Array [],
+         "target": Array [
+           ".p-3\\.5.flex-wrap.tabular-nums:nth-child(2) > .gap-2.flex.items-center > .text-teal-700.font-bold",
+         ],
+       },
+       Object {
+         "all": Array [],
+         "any": Array [
+           Object {
+             "data": Object {
+               "bgColor": "#0e162a",
+               "contrastRatio": 3.35,
+               "expectedContrastRatio": "4.5:1",
+               "fgColor": "#00786f",
+               "fontSize": "9.0pt (12px)",
+               "fontWeight": "bold",
+               "messageKey": null,
+             },
+             "id": "color-contrast",
+             "impact": "serious",
+             "message": "Element has insufficient color contrast of 3.35 (foreground color: #00786f, background color: #0e162a, font size: 9.0pt (12px), font weight: bold). Expected contrast ratio of 4.5:1",
+             "relatedNodes": Array [
+               Object {
+                 "html": "<div class=\"rounded-2xl bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border border-slate-200/90 dark:border-slate-800 p-5 shadow-sm divide-y divide-line p-0 bg-surface border border-line\">",
+                 "target": Array [
+                   ".rounded-2xl",
+                 ],
+               },
+               Object {
+                 "html": "<div class=\"min-h-screen flex flex-col bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 transition-colors\">",
+                 "target": Array [
+                   ".min-h-screen",
+                 ],
+               },
+             ],
+           },
+         ],
+         "failureSummary": "Fix any of the following:
+   Element has insufficient color contrast of 3.35 (foreground color: #00786f, background color: #0e162a, font size: 9.0pt (12px), font weight: bold). Expected contrast ratio of 4.5:1",
+         "html": "<span class=\"font-bold text-teal-700\">GRANTED</span>",
+         "impact": "serious",
+         "none": Array [],
+         "target": Array [
+           ".p-3\\.5.flex-wrap.tabular-nums:nth-child(3) > .gap-2.flex.items-center > .text-teal-700.font-bold",
+         ],
+       },
+     ],
+     "tags": Array [
+       "cat.color",
+       "wcag2aa",
+       "wcag143",
+       "TTv5",
+       "TT13.c",
+       "EN-301-549",
+       "EN-9.1.4.3",
+       "ACT",
+       "RGAAv4",
+       "RGAA-3.2.1",
+     ],
+   },
+ ]
```

# Page snapshot

```yaml
- generic [ref=f3e3]:
  - link "Skip to main content" [ref=f3e4] [cursor=pointer]:
    - /url: "#main-content"
  - region "Demo mode notice" [ref=f3e5]:
    - generic [ref=f3e6]: "DEMO MODE: no real alerts are sent"
    - generic [ref=f3e10]:
      - generic [ref=f3e11]: "SMS: MockSmsProvider [MOCK]"
      - generic [aria-hidden] [ref=f3e12]: ·
      - generic [ref=f3e13]: "Push: MockPushProvider [MOCK]"
      - generic [aria-hidden] [ref=f3e14]: ·
      - generic [ref=f3e15]: "112: MockEmergencyGateway [MOCK]"
  - banner [ref=f3e16]:
    - link "SHAKTI" [ref=f3e18] [cursor=pointer]:
      - /url: /home
    - generic [ref=f3e19]:
      - status [ref=f3e20]: Online
      - group "Language" [ref=f3e21]:
        - button "English" [pressed] [ref=f3e22]
        - button "हिन्दी" [ref=f3e23]
      - button "Light mode" [ref=f3e24]
      - button "Log Out" [ref=f3e31]
  - main [ref=f3e32]:
    - generic [ref=f3e33]:
      - generic [ref=f3e34]:
        - heading "Consent Center" [level=1] [ref=f3e38]
        - paragraph [ref=f3e39]: Nothing is collected or shared without your explicit permission. You can grant or revoke any permission at any time, and every change is recorded in your append-only ledger.
        - link "Read Emergency Data Policy" [ref=f3e41] [cursor=pointer]:
          - /url: /policy
      - region [ref=f3e42]:
        - generic [ref=f3e46]:
          - heading "Background Operation Limitation" [level=2] [ref=f3e47]
          - paragraph [ref=f3e48]: "Notice: Shake and voice triggers work only while the app is open."
          - paragraph [ref=f3e49]: Operating system privacy constraints suspend motion sensors and live microphone loops once the display locks or the app is minimized.
      - group "Consent Center" [ref=f3e50]:
        - article [ref=f3e51]:
          - generic [ref=f3e52]:
            - generic [ref=f3e53]:
              - generic [ref=f3e54]:
                - generic [ref=f3e55]: Granted
                - generic [aria-hidden] [ref=f3e56]: ·
                - generic [ref=f3e57]: data_processing
              - heading "Core Safety Data Processing" [level=2] [ref=f3e58]
            - button "Revoke Permission Core Safety Data Processing" [pressed] [ref=f3e59] [cursor=pointer]:
              - generic [ref=f3e60]: "On"
              - generic [ref=f3e61]: "|"
              - generic [ref=f3e62]: "Off"
          - generic [ref=f3e63]:
            - generic [ref=f3e64]:
              - term [ref=f3e65]: "What is used:"
              - definition [ref=f3e66]: Your account profile, trusted contact preferences, and active alert state.
            - generic [ref=f3e67]:
              - term [ref=f3e68]: "Why it is needed:"
              - definition [ref=f3e69]: Required to route SOS and check-in notifications to your accepted trusted circle.
            - generic [ref=f3e70]:
              - term [ref=f3e71]: "Who sees it:"
              - definition [ref=f3e72]: Only your accepted trusted contacts and assigned responders during an active alert.
            - generic [ref=f3e73]:
              - term [ref=f3e74]: "How long it is kept:"
              - definition [ref=f3e75]: Retained only while your account is active; revoking stops all contact notifications immediately.
        - article [ref=f3e76]:
          - generic [ref=f3e77]:
            - generic [ref=f3e78]:
              - generic [ref=f3e79]:
                - generic [ref=f3e80]: Granted
                - generic [aria-hidden] [ref=f3e81]: ·
                - generic [ref=f3e82]: location
              - heading "Emergency & Check-In Location" [level=2] [ref=f3e83]
            - button "Revoke Permission Emergency & Check-In Location" [pressed] [ref=f3e84] [cursor=pointer]:
              - generic [ref=f3e85]: "On"
              - generic [ref=f3e86]: "|"
              - generic [ref=f3e87]: "Off"
          - generic [ref=f3e88]:
            - generic [ref=f3e89]:
              - term [ref=f3e90]: "What is used:"
              - definition [ref=f3e91]: Device GPS or network coordinates during an active SOS or self-started check-in.
            - generic [ref=f3e92]:
              - term [ref=f3e93]: "Why it is needed:"
              - definition [ref=f3e94]: Helps your trusted contacts and responders find you quickly when you ask for help.
            - generic [ref=f3e95]:
              - term [ref=f3e96]: "Who sees it:"
              - definition [ref=f3e97]: Only accepted contacts who also have 'Can see live location' enabled.
            - generic [ref=f3e98]:
              - term [ref=f3e99]: "How long it is kept:"
              - definition [ref=f3e100]: Captured only during an active session and expires automatically after resolution.
        - article [ref=f3e101]:
          - generic [ref=f3e102]:
            - generic [ref=f3e103]:
              - generic [ref=f3e104]:
                - generic [ref=f3e105]: Granted
                - generic [aria-hidden] [ref=f3e106]: ·
                - generic [ref=f3e107]: notifications
              - heading "Safety Check-In Notifications" [level=2] [ref=f3e108]
            - button "Revoke Permission Safety Check-In Notifications" [pressed] [ref=f3e109] [cursor=pointer]:
              - generic [ref=f3e110]: "On"
              - generic [ref=f3e111]: "|"
              - generic [ref=f3e112]: "Off"
          - generic [ref=f3e113]:
            - generic [ref=f3e114]:
              - term [ref=f3e115]: "What is used:"
              - definition [ref=f3e116]: Browser push and local alert notifications.
            - generic [ref=f3e117]:
              - term [ref=f3e118]: "Why it is needed:"
              - definition [ref=f3e119]: Reminds you before a journey timer expires and confirms alert delivery status.
            - generic [ref=f3e120]:
              - term [ref=f3e121]: "Who sees it:"
              - definition [ref=f3e122]: Displayed only on your own device.
            - generic [ref=f3e123]:
              - term [ref=f3e124]: "How long it is kept:"
              - definition [ref=f3e125]: Ephemeral device notifications; never stored permanently.
        - article [ref=f3e126]:
          - generic [ref=f3e127]:
            - generic [ref=f3e128]:
              - generic [ref=f3e129]:
                - generic [ref=f3e130]: Not Granted / Revoked
                - generic [aria-hidden] [ref=f3e131]: ·
                - generic [ref=f3e132]: microphone
              - heading "Optional Emergency Audio Clip" [level=2] [ref=f3e133]
            - button "Grant Permission Optional Emergency Audio Clip" [ref=f3e134] [cursor=pointer]:
              - generic [ref=f3e135]: "On"
              - generic [ref=f3e136]: "|"
              - generic [ref=f3e137]: "Off"
          - generic [ref=f3e138]:
            - generic [ref=f3e139]:
              - term [ref=f3e140]: "What is used:"
              - definition [ref=f3e141]: Short ambient audio recording when explicitly triggered during an SOS.
            - generic [ref=f3e142]:
              - term [ref=f3e143]: "Why it is needed:"
              - definition [ref=f3e144]: Provides context to responders if you cannot speak or type.
            - generic [ref=f3e145]:
              - term [ref=f3e146]: "Who sees it:"
              - definition [ref=f3e147]: Only authorized emergency recipients during an active SOS.
            - generic [ref=f3e148]:
              - term [ref=f3e149]: "How long it is kept:"
              - definition [ref=f3e150]: Automatically purged after the incident expires.
        - article [ref=f3e151]:
          - generic [ref=f3e152]:
            - generic [ref=f3e153]:
              - generic [ref=f3e154]:
                - generic [ref=f3e155]: Not Granted / Revoked
                - generic [aria-hidden] [ref=f3e156]: ·
                - generic [ref=f3e157]: camera
              - heading "Optional Emergency Photo Capture" [level=2] [ref=f3e158]
            - button "Grant Permission Optional Emergency Photo Capture" [ref=f3e159] [cursor=pointer]:
              - generic [ref=f3e160]: "On"
              - generic [ref=f3e161]: "|"
              - generic [ref=f3e162]: "Off"
          - generic [ref=f3e163]:
            - generic [ref=f3e164]:
              - term [ref=f3e165]: "What is used:"
              - definition [ref=f3e166]: Camera snapshot only when you explicitly attach one to a safety report or SOS.
            - generic [ref=f3e167]:
              - term [ref=f3e168]: "Why it is needed:"
              - definition [ref=f3e169]: Allows documenting a vehicle number or surroundings when safe to do so.
            - generic [ref=f3e170]:
              - term [ref=f3e171]: "Who sees it:"
              - definition [ref=f3e172]: Only recipients you explicitly select.
            - generic [ref=f3e173]:
              - term [ref=f3e174]: "How long it is kept:"
              - definition [ref=f3e175]: Deleted automatically upon incident expiry or at your request.
      - generic [ref=f3e176]:
        - generic [ref=f3e177]:
          - heading "Append-Only Consent Ledger History" [level=2] [ref=f3e178]
          - paragraph [ref=f3e179]: Immutable audit trail of every permission grant and revocation on your account.
        - generic [ref=f3e180]:
          - generic [ref=f3e181]:
            - generic [ref=f3e182]:
              - generic [ref=f3e183]: GRANTED
              - generic [aria-hidden] [ref=f3e184]: ·
              - generic [ref=f3e185]: data_processing
              - generic [aria-hidden] [ref=f3e186]: ·
              - generic [ref=f3e187]: "Source: seed"
            - time [ref=f3e188]: 10/28/2026, 10:10:46 AM
          - generic [ref=f3e189]:
            - generic [ref=f3e190]:
              - generic [ref=f3e191]: GRANTED
              - generic [aria-hidden] [ref=f3e192]: ·
              - generic [ref=f3e193]: location
              - generic [aria-hidden] [ref=f3e194]: ·
              - generic [ref=f3e195]: "Source: demo_seed"
            - time [ref=f3e196]: 10/14/2026, 10:10:48 AM
          - generic [ref=f3e197]:
            - generic [ref=f3e198]:
              - generic [ref=f3e199]: GRANTED
              - generic [aria-hidden] [ref=f3e200]: ·
              - generic [ref=f3e201]: notifications
              - generic [aria-hidden] [ref=f3e202]: ·
              - generic [ref=f3e203]: "Source: demo_seed"
            - time [ref=f3e204]: 10/14/2026, 10:10:48 AM
  - contentinfo [ref=f3e205]:
    - paragraph [ref=f3e206]: SHAKTI complements India's 112 (ERSS) and 181 Women Helpline. In immediate life-threatening danger, dial 112 directly.
    - link "Emergency Data Policy" [ref=f3e208] [cursor=pointer]:
      - /url: /policy
  - navigation "Mobile bottom navigation" [ref=f3e209]:
    - link "Home" [ref=f3e210] [cursor=pointer]:
      - /url: /home
    - link "Trusted Circle" [ref=f3e215] [cursor=pointer]:
      - /url: /circle
    - link "Consent Center" [ref=f3e222] [cursor=pointer]:
      - /url: /consents
    - link "Settings" [ref=f3e227] [cursor=pointer]:
      - /url: /settings
```

# Test source

```ts
  601 |     await loginViaApiOnPage(page, baseURL!, DEMO_USER_PHONE);
  602 | 
  603 |     const purgeResult = await page.evaluate(async () => {
  604 |       await fetch('/api/consents', {
  605 |         method: 'POST',
  606 |         headers: { 'Content-Type': 'application/json' },
  607 |         body: JSON.stringify({
  608 |           type: 'location',
  609 |           granted: true,
  610 |           source: 'e2e_test',
  611 |         }),
  612 |       });
  613 |       const createRes = await fetch('/api/incidents', {
  614 |         method: 'POST',
  615 |         headers: { 'Content-Type': 'application/json' },
  616 |         body: JSON.stringify({
  617 |           client_request_id: `ret_req_${Date.now()}`,
  618 |           client_created_at: new Date().toISOString(),
  619 |           source_trigger: 'button',
  620 |         }),
  621 |       });
  622 |       const created = await createRes.json();
  623 |       const incId = created.incident.id;
  624 | 
  625 |       await fetch(`/api/incidents/${incId}/location`, {
  626 |         method: 'POST',
  627 |         headers: { 'Content-Type': 'application/json' },
  628 |         body: JSON.stringify({
  629 |           lat: 28.6139,
  630 |           lng: 77.209,
  631 |           accuracy_m: 10,
  632 |           captured_at: new Date().toISOString(),
  633 |         }),
  634 |       });
  635 | 
  636 |       // Trigger test-only retention purge hook that marks the incident's location sample expired and runs purge
  637 |       const purgeRes = await fetch('/api/test/retention/purge', {
  638 |         method: 'POST',
  639 |         headers: { 'Content-Type': 'application/json' },
  640 |         body: JSON.stringify({ expire_incident_id: incId }),
  641 |       });
  642 |       const purgeData = await purgeRes.json();
  643 | 
  644 |       await fetch(`/api/incidents/${incId}/cancel`, {
  645 |         method: 'POST',
  646 |         headers: { 'Content-Type': 'application/json' },
  647 |         body: JSON.stringify({}),
  648 |       });
  649 |       return purgeData;
  650 |     });
  651 | 
  652 |     expect(purgeResult.summary.deletedLocationSamples).toBeGreaterThanOrEqual(1);
  653 |     expect(purgeResult.remaining_for_incident).toBe(0);
  654 |   });
  655 | 
  656 |   test('12. SOS works with push, SMS and AI providers all failing', async ({
  657 |     page,
  658 |     request,
  659 |     baseURL,
  660 |   }) => {
  661 |     await request.post(`${baseURL}/api/test/providers/failure`, {
  662 |       headers: { Origin: baseURL! },
  663 |       data: { fail_push: true, fail_sms: true },
  664 |     });
  665 | 
  666 |     await loginViaApiOnPage(page, baseURL!, DEMO_USER_PHONE);
  667 |     await setCancelWindowSeconds(page, 1);
  668 |     await page.goto(`${baseURL}/home`);
  669 | 
  670 |     // Trigger SOS while Push, SMS, and AI are all failing/disabled
  671 |     await holdSosButton(page);
  672 |     await expect(page.getByTestId('cancel-window-screen')).toBeVisible();
  673 | 
  674 |     // Wait for cancel window to pass -> incident still transitions to ACTIVE /live-status-screen deterministically
  675 |     await expect(page.getByTestId('live-status-screen')).toBeVisible({
  676 |       timeout: 8000,
  677 |     });
  678 | 
  679 |     await page.getByTestId('im-safe-btn').click();
  680 |     await expect(page.getByTestId('closed-status-screen')).toBeVisible();
  681 |   });
  682 | 
  683 |   test('13. Real-browser @axe-core/playwright WCAG 2 AA (including color-contrast) on Home, cancel keypad, Consent Center, contact page, responder dashboard, and policy page in light and dark mode', async ({
  684 |     page,
  685 |     baseURL,
  686 |   }) => {
  687 |     const wcagTags = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
  688 | 
  689 |     async function assertNoSeriousViolations(label: string) {
  690 |       const results = await new AxeBuilder({ page })
  691 |         .withTags(wcagTags)
  692 |         .analyze();
  693 |       const seriousOrCritical = results.violations.filter(
  694 |         (v) => v.impact === 'serious' || v.impact === 'critical'
  695 |       );
  696 |       expect(
  697 |         seriousOrCritical,
  698 |         `Axe serious/critical violations on ${label}: ${JSON.stringify(
  699 |           seriousOrCritical.map((v) => ({ id: v.id, impact: v.impact, help: v.help }))
  700 |         )}`
> 701 |       ).toEqual([]);
      |         ^ Error: Axe serious/critical violations on Consent Center (Dark): [{"id":"color-contrast","impact":"serious","help":"Elements must meet minimum color contrast ratio thresholds"}]
  702 |     }
  703 | 
  704 |     async function setTheme(dark: boolean) {
  705 |       await page.evaluate((isDark) => {
  706 |         if (isDark) {
  707 |           document.documentElement.classList.add('dark');
  708 |           window.localStorage.setItem('saathi_theme', 'dark');
  709 |         } else {
  710 |           document.documentElement.classList.remove('dark');
  711 |           window.localStorage.setItem('saathi_theme', 'light');
  712 |         }
  713 |       }, dark);
  714 |     }
  715 | 
  716 |     // 1. Policy page (light & dark)
  717 |     await page.goto(`${baseURL}/policy`);
  718 |     await expect(page.locator('main')).toBeVisible();
  719 |     await setTheme(false);
  720 |     await assertNoSeriousViolations('Policy Page (Light)');
  721 |     await setTheme(true);
  722 |     await assertNoSeriousViolations('Policy Page (Dark)');
  723 | 
  724 |     // 2. Home page & Cancel Keypad & Consent Center as Demo User
  725 |     await loginViaApiOnPage(page, baseURL!, DEMO_USER_PHONE);
  726 |     await setCancelWindowSeconds(page, 10);
  727 |     await page.evaluate(async () => {
  728 |       await fetch('/api/settings/cancel-pin', {
  729 |         method: 'PUT',
  730 |         headers: { 'Content-Type': 'application/json' },
  731 |         body: JSON.stringify({ pin: '1234' }),
  732 |       });
  733 |     });
  734 | 
  735 |     await page.goto(`${baseURL}/home`);
  736 |     await expect(page.getByTestId('sos-hold-button')).toBeVisible();
  737 |     await setTheme(false);
  738 |     await assertNoSeriousViolations('Home Page (Light)');
  739 |     await setTheme(true);
  740 |     await assertNoSeriousViolations('Home Page (Dark)');
  741 | 
  742 |     // Trigger SOS and open Cancel PIN keypad
  743 |     await holdSosButton(page);
  744 |     await expect(page.getByTestId('cancel-window-screen')).toBeVisible();
  745 |     await page.getByTestId('cancel-alert-btn').click();
  746 |     await expect(page.getByTestId('pin-keypad')).toBeVisible();
  747 |     await setTheme(false);
  748 |     await assertNoSeriousViolations('Cancel Keypad (Light)');
  749 |     await setTheme(true);
  750 |     await assertNoSeriousViolations('Cancel Keypad (Dark)');
  751 | 
  752 |     // Cancel the alert with PIN 1234
  753 |     for (const d of ['1', '2', '3', '4']) {
  754 |       await page.getByRole('button', { name: `Digit ${d}` }).click();
  755 |     }
  756 |     await page.getByTestId('pin-submit-btn').click();
  757 | 
  758 |     // 3. Consent Center (light & dark)
  759 |     await page.goto(`${baseURL}/consents`);
  760 |     await expect(page.locator('main')).toBeVisible();
  761 |     await setTheme(false);
  762 |     await assertNoSeriousViolations('Consent Center (Light)');
  763 |     await setTheme(true);
  764 |     await assertNoSeriousViolations('Consent Center (Dark)');
  765 | 
  766 |     // 4. Contact Alert Page (create an active alert, inspect magic link in light & dark)
  767 |     await setCancelWindowSeconds(page, 1);
  768 |     await page.goto(`${baseURL}/home`);
  769 |     await holdSosButton(page);
  770 |     await expect(page.getByTestId('live-status-screen')).toBeVisible({
  771 |       timeout: 8000,
  772 |     });
  773 |     const outboxRes = await page.evaluate(async () => {
  774 |       const r = await fetch('/api/dev/outbox');
  775 |       return r.json();
  776 |     });
  777 |     const smsLinks = (outboxRes.messages || []).filter(
  778 |       (m: { purpose: string; body: string }) =>
  779 |         m.purpose === 'sos_alert' && m.body.includes('/c/')
  780 |     );
  781 |     const smsWithLink = smsLinks[0];
  782 |     const magicToken = smsWithLink.body.match(/\/c\/([A-Za-z0-9_.-]+)/)[1];
  783 | 
  784 |     await page.goto(`${baseURL}/c/${magicToken}`);
  785 |     await expect(page.getByTestId('contact-btn-seen')).toBeVisible();
  786 |     await setTheme(false);
  787 |     await assertNoSeriousViolations('Contact Page (Light)');
  788 |     await setTheme(true);
  789 |     await assertNoSeriousViolations('Contact Page (Dark)');
  790 | 
  791 |     // 5. Responder Dashboard (light & dark)
  792 |     await loginViaApiOnPage(page, baseURL!, DEMO_RESPONDER_PHONE);
  793 |     await page.goto(`${baseURL}/responder`);
  794 |     await expect(page.locator('main')).toBeVisible();
  795 |     await setTheme(false);
  796 |     await assertNoSeriousViolations('Responder Dashboard (Light)');
  797 |     await setTheme(true);
  798 |     await assertNoSeriousViolations('Responder Dashboard (Dark)');
  799 |   });
  800 | 
  801 |   test('14. Phase 10A: Fake incoming call flow (settings, countdown, ringing, accept, timer, end) creates zero incidents', async ({
```