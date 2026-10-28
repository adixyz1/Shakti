# Implementation Plan: SAATHI Prototype Redesign (Stitch 'Paper Utility' System)

Restyle the entire SAATHI (Safety Assistance & Alert Technology for Help & Intervention) web application to adopt the high-contrast, flat editorial **Paper Utility** design language exported from Stitch across all 16 mapped screens, while preserving 100% of the underlying Express API, SQLite database, offline Dexie queue, dual-PIN duress safety, and test suites.

---

## User Review & Critical Decisions

> [!IMPORTANT]
> The clarifying questions were answered with the recommended baseline defaults. Below are the governing architectural and visual commitments for this redesign:

- **Confirmed Visual Aesthetic**: Strict **Paper Utility** design standard (`#F3F1EC` paper canvas, `#FAF8F4` surface, `#0F172A` ink, `#D6D2C8` hairline borders, 0px–2px corner radii, zero drop shadows, zero color gradients, zero decorative pill badges).
- **Confirmed Execution Flow**: Phased milestone rollout starting with design system primitives & tokens, followed by the core SOS emergency flow, user safety workflows, responder/admin consoles, and legal/localization verification.
- **Confirmed Iconography Strategy**: Migration from external icon packages to lightweight custom inline 24px SVGs with 2px stroke, square line caps, and miter joins as designed in Stitch.
- **Guaranteed Functionality Retention**: Every existing route (`/home`, `/circle`, `/consents`, `/journeys`, `/reports`, `/resources`, `/settings`, `/login`, `/c/:token`, `/responder`, `/admin`), API integration, offline queue synchronization, dual-PIN deception architecture, and unit/E2E test suite remains fully operational.

---

## 1. Overview & Core Concept

### What It Does
Transforms the visual identity of SAATHI from a generic rounded-card web interface into an authoritative, calm, high-contrast **editorial paper utility**. The interface is purpose-built for women navigating acute physical or emotional distress, low-light outdoor environments, and one-handed thumb interaction under physical constraint.

### Target Audience & Operational Personas
1. **Primary Survivor / Commuter (Mobile PWA)**: Needs a 72px zero-ambiguity SOS trigger, tactile 3x4 PIN pad with indistinguishable cancel vs duress timing, and real-time confirmed transmission status.
2. **Trusted Contact (Mobile Web)**: Inspects alert magic links with reverse-geocoded landmarks, GPS accuracy radius, and ambient audio playback without needing an account.
3. **Campus / Community Responder & Admin (1440px Desktop Console)**: Triages incoming emergency dispatches with a dense tabular incident queue, zone routing, and tamper-evident audit logs.

### Key Value
Eliminates cognitive friction and false promises: zero artificial "help is arriving in 2 minutes" conjectures, zero skeuomorphic eye-candy, and immediate access to verified national emergency voice lines (112 & 181).

---

## 2. User Experience & Visual Design

```
┌────────────────────────────────────────────────────────────────────────┐
│                        PAPER UTILITY COLOR SYSTEM                      │
├──────────────────┬─────────────────┬──────────────────┬────────────────┤
│ Canvas: Paper    │ Surface Tier    │ Primary Ink      │ Hairline Line  │
│ #F3F1EC          │ #FAF8F4         │ #0F172A          │ #D6D2C8 (1px)  │
├──────────────────┼─────────────────┼──────────────────┼────────────────┤
│ Action: Teal 700 │ Active Teal 800 │ Emergency Crimson│ Dark Mode Base │
│ #0F766E          │ #115E59         │ #9F1239 (SOS)    │ #020617 (Night)│
└──────────────────┴─────────────────┴──────────────────┴────────────────┘
```

### Visual Identity & Theme
- **Surface Elevation**: Completely flat. Depth is achieved strictly through tonal alternation between `paper` (`#F3F1EC`) and `surface` (`#FAF8F4`) separated by crisp 1px hairline rules in `line` (`#D6D2C8`). No box shadows or blur scrims.
- **Geometric Radius**: Standard 2px corner radius for cards, inputs, and secondary buttons. Absolute 0px radius (`rounded-none`) for full-width emergency banners, bottom sheets, and the 72px crimson SOS `BigButton`.
- **Night / Dark Mode Inversion**: Uses `night` (`#020617`), `night-surface` (`#0B1220`), `night-line` (`#1E293B`), and `night-text` (`#E7E5DF`). Pure `#FFFFFF` and `#000000` are prohibited to eliminate harsh night glare.
- **Typographic Scale**:
  - Primary Display: **Plus Jakarta Sans** (700 Bold, 32px mobile / 36px desktop).
  - Devanagari Script: **Noto Sans Devanagari** (expanded 1.6 line height for matra clearance).
  - Body Text: 16px minimum base font size with 1.5 line height.
  - Telemetry & PINs: Tabular figures (`font-mono tabular-nums`) mandatory for countdowns, phone numbers, and coordinates.
- **Top Bar Contract (3 Zones)**:
  - Zone 1 (Left): Single-line text wordmark `SAATHI` in Plus Jakarta Sans.
  - Zone 2 (Center): 4–5 single-line text links with subtle hover underlines (`Home`, `Circle`, `Journeys`, `Reports`, `Resources`).
  - Zone 3 (Right): Single-action cluster featuring the flat network connectivity pill (`Online` / `Offline`), language toggle (`EN` / `HI`), and auth trigger.
- **Mobile Bottom Navigation**: Anchored 56px height, 4 thumb-accessible tabs with 24px custom inline SVGs and 10px uppercase labels.

---

## 3. Key Product Decisions & Trade-Offs

### Decision 1: Strict Flat Hairline Utility vs Soft Modern Glassmorphism
- **Chosen Approach**: Flat 1px hairline borders (`#D6D2C8`), 0–2px radii, zero box shadows, zero background blurs.
- **Why**: Under bright sunlight or high-stress tremors, blurred glass layers and soft drop shadows degrade edge contrast. Crisp 1px hairlines ensure immediate visual demarcation.
- **Alternatives Considered**: Retaining rounded-2xl cards with soft shadows was rejected as it conflicts with the Paper Utility spec and induces visual clutter.

### Decision 2: Hold-to-Trigger SOS with Horizontal Fill vs Instant Tap
- **Chosen Approach**: 72px high full-width crimson button (`#9F1239`, 0px radius) with a 2-second linear progress fill on hold, followed by the 5-second countdown window with the 3x4 tabular PIN abort pad.
- **Why**: Prevents accidental false alarms in pockets while remaining effortless to trigger under acute duress.
- **Alternatives Considered**: Circular pulsing radial buttons were rejected due to poor one-handed thumb ergonomics.

### Decision 3: Vertical `StatusLadder` with Confirmed States Only
- **Chosen Approach**: Linear progression displaying only verified physical milestones: *Saved on this phone* $\rightarrow$ *Sent* $\rightarrow$ *Delivered to circle* $\rightarrow$ *Acknowledged* $\rightarrow$ *Resolved*.
- **Why**: Eliminates misleading arrival time claims. Complements official emergency services (112/181) without pretending to replace police dispatch.

---

## 4. Technical Architecture & Component Mapping

```
┌────────────────────────────────────────────────────────────────────────┐
│               COMPONENT MAPPING & REDESIGN FLOW                        │
├────────────────────────────────────────────────────────────────────────┤
│ 1. DESIGN TOKENS & CSS                                                 │
│    src/index.css ──► Paper Utility CSS Variables & Tailwind Theme     │
├────────────────────────────────────────────────────────────────────────┤
│ 2. SHARED PRIMITIVES (apps/web/src/components/ui/index.tsx)            │
│    • BigButton (72px, 0px radius, crimson linear progress)            │
│    • Button (48px, 2px radius, primary teal / outline / quiet)        │
│    • Input (48px, 2px radius, 1px line, label above, role="alert")    │
│    • Card (2px radius, surface fill, 1px line, zero shadow)           │
│    • Modal & Sheet (flat 60% ink scrim, 0px radius sheet)             │
│    • StatusLadder (confirmed vertical transmission checkpoints)        │
│    • Custom Inline SVGs (24px, 2px stroke, square caps, miter joins)  │
├────────────────────────────────────────────────────────────────────────┤
│ 3. SCREEN RESTYLING (16 Screens Mapped from Stitch Package)            │
│    • Screen 01: HomePage (Idle) ◄── home_idle_hindi/code.html         │
│    • Screen 02: Countdown & 3x4 PIN Pad ◄── home_idle_hindi/code.html │
│    • Screen 03: SOS Active Ladder ◄── sos_active_status_ladder/       │
│    • Screen 04: Offline Queue & SMS Fallback ◄── offlineQueue.ts      │
│    • Screen 05: TrustedCirclePage ◄── emergency_circle/code.html      │
│    • Screen 06: ConsentCenterPage ◄── consent_center/code.html        │
│    • Screen 07: SafeJourneyPage ◄── safe_journeys/code.html           │
│    • Screen 08: SafetyReportsPage & Map ◄── hazard_map/code.html      │
│    • Screen 09: ResourcesPage (Helplines) ◄── helplines/code.html     │
│    • Screen 10: SettingsPage ◄── settings/code.html                   │
│    • Screen 11: LoginPage (Sign In & OTP) ◄── sign_in/code.html       │
│    • Screen 12: PolicyPage (Legal Covenants) ◄── legal_documentation/ │
│    • Screen 13: ContactAlertPage ◄── contact_responder_view/code.html │
│    • Screen 14: Responder & Admin Page ◄── desktop_responder_queue/   │
│    • Screens 15 & 16: Hindi Localization Parity (Devanagari 1.6 LH)   │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 5. Milestone Implementation Sequence

### Milestone R0: Design Tokens & CSS Foundation
- Update `src/index.css` with the complete Paper Utility token palette (`--color-paper: #F3F1EC`, `--color-surface: #FAF8F4`, `--color-ink: #0F172A`, `--color-line: #D6D2C8`, `--color-teal-700: #0F766E`, `--color-crimson-800: #9F1239`, `--color-night: #020617`, etc.).
- Set base typography rules: Plus Jakarta Sans for Latin, Noto Sans Devanagari for Hindi, tabular numerals for numbers.

### Milestone R1: Shared UI Primitives & Inline SVGs
- Refactor `apps/web/src/components/ui/index.tsx`:
  - `BigButton`: 72px height, 0px radius, flat crimson fill, linear hold-to-activate progress.
  - `Button`: 48px height, 2px radius, primary teal / outline / quiet variants.
  - `Input`: 48px height, 2px radius, 1px line border, surface background.
  - `Card`: 2px radius, surface background, 1px hairline border, zero box shadows.
  - `Modal` / `Sheet`: Flat ink 60% scrim, 0px bottom sheet geometry, visible text dismiss button.
  - Custom Inline SVG components replacing Lucide imports across shared primitives.

### Milestone R2: Core SOS & Navigation Shell
- Restyle `PageLayout.tsx`: Top App Bar with strict 3-zone layout, flat online/offline pill, statutory footer.
- Restyle `HomePage.tsx`:
  - State 1: Idle Home with 72px hold-to-trigger SOS button, circle readiness indicator, and discreet utility triggers.
  - State 2: Countdown window with flat 5-second timer and 3x4 tabular PIN pad with identical duress timing parity.
  - State 3: Active Emergency with vertical confirmed `StatusLadder` and 48px action cluster (*I am safe*, *Call 112*, *Call 181*).
  - State 4: Offline Queue banner with telemetry cache audit and direct SMS relay trigger.

### Milestone R3: User Safety Workflows
- Restyle `TrustedCirclePage.tsx` (Screen 05): 3 of 5 active contact indicator, priority ordering, SMS invite drawer.
- Restyle `ConsentCenterPage.tsx` (Screen 06): Grouped switches with explicit `On`/`Off` text, statutory sensor disclosures.
- Restyle `SafeJourneyPage.tsx` (Screen 07): Walk duration selector chips (`15m`, `30m`, `45m`, `60m`), active countdown timer (`18:39`), statutory guarantee banner.
- Restyle `SafetyReportsPage.tsx` (Screen 08): Clean 1px cartographic hazard map, cluster indicators, 14-day expiry note.
- Restyle `ResourcesPage.tsx` (Screen 09): Direct 112 & 181 call cards, specialized lines, verification audit stamps.
- Restyle `SettingsPage.tsx` (Screen 10): PIN setup, countdown interval chips, disguise calculator mode, cryptographic data shredding.
- Restyle `LoginPage.tsx` (Screen 11): Country-coded 48px phone field, tabular 6-digit OTP boxes, statutory terms links.

### Milestone R4: Responders, Contact Magic Links & Admin Console
- Restyle `ContactAlertPage.tsx` (Screen 13): Zero-account view with reverse-geocoded coordinates, GPS accuracy badge, ambient audio player, and response buttons.
- Restyle `ResponderDashboardPage.tsx` & `AdminPage.tsx` (Screen 14): 1440px dense operational desk, metric strip (Active Dispatches, Response Times, 112 Relays), incident triage table, and CSV audit export.

### Milestone R5: Legal Documentation, Hindi Localization & Verification
- Restyle `PolicyPage.tsx` (Screen 12): Plain-language covenants (*What SHAKTI Does* vs *What SHAKTI Does Not Do*), offline PDF/print view.
- Verify Hindi localization parity on all screens (Screens 15 & 16) with 1.6 line-height Devanagari rendering.
- Run `compile_applet`, `lint_applet`, and all Vitest / Playwright test suites to ensure 100% build and behavioral verification.

---

## 6. Verification & Test Plan

1. **Compilation & Typing Integrity**: Run `compile_applet` and `lint_applet` after each milestone.
2. **Automated Unit & Integration Tests**: Verify that existing backend and UI tests continue passing (`npm run test:api`, `npm run test:web`).
3. **Visual & Touch Target Inspection**: Verify with DOM checks that:
   - All interactive controls have $\ge 48\text{px}$ touch target height ($\ge 72\text{px}$ for SOS).
   - Zero drop shadows (`shadow-*`) or gradient fills remain.
   - All component corner radii are strictly $\le 2\text{px}$.
   - Emergency duress PIN submission produces identical timing and screen transitions as standard cancellation.
