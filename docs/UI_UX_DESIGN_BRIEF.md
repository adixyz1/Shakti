# SAATHI — UI/UX Design Brief
**Safety Assistance & Alert Technology for Help & Intervention**  
**Document Version:** 1.0 (MVP Canonical Design Specification)  
**Status:** Approved & Implemented  
**Date:** October 2026  

---

## 1. Design Philosophy & Emotional Tone

### 1.1 The "Calm Under Acute Stress" Principle
In an emergency, users experience adrenaline rushes, tunneling vision, hand tremors, and heightened anxiety. Traditional mobile application designs filled with complex dropdowns, tiny links, vibrant rainbow gradients, or marketing banners induce cognitive paralysis.

SAATHI's visual and interaction design is anchored in **four non-negotiable emotional mandates**:
1. **Reassuring & Grounding:** A soothing, authoritative deep teal aesthetic replaces frantic neon styling.
2. **Zero Clutter:** Only what is strictly necessary is visible. Primary actions take 1 tap; secondary actions take 2 taps.
3. **High Tactility & Feedback:** Large, physical-feeling buttons with explicit feedback states (subtle scale-down on press, clear loading spinners, accessible audio prompts).
4. **Anti-Stigma & Discretion:** The interface is clean and modern, avoiding loud "Victim App" labels. Features like the Calculator Disguise and Fake Call seamlessly blend into everyday phone usage.

---

## 2. Accessibility & Ergonomic Standards

### 2.1 One-Handed "Thumb Zone" Ergonomics
Over 85% of mobile emergency actions occur while the user is walking, running, or physically constrained.
- **Critical Action Placement:** The primary SOS button, cancel countdown controls, and primary confirmation buttons are pinned or centered within the natural lower arc of the user's thumb.
- **Fixed Mobile Bottom Navigation:** The 64px mobile navigation bar remains anchored to the bottom edge, enabling effortless single-thumb switching between core pages.
- **Top Header Discipline:** The top bar is reserved exclusively for passive identification, connectivity status, and secondary settings (language, dark mode, sign out).

### 2.2 Touch Target Specifications
Every clickable element adheres strictly to WCAG 2.1 AAA touch target guidelines:
- **Primary Emergency Actions (`BigButton`):** Minimum height of **`56px`** (typically `min-h-[56px] w-full px-6 py-3.5`).
- **Standard Controls & Secondary Buttons (`Button`, `Input`):** Minimum height of **`44px`** to **`48px`** (typically `min-h-[44px]` or `min-h-[48px]`).
- **Icon Buttons & Toggles:** Minimum bounding box of **`44px × 44px`** with centered visual icons.

### 2.3 Color Contrast & Visual Standards
- All text conforms to **WCAG 2.1 AA** (minimum contrast ratio of 4.5:1 for normal body text and 3:1 for large display text and interface controls).
- High visual contrast is preserved seamlessly in both Light Mode (`bg-slate-50 text-slate-900`) and Dark Mode (`bg-slate-950 text-slate-100`).
- Interactive focus states are explicitly styled using `focus-visible:ring-2 focus-visible:ring-teal-500 focus-visible:ring-offset-2`.

### 2.4 Motion Sensitivity & Data Saver
- **Reduced Motion:** Fully honors the user's `prefers-reduced-motion` system preference. Under reduced motion, all animations, transitions, and pulsing loaders are immediately flattened to `0.01ms`.
- **Low Power / Data Saver Mode:** Activating Data Saver sets `html[data-saver="true"]`, immediately disabling CSS keyframe animations and suppressing non-essential visual transitions to maximize battery survival.

---

## 3. Color Palette & Semantic Design Tokens

SAATHI utilizes a tailored Tailwind CSS palette built around deep oceanic teals, alert crimsons, and crisp slate neutrals:

```
┌────────────────────────────────────────────────────────────────────────┐
│                          PRIMARY COLOR SYSTEM                          │
├──────────────────┬─────────────────┬──────────────────┬────────────────┤
│ Deep Teal 800    │ Primary Teal 700│ Teal Accent 600  │ Soft Teal 100  │
│ #115E59          │ #0F766E         │ #0D9488          │ #CCFBF1        │
│ Brand Wordmarks  │ Primary Buttons │ Active Borders   │ Info Badges    │
├──────────────────┼─────────────────┼──────────────────┼────────────────┤
│                         EMERGENCY ALERT SYSTEM                         │
├──────────────────┬─────────────────┬──────────────────┬────────────────┤
│ Deep Rose 800    │ Crimson Rose 700│ Rose Accent 600  │ Soft Rose 100  │
│ #9F1239          │ #BE123C         │ #E11D48          │ #FFE4E6        │
│ Critical Hover   │ SOS Trigger     │ Active Alerts    │ Duress Banners │
├──────────────────┼─────────────────┼──────────────────┼────────────────┤
│                         NEUTRAL SURFACE SYSTEM                         │
├──────────────────┬─────────────────┬──────────────────┬────────────────┤
│ Pure White       │ Slate Canvas 50 │ Slate Border 200 │ Slate Text 900 │
│ #FFFFFF          │ #F8FAFC         │ #E2E8F0          │ #0F172A        │
│ Card Surface     │ Light App Shell │ Dividers/Borders │ Primary Text   │
├──────────────────┼─────────────────┼──────────────────┼────────────────┤
│ Dark Canvas 950  │ Dark Card 900   │ Dark Border 800  │ Dark Text 100  │
│ #020617          │ #0F172A         │ #1E293B          │ #F1F5F9        │
│ Night App Shell  │ Dark Surface    │ Dark Dividers    │ Night Text     │
└──────────────────┴─────────────────┴──────────────────┴────────────────┘
```

### Semantic Token Usage:
- `primary`: `#0F766E` (`bg-teal-700 text-white hover:bg-teal-800`). Used for primary actions, safe completions, and positive confirmations.
- `danger`: `#BE123C` (`bg-rose-700 text-white hover:bg-rose-800`). Reserved strictly for emergency SOS activation and emergency escalation actions.
- `secondary`: `#0F172A` in light mode / `#F8FAFC` in dark mode (`bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900`).
- `outline`: Neutral bordered button (`border-2 border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800`).
- `connectivity-online`: Deep teal text with subtle badge.
- `connectivity-offline`: Amber caution token (`bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200`).

---

## 4. Typography System

SAATHI utilizes **Plus Jakarta Sans** as its primary typeface, falling back to clean system sans-serifs (`-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`).

| Style Level | Tailwind Classes | Font Size / Weight | Purpose |
| :--- | :--- | :--- | :--- |
| **Brand Wordmark** | `text-lg font-bold tracking-tight` | 18px / 700 Bold | Top bar brand identity & triple-tap touch target |
| **Page Title** | `text-2xl font-bold tracking-tight` | 24px / 700 Bold | Screen headlines (e.g., "Safety Center", "Trusted Circle") |
| **Section Heading**| `text-lg font-semibold` | 18px / 600 SemiBold | Card titles and modal dialog headers |
| **Card Subtitle** | `text-sm font-medium text-slate-500` | 14px / 500 Medium | Descriptive context and category indicators |
| **Body Text** | `text-sm text-slate-600 dark:text-slate-300`| 14px / 400 Regular | Paragraphs, policy descriptions, guidance copy |
| **Button Text** | `text-base font-semibold` | 16px / 600 SemiBold | High-clarity interactive buttons |
| **Micro Labels** | `text-xs font-semibold uppercase` | 12px / 600 SemiBold | Status badges, timestamp chips, telemetry labels |
| **Numeric Codes** | `font-mono tracking-widest text-xl` | 20px / Monospace | PIN inputs, 6-digit OTP verification codes |

---

## 5. Core Reusable Component Library

### 5.1 `BigButton`
- **Purpose:** Primary emergency actions, SOS trigger, journey start/end.
- **Attributes:** Full width (`w-full`), minimum height `56px`, `rounded-2xl`, bold typography, active press feedback (`active:scale-[0.99]`), subtle elevation shadow (`shadow-sm`).
- **Variants:** `primary` (Teal), `danger` (Crimson Rose), `secondary` (Slate), `outline`.

### 5.2 `Button`
- **Purpose:** Standard interactive buttons, navigation triggers, modal actions.
- **Attributes:** Minimum height `44px`, `rounded-xl`, `font-medium text-sm`, inline spinner support.

### 5.3 `Card`
- **Purpose:** Content container for grouping information.
- **Attributes:** `rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 shadow-xs`.

### 5.4 `Input`
- **Purpose:** Phone entry, names, journey notes, numeric codes.
- **Attributes:** Minimum height `48px`, `rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 px-4 py-2.5`, explicit error state with `role="alert"` message in `rose-600`.

### 5.5 `Modal`
- **Purpose:** PIN verification, fake call, loud alarm, confirmation dialogs.
- **Attributes:** Accessible `role="dialog"` and `aria-modal="true"`, dimmed backdrop blur (`bg-black/60 backdrop-blur-xs`), `rounded-2xl`, explicit close icon (`min-w-[44px] min-h-[44px]`).

### 5.6 Global Header Layout (Strict 3-Zone Contract)
- **Height:** Fixed `h-16` (64px) with sticky positioning (`sticky top-0 z-30`).
- **Zone 1 (Left):** Brand Wordmark ("SAATHI"). Functions double-duty as the default stealth triple-tap emergency trigger.
- **Zone 2 (Center - Desktop Only):** Clean text navigation links (`Home`, `Journeys`, `Reports`, `Resources`, `Circle`, `Consents`, `Settings`).
- **Zone 3 (Right):** Connectivity status pill (`Online` / `Offline`), PWA Install Button, Language Toggle (`EN`/`HI`), Dark/Light mode toggle, and Sign Out button.

### 5.7 Mobile Bottom Navigation Bar (`BottomNav`)
- Anchored to bottom screen edge on mobile (`md:hidden fixed bottom-0 left-0 right-0 z-40 h-16`).
- Grid of 4 equal thumb-accessible tabs with 20px Lucide icons and concise text:
  1. **Home** (`HomeIcon`)
  2. **Circle** (`UsersIcon`)
  3. **Consents** (`ShieldCheckIcon`)
  4. **Settings** (`SettingsIcon`)
- Active tab highlighted in `text-teal-700 dark:text-teal-400`.

---

## 6. Screen-by-Screen Structural Specifications

### 6.1 Splash & Welcome Screen (`/`)
- Hero section with clear mission: "Fast, discreet help when you need it."
- Primary Call to Action: "Get Started" (routes to `/login` or `/onboarding`).
- Direct prominent links to Indian National Helplines: 112 (National Emergency) and 181 (Women in Distress).
- Transparency statement: Explicit confirmation that SAATHI never tracks location in the background.

### 6.2 Authentication & OTP Verification (`/login`)
- Clean card-based login.
- Step 1: E.164 phone number input with India flag prefix (`+91`).
- Step 2: 6-digit verification code input with countdown timer and attempt indicator.
- Demo mode helper banner (in development/demo mode) providing pre-configured test accounts.

### 6.3 Emergency Center / Home Screen (`/home`)
The home screen adapts dynamically across four operational states:

1. **Idle State:**
   - Large central Red SOS `BigButton` ("TAP FOR EMERGENCY HELP").
   - Quick Discreet Actions Row:
     - 📞 **Fake Call:** Opens simulated incoming call.
     - 🔊 **Loud Alarm:** Opens deterrent audio strobe siren.
     - 🧮 **Calculator Disguise:** Replaces interface with stealth calculator.
   - Quick Status Overview: Number of active trusted contacts, active location consent status.
2. **Countdown / Cancel State:**
   - Giant countdown timer (5 seconds by default) with visual pulse.
   - Large "Cancel Alert" button prompting for 4-digit PIN.
   - Clear copy: "Alerting contacts in X seconds...".
3. **Active Alert State:**
   - Urgent banner: "EMERGENCY ACTIVE — Help Notified".
   - Real-time escalation ladder showing delivery status to Contact #1, Contact #2, and Campus Responders.
   - Emergency category pills (Medical, Harassment, Stalking, Accident).
   - "I Am Safe / Resolve Alert" confirmation button.
4. **Offline Fallback State:**
   - Highlighted amber warning card: "You are offline. Alerts are queued locally."
   - One-tap "Send Pre-Filled Emergency SMS" button.
   - Direct "Call 112 Now" button.

### 6.4 Trusted Circle (`/circle`)
- Summary card showing contact count (e.g., "3 of 5 contacts configured").
- Escalation ladder list: contacts displayed in priority order with status badges (`Accepted`, `Invited`, `Paused`).
- Contact configuration drawer: toggles for `Receives SOS SMS`, `Receives Journey Check-ins`, and `View Live Location`.
- Add Contact Modal with instant SMS invite link generation.

### 6.5 Consent Center (`/consents`)
- Clear toggle switches for each capability:
  - 📍 **Location Sharing:** Active only during SOS or Safe Journey.
  - 🔔 **Emergency Notifications:** SMS and alert dispatch.
  - 🎙️ **Microphone Access:** For voice codeword activation ("Help" / "Bachao").
  - 🛡️ **Data Processing:** Minimal incident auditing.
- Detailed explanation under each toggle explaining exactly why the permission is used and when it expires.
- Instant "Revoke All Consents" emergency action.

### 6.6 Safe Journey (`/journeys`)
- Journey Setup: Estimated travel duration selector (15 min, 30 min, 45 min, 1 hour), destination note, and contact picker.
- Active Journey Screen: Prominent remaining arrival countdown, "+15 Min Extension" button, and "I Have Arrived Safely" completion button.
- Lapsed Alert Warning: Displays emergency countdown if arrival time passes without safe check-in.

### 6.7 Safety Reports & Community Layer (`/reports`)
- Form to submit anonymous localized safety hazard reports (poor lighting, harassment, broken CCTV).
- Visual Heatmap Layer: Geo-binned clusters rendered on Leaflet map only when $\ge 5$ distinct reports exist in a grid cell.

### 6.8 Helplines & Resources Directory (`/resources`)
- Tabbed directory of national emergency desks: 112, 181, 1091, Sakhi One Stop Centres.
- Direct `tel:` links with phone icons for instant zero-data dialing.
- Weekly Anonymous Safety Pulse card.

### 6.9 Settings & Discreet Triggers (`/settings`)
- Cancel Window slider (5s to 30s).
- Setup / Update 4-Digit Cancel PIN.
- Setup / Update 4-Digit Duress PIN (silent alarm).
- Discreet Trigger Configurations:
  - Triple-Tap Zone toggle (Logo vs Footer).
  - Shake Sensitivity slider / toggle.
  - Voice Code Word listener toggle.
  - Low Power / Data Saver mode toggle.
- Personal Data Management: "Download My Data Export (JSON)" and "Permanently Delete My Account".

---

## 7. Discreet & Stealth Mode Specifications

### 7.1 Calculator Disguise Mode
- **Visual Appearance:** Styled identically to a standard iOS/Android dark mode calculator with numeric keypad (`0-9`), operators (`+`, `-`, `×`, `÷`), clear (`C`), and equals (`=`).
- **Functional Math:** Fully evaluates basic arithmetic expressions so any onlooker inspecting the screen sees normal math calculations.
- **Secret Unlock:** Entering the user's secret Cancel or Duress PIN followed by `=` instantly dismisses the calculator and unlocks the emergency portal.

### 7.2 Fake Incoming Call Simulation
- **Visuals:** Full-screen incoming call interface featuring a realistic caller profile image, contact name ("Mom" or customizable), incoming call animation, and green "Accept" / red "Decline" sliders.
- **Audio:** Plays an authentic telephone ringtone via the Web Audio API.
- **Connected State:** Tapping "Accept" displays an active call screen with call duration counter and plays simulated realistic dialogue audio ("Hey, where are you? I'm waiting outside...") to provide a natural excuse to exit dangerous conversations.

### 7.3 Loud Deterrent Alarm & Visual Strobe
- **Audio Output:** Uses dual Web Audio API oscillators producing an alternating high-decibel warble siren (800 Hz / 1200 Hz).
- **Visual Strobe:** High-frequency screen background flashes between stark white and alert red to maximize nighttime visibility.
- **One-Tap Deactivation:** Prominent "Stop Alarm" button to instantly silence audio.
