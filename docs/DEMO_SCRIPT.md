# SHAKTI — 5-Minute Live Presentation Demo Script (`DEMO_MODE=true`)

## Prerequisites

Start the server in development/demo mode (never in `NODE_ENV=production`):

```bash
DEMO_MODE=true npm run dev
```

When `DEMO_MODE=true` is active:
- Every screen displays the top banner: **`DEMO MODE: no real alerts are sent`** alongside the mock provider badges (`SMS: MockSmsProvider (MOCK)`, `Push: MockPushProvider (MOCK)`, `112: MockEmergencyGateway (MOCK)`).
- Seeded demo accounts, two accepted trusted contacts, an on-duty campus responder, verified community resources, and historical demo incidents/reports/pulses are ready immediately.
- At any point before or during a presentation, an admin can click **Reset Demo Data** (`POST /api/demo/reset`) to restore the clean baseline idempotently.

### Seeded Demo Accounts (Hosted-Demo Login OTP Hint)
When `DEMO_MODE=true`, the API returns a convenient "Demo code: 123456" verification hint directly on the OTP entry screen for seeded demo accounts:
- **Demo User**: `+919000000001` (Aarohi Sharma, `Demo Campus Zone`) — hint enabled by default in demo mode.
- **Campus Responder**: `+919000000002` (Inspector Vikram Singh, `Demo Campus Zone`) — hint enabled by default in demo mode.
- **Trusted Contacts**: `+919000000011` (Priya Verma) and `+919000000012` (Neha Kapoor) — hint enabled by default in demo mode.
- **Administrator**: `+919000000003` (Meera Nair, `Demo Campus Zone`) — hint is **suppressed by default** unless `DEMO_ADMIN_HINT=true` is explicitly set in the environment.

**Public vs. Private Presentation Guidance**:
- In a **public demo**, visitors can safely log in as the demo user, test contact links, and explore the campus responder dashboard. The admin account hint is suppressed so public viewers cannot alter administrative configurations.
- In a **private presentation**, set `DEMO_ADMIN_HINT=true` alongside `DEMO_MODE=true` to demonstrate the admin analytics dashboard, audit log inspector, and demo data reset tool without consulting terminal logs.
- When `DEMO_MODE` is off (or in production), the hint field is strictly absent for all accounts.

---

## Minute 0:00 – 1:00 | 1. Welcome, Onboarding & Consent-First Design

1. Open the app at `/`. Point out the **`DEMO MODE: no real alerts are sent`** banner and the always-visible **112 / 181** emergency strip at the top.
2. Sign in as the Demo User (`+919000000001`) using the echoed 6-digit OTP code.
3. Visit **Guide (`/onboarding`)** and **Consents (`/consents`)**:
   - Show the 3-step onboarding walkthrough (Consent Control, Trusted Circle, Emergency SOS) and optional safety PIN features.
   - Open the **Consent Center** to show explicit, revocable toggles (`data_processing`, `location`, `notifications`, `microphone`, `camera`) and the append-only consent audit history.

---

## Minute 1:00 – 1:45 | 2. Trusted Circle (`/circle`)

1. Navigate to **Trusted Circle (`/circle`)**.
2. Show the two pre-seeded accepted contacts (**Priya Verma** and **Rohan Kulkarni**) with granular sharing toggles (SOS Alerts, Check-In Notices, Live Location).
3. Add a third contact (or show how invitations generate a 48-hour single-use consent link so no contact is ever notified without their opt-in).

---

## Minute 1:45 – 3:00 | 3. Trigger SOS, Cancel Window & Live Status (`/home`)

1. Return to **Home (`/home`)**.
2. Press and hold the large **Hold for SOS** button (or tap a quick emergency category chip) to initiate an alert.
3. **Cancel Window (`INITIATED_CANCEL_WINDOW`)**:
   - Point out the countdown banner. Explain that accidental triggers can be cancelled immediately before any external notifications are dispatched, or the user can tap **Send Alert Now** to skip the countdown.
4. **Active Alert (`ACTIVE`)**:
   - Once the alert transitions to `ACTIVE`, show the calm **Live Status** card displaying:
     - Number of trusted contacts notified (`Priya Verma`, `Rohan Kulkarni`)
     - Campus responder routing status (`Demo Campus Zone`)
     - Direct 1-tap `tel:112` / `tel:181` and SMS/Call fallback actions.

---

## Minute 3:00 – 4:00 | 4. Simulate Contact & Responder Response + Responder Dashboard

1. Scroll to the **Demo Simulation Controls** panel on `/home` (visible only when `DEMO_MODE=true` for the demo user or admin):
   - Click **Simulate Contact: Seen** → watch the incident status transition through the real state machine to `ACKNOWLEDGED` and display the contact's response in real time.
   - Click **Simulate Contact: On My Way** → watch the status transition to `RESPONDING`.
   - Click **Simulate Responder: Acknowledge** and **Simulate Responder: On the Way** → these call the real `performResponderIncidentAction` service and record `[SIMULATED_DEMO_ACTION]` in the hash-chained audit log.
2. Open `/responder` (signed in as `+919000000002`) to show the **Responder Dashboard**:
   - Show the live queue, map/location view (gated by the user's Location consent), phone-redaction rules prior to acknowledgement, and action buttons (`Acknowledge`, `On the Way`, `Resolve`).
3. Click **Simulate Responder: Resolve** (or resolve from the Responder Dashboard) to transition the incident to `RESOLVED`, triggering the optional post-incident 1–5 trust rating card.

---

## Minute 4:00 – 5:00 | 5. Admin Impact Analytics, Audit Log & Idempotent Reset (`/admin`)

1. Sign in as the Administrator (`+919000000003`) and open **Admin (`/admin`)**.
2. Point out the **`Includes demo data`** badge next to the prototype banner (metrics include `is_demo` rows only when `DEMO_MODE=true`, satisfying the `n >= 5` minimum sample size rule).
3. Review the KPI cards (Alert-Initiation Time, Notification Delivery Rate, Time to First Acknowledgement, Time to Resolution, Audit Completeness = 100%, Weekly Safety Pulse, and Post-Incident Trust Score) and charts.
4. Switch to the **Admin Tools** tab (`/admin/tools`) and filter the **Incident Access Audit Log** to show the `[SIMULATED_DEMO_ACTION]` entries recorded during the live simulation.
5. Click **Reset Demo Data** (`POST /api/demo/reset`) to restore all demo users, contacts, responder state, resources, and sample metrics back to their clean starting state for the next presentation.
