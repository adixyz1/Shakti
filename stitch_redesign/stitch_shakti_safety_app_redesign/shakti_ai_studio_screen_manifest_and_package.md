# SHAKTI Complete Screen Manifest & AI Studio Restyle Reference Package
**Specification Standard**: `DESIGN.md` | `STITCH_PROMPTS.md` | `AI_STUDIO_RESTYLE_PROMPTS.md` | `slop-check.mjs`
**Target Environment**: Google AI Studio / React + Vite / Self-Hosted OFL Fonts / Zero External Icon Packages

---

## 1. Complete Screen Roster (Numbered & Functionality Mapped)

Every screen has been mapped to its canonical sequence number from `STITCH_PROMPTS.md` and `AI_STUDIO_RESTYLE_PROMPTS.md`, along with its DataStore reference ID, exact title, target device archetype, and comprehensive technical functionality.

| Screen # | Artifact Ref | Screen Title | Device | Primary Functionality & Technical Specification |
|:---:|:---|:---|:---:|:---|
| **01** | `{{DATA:SCREEN:SCREEN_32}}` | **Screen 01: Home (Idle)** | Mobile | • Persistent top app bar with online connectivity and sync state indicator.<br>• Real-time circle readiness indicator (3 of 5 active).<br>• Full-width 72px crimson hold-to-trigger SOS BigButton (`#9F1239`, 0px radius, 2s linear progress fill).<br>• Secondary discreet utility triggers: Fake Call, Loud Alarm, Walk With Me.<br>• Statutory disclosure line establishing SHAKTI complements 112 & 181. |
| **02** | `{{DATA:SCREEN:SCREEN_30}}` | **Screen 02: Home (SOS Countdown & PIN Pad)** | Mobile | • High-urgency 5-second countdown timer with flat progress boundary.<br>• Tabular 3x4 PIN abort keypad filling lower viewport (64px keys).<br>• Duress parity architecture: entering standard PIN or secondary safety PIN produces identical DOM timing and transition. |
| **03** | `{{DATA:SCREEN:SCREEN_28}}` | **Screen 03: SOS Active (Status Ladder)** | Mobile | • Strict vertical `StatusLadder` confirming immutable transmission states: *Saved on this phone* -> *Sent* -> *Delivered to circle* -> *Seen by contact* -> *Acknowledged* -> *Resolved*.<br>• Zero estimated arrival times or "help is on the way" claims.<br>• 48px emergency action cluster: *I am safe* (outline), *Call 112* (crimson), *Call 181* (teal). |
| **04** | `{{DATA:SCREEN:SCREEN_26}}` | **Screen 04: Home (Offline Queue & SMS Fallback)** | Mobile | • Full-width unpadded 1px border banner communicating offline queue status.<br>• Telemetry cache audit displaying local GPS lock, cell tower ID, and local audio buffer.<br>• Unformatted cellular SMS relay dispatch triggers and direct 112 cellular dialer. |
| **05** | `{{DATA:SCREEN:SCREEN_24}}` | **Screen 05: Emergency Circle** | Mobile | • 3 of 5 preselected trusted escalation contacts in priority order.<br>• Invite status indicators (*Active*, *Pending SMS Invite*).<br>• Drag/reorder priority hierarchy for automated cascade ring.<br>• 48px action opening bottom sheet modal to invite new verified contacts. |
| **06** | `{{DATA:SCREEN:SCREEN_22}}` | **Screen 06: Consent Center** | Mobile | • Grouped permission switches with visible text labels `On` and `Off` (never color alone).<br>• Three-part statutory disclosure for each sensor: *What is captured*, *When it activates*, *How long data is retained*.<br>• Honest limitation notice: Shake and acoustic detection operate only while screen is unlocked or app is in active foreground. |
| **07** | `{{DATA:SCREEN:SCREEN_20}}` | **Screen 07: Safe Journeys** | Mobile | • Walk planner with destination notes and discrete duration selector chips (`15 min`, `30 min`, `45 min`, `60 min`).<br>• Prominent statutory guarantee: *"SHAKTI cannot see your location during a walk."*<br>• Active journey monitor with countdown timer (`18:39`), *Check in* (teal), *+15 min*, and *End safely*. |
| **08** | `{{DATA:SCREEN:SCREEN_18}}` | **Screen 08: Hazard Map** | Mobile | • Flat cartographic street layout with 1px vector lines (no satellite or decorative tiles).<br>• Grouped community hazard clusters (*Street lighting (3)*, *Harassment hotspot (2)*, *Isolated underpass (1)*).<br>• 14-day automatic expiration disclosure and list-view alternative.<br>• 48px *Report a Hazard* action. |
| **09** | `{{DATA:SCREEN:SCREEN_16}}` | **Screen 09: Helplines** | Mobile | • Direct 24x7 voice lines: **112 National Emergency** (Toll-Free Police/Fire/Ambulance) and **181 Women Helpline** (Ministry of WCD).<br>• Verified specialized lines: **1091 Women in Distress**, **1098 Childline**, **112 Cyber Crime Cell**.<br>• Weekly Monday 06:00 IST verification audit stamps and zero-data-pack voice clarification. |
| **10** | `{{DATA:SCREEN:SCREEN_14}}` | **Screen 10: Settings** | Mobile | • Identity authentication and statutory 112 integration status.<br>• Primary 4-digit cancellation PIN and discrete secondary duress PIN setup.<br>• Countdown interval selector chips (`3s`, `5s`, `10s`) and hardware sensor triggers (Shake, Voice).<br>• Disguise Mode (Calculator mask with 3s '=' hold access).<br>• Data export (`.csv`) and local cryptographic ledger shredding Danger Zone. |
| **11** | `{{DATA:SCREEN:SCREEN_12}}` | **Screen 11: Sign In** | Mobile | • Clean sans-serif utility authentication with `English / हिंदी` switch.<br>• Country-coded phone field (`+91 98765 43210`) with 48px input height.<br>• Tabular digit entry for 6-digit SMS OTP with resend timer.<br>• End-to-end statutory boundary disclosure with links to legal terms. |
| **12** | `{{DATA:SCREEN:SCREEN_10}}` | **Screen 12: Legal Documentation** | Mobile | • Plain-language operational covenants: *Scope & Limits*, *Privacy Policy*, *Terms of Service*.<br>• Prominent statutory emergency disclaimer: community alert and peer-tracking protocol that complements but does not replace statutory 112/181 police dispatch.<br>• Explicit lists: *What SHAKTI Does* vs. *What SHAKTI Does Not Do*.<br>• Offline PDF download and plain-summary print actions. |
| **13** | `{{DATA:SCREEN:SCREEN_08}}` | **Screen 13: Contact Responder View** | Mobile | • Zero-account public web interface for emergency contacts receiving alerts.<br>• Real-time reverse geocoded coordinates (Near MG Road Metro, Pillar 142) and GPS accuracy badge (`±12m`).<br>• 15-second lossless ambient audio player recorded at trigger moment.<br>• Action cluster: *Acknowledge Alert* (teal), *Call Contact*, *Call 112 Police Dispatch* (crimson), and *Transfer to Secondary*. |
| **14** | `{{DATA:SCREEN:SCREEN_02}}` | **Screen 14: Desktop Responder & Admin Console** | Desktop | • 1440px high-density operational desk for institutional dispatchers.<br>• Real-time metric strip: Active Dispatches, Awaiting Contact Ack, Circle Escalated, Resolved Today, Avg Response Time (42s), 112 Relays.<br>• Comprehensive incident queue table with status ladder steps, triage actions (*Acknowledge Dispatch*, *Relay to 112 Command*), and `.csv` ledger export.<br>• Hardware sensor pipeline telemetry and Merkle-root cryptographic transaction logs. |
| **15** | `{{DATA:SCREEN:SCREEN_06}}` | **Screen 15: Home (Idle) - Hindi Localization** | Mobile | • Full Devanagari localization of Screen 01 rendered in `Noto Sans Devanagari`.<br>• Verifies 1.6 line height and text expansion tolerance for Indian regional deployment.<br>• Preserves Latin tabular numbers for status counts and phone numbers. |
| **16** | `{{DATA:SCREEN:SCREEN_04}}` | **Screen 16: SOS Active - Hindi Localization** | Mobile | • Full Devanagari localization of Screen 03 (स्थिति क्रम / Status Ladder).<br>• Confirmed step labels (*इस फोन पर सहेजा गया*, *भेजा गया*, *आपके चक्र को वितरित*, *संपर्क द्वारा देखा गया*, *स्वीकृत किया गया*, *संकट का समाधान*).<br>• Emergency controls: *112 पर कॉल करें* (crimson), *181 पर कॉल करें* (teal), *मैं सुरक्षित हूँ*. |

---

## 2. Design System Tokens (`tokens.css`)

```css
@theme {
  --color-*: initial;
  --color-paper: #F3F1EC;
  --color-surface: #FAF8F4;
  --color-ink: #0F172A;
  --color-muted: #475569;
  --color-line: #D6D2C8;
  --color-teal-700: #0F766E;
  --color-teal-800: #115E59;
  --color-crimson-800: #9F1239;
  --color-crimson-900: #881337;
  --color-night: #020617;
  --color-night-surface: #0B1220;
  --color-night-line: #1E293B;
  --color-night-text: #E7E5DF;

  --font-sans: "Plus Jakarta Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  --font-devanagari: "Noto Sans Devanagari", sans-serif;
  
  --radius-none: 0px;
  --radius-sm: 2px;
}
```

---

## 3. Google AI Studio Prompt Implementation Sequence

To import and apply this package directly into your existing Google AI Studio project with 187 tests, execute each milestone sequentially:

### Prompt R0: Verification & Baseline
> "Rules: this is a visual restyle only. Do not change behavior, routes, API calls, translation keys or any data-testid. Keep English and Hindi key sets identical. Run `npm run slop -- --report` and report findings in under 15 lines. Do not touch any components yet."

### Prompt R1: Primitives & Tokens (Attach Screens 01 & 02)
> "Restyle shared primitives (`BigButton`, `Button`, `Input`, `Card`, `Modal`, `Toast`, `BottomNav`, `Skeleton`) according to `DESIGN.md`. Ensure 2px maximum border radius, 1px solid borders, and zero shadows or gradients. Replace any lucide-react imports with custom inline SVGs."

### Prompt R2: Core SOS Flow (Attach Screens 01, 02, 03, 04)
> "Restyle PageLayout (top bar, bottom nav, statutory footer), Screen 01 (Home Idle), Screen 02 (SOS Countdown with tabular PIN pad), Screen 03 (Status Ladder with confirmed steps only), and Screen 04 (Offline queue with SMS fallback). Implement identical duress timing parity."

### Prompt R3: User Safety Workflows (Attach Screens 05, 06, 07, 08, 09, 10, 11)
> "Restyle Circle (05), Consent Center (06), Journeys (07), Reports & Hazard Map (08), Helplines (09), Settings (10), and Sign In (11). Implement skeletons, empty states, and offline cards for all data views."

### Prompt R4: Public Responders & Tactical Admin (Attach Screens 13 & 14)
> "Restyle Screen 13 (Contact Responder View without account requirement) and Screen 14 (Desktop Responder Queue & Admin Console at 1440px dense layout). Maintain all telemetry metrics and cryptographic audit logging."

### Prompt R5: Legal Covenant & Localization (Attach Screens 12, 15, 16)
> "Restyle Screen 12 (Legal Documentation with plain-language covenants) and verify Hindi localization parity on Screens 15 and 16. Run `npm run slop` to verify zero violations."
