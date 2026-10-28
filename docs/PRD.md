# SAATHI — Product Requirements Document (PRD)
**Safety Assistance & Alert Technology for Help & Intervention**  
**Document Version:** 1.0 (MVP Canonical Specification)  
**Status:** Approved & Implemented  
**Date:** October 2026  

---

## 1. Executive Summary & Problem Statement

### 1.1 The Problem
Women navigating public, transit, and campus spaces face acute safety risks ranging from street harassment, stalking, and physical threats to sudden medical emergencies. In high-stress situations:
- **Cognitive & Motor Impairment Under Panic:** Complex multi-step apps, password logins, or typing text fail when a user is terrified or physically constrained.
- **Erratic Connectivity:** Transit corridors, basements, and rural routes suffer from mobile data dead zones. Purely cloud-dependent safety apps fail silently without network reception.
- **Paternalistic Surveillance vs. Privacy:** Many existing safety applications mandate continuous background location tracking. Survivors often delete these apps because abusive partners, family members, or overreaching platforms exploit continuous tracking to monitor movement.
- **Unrealistic Response Promises:** Commercial apps frequently advertise false promises of "instant private security arrival" or "guaranteed police response in 2 minutes", creating lethal false senses of security.

### 1.2 Mission & Solution
**SAATHI** (Safety Assistance & Alert Technology for Help & Intervention) is an installable, mobile-first Progressive Web Application (PWA) designed to provide fast, discreet, consent-first emergency help and structured coordination for trusted contacts and local responders.

SAATHI explicitly **complements** India's emergency response services (**112 ERSS** and **181 Women Helpline**). It never claims to replace them and never advertises guaranteed physical intervention times. Instead, SAATHI optimizes the critical first 10 minutes of an emergency: immediate one-tap trigger, rapid escalation to trusted personal contacts, silent duress protection, offline resilience, and operational dispatch for campus and community safety teams.

---

## 2. Core Philosophy & The Six Hard Constraints

Every feature, interaction, and technical boundary in SAATHI is governed by six immutable design principles:

1. **Limited Connectivity / Offline-First:**  
   The application must function without active internet connectivity. Emergency triggers are captured locally in IndexedDB, queued, and continuously retried. Direct SMS (`sms:`) and telephone (`tel:112`) fallbacks ensure immediate zero-data dispatch.
2. **Consent-First:**  
   Nothing is shared with anyone without explicit, granular, revocable user consent. Users maintain full visibility over what permissions are granted (location, microphone, camera, emergency sharing, data processing) and can revoke them instantly.
3. **No Coercive Tracking:**  
   No persistent background location tracking. No "track her" feature. Location is captured **only** during an active emergency incident or an active user-initiated Safe Journey, and GPS samples are strictly time-bounded with automated cryptographic retention purges.
4. **Realistic Responders & Escalation Ladders:**  
   Models trusted personal contacts, on-duty campus safety officers, and emergency helplines transparently. Escalation timers transition alerts if primary contacts do not acknowledge within designated windows.
5. **Simple Under Stress (One-Hand, 1–2 Taps):**  
   Emergency actions require at most two taps. Primary targets exceed 56px in height. No text entry is ever required to summon assistance.
6. **Deterministic SOS Path:**  
   The core emergency alerting path operates completely independently of external AI models, commercial push notification services, or third-party cloud infrastructure.

---

## 3. User Personas & System Roles

| Role | Persona Name / Type | Description & Primary Goals | Authentication Model |
| :--- | :--- | :--- | :--- |
| **User (Survivor)** | Aarohi (Student / Commuter) | Primary user seeking fast, discreet safety tools during daily commutes or campus navigation. Needs instant SOS, journey tracking, and complete privacy control. | E.164 Phone OTP + JWT in httpOnly Cookie |
| **Trusted Contact** | Rohit (Friend / Family) | Trusted personal contact designated by the user to receive emergency alerts and check-ins. Needs zero app installation or account signup to assist. | Ephemeral HMAC-signed Magic Link (`ctk_*`) sent via SMS |
| **Responder** | Officer Kavita (Campus Safety) | Verified security or community patrol officer monitoring an assigned organization zone. Needs a clear triage dashboard with live victim location, acknowledgement workflows, and operational note-logging. | Verified Phone OTP + `responder` Role Verification |
| **Administrator** | Meera (Safety Administrator) | Campus safety officer or institutional administrator managing responder rosters, auditing data access logs, and analyzing anonymized safety metrics. | Verified Phone OTP + `admin` Role Verification |

---

## 4. Complete Feature Breakdown & User Capabilities

### 4.1 Onboarding & Authentication
- **Phone OTP Sign-In:**  
  Users sign in via phone number formatted to international E.164 standards (e.g., `+919000000001`). A 6-digit cryptographic verification code is issued with a strict 5-minute lifespan and maximum 3 attempts before lockout.
- **Bi-Lingual Interface:**  
  Full native localization in **English** and **Hindi** (`hi`), toggleable with a single tap in the global navigation bar.
- **Session Continuity & Token Rotation:**  
  Uses short-lived JWT access tokens (15 minutes) stored in httpOnly secure cookies, coupled with rotating refresh tokens (7 days) for seamless re-authentication.
- **Onboarding Walkthrough:**  
  First-time users are guided through mandatory consent selections, setup of their first trusted contact, and configuration of safety PINs before accessing the primary emergency dashboard.

### 4.2 Consent Management Center (`/consents`)
- **Granular Consent Categories:**  
  Distinct toggles for `location`, `notifications`, `microphone`, `camera`, and `emergency_sharing`.
- **Append-Only Immutable Ledger:**  
  Every grant or revocation event writes an immutable timestamped audit record to the `consents` table.
- **Instant Revocation Effect:**  
  Revoking `location` consent instantly halts all ongoing GPS polling and prevents subsequent coordinate dispatches, even during active alerts.
- **Transparency Badges:**  
  Visual indicators clearly inform the user exactly what telemetry is being captured and who has access at any given moment.

### 4.3 Trusted Circle & Escalation Ladder (`/circle`)
- **Capacity:**  
  Users can configure up to 5 verified trusted contacts.
- **Per-Contact Permissions:**  
  Each contact has granular permissions:
  - `receives_sos`: Dispatches SMS emergency alerts when SOS triggers.
  - `receives_checkin`: Receives Safe Journey start/finish notifications.
  - `can_see_live_location`: Displays real-time Leaflet map coordinates during active emergencies.
- **Escalation Ordering:**  
  Contacts are organized in a priority ladder. If Contact #1 does not acknowledge an alert within the escalation timer window, the system automatically escalates notifications to Contact #2 and on-duty campus responders.
- **Contact Invitation Workflow:**  
  Adding a contact issues a secure public invitation link (`/invite/:token`). Contacts can inspect the requester's name and accept or decline with a single click—no account registration required.
- **Pause & Resume Controls:**  
  Users can temporarily pause alerts to specific contacts (e.g., while traveling or during exams) without removing them from their circle.

### 4.4 The SOS Emergency Engine (`/home`)
- **Primary SOS Trigger:**  
  Prominent, high-contrast Red Emergency Button (`BigButton`, min 56px height, high visual target) accessible immediately upon opening the app.
- **Configurable Cancel Window (5–30 Seconds):**  
  A visual countdown timer begins upon tapping SOS. If triggered accidentally, the user can cancel without broadcasting alerts. Default duration is 5 seconds.
- **Dual-PIN Security Architecture:**  
  - **Cancel PIN (4-Digit):** When entered during the cancel window, gracefully aborts the incident, transitions state to `CANCELLED`, and halts notifications.
  - **Duress PIN (4-Digit Silent Alarm):** When forced by an aggressor to cancel the alert, entering the secret Duress PIN triggers a deceptive screen: the UI visually mimics a successful cancellation ("Alert Cancelled"), while the backend silently elevates the incident to `ACTIVE` with `isDuress=true`, alerting trusted contacts and campus security immediately.
- **Multi-Modal Discreet Triggers:**  
  - **Triple-Tap Trigger:** Rapid 3 taps within 1.0 second on the header brand logo or quiet footer triggers an instant silent emergency alert.
  - **Shake Detection:** Uses device accelerometer (`DeviceMotionEvent`). Shaking the phone with an acceleration threshold > 18 m/s² initiates an alert without looking at the screen.
  - **Voice Code Word Recognition:** Experimental discreet trigger utilizing the browser Web Speech API. Speaking a designated safety codeword ("Help" or "Bachao") initiates an SOS alert hands-free.
- **Secondary Safety Utilities:**  
  - **Fake Incoming Call:** Simulates an incoming phone call with realistic ringing audio, caller screen ("Mom", "Home", or customizable contact), and interactive pick-up screen with pre-recorded realistic conversational audio to provide an escape pretext in uncomfortable social situations.
  - **Loud Deterrent Alarm:** Synthesizes an ear-piercing high-frequency dual-tone siren via Web Audio API accompanied by a high-contrast visual strobe to deter assailants and attract bystander attention.
  - **Disguise Calculator Mode:** Instantly transforms the application interface into a fully functional standard math calculator. The emergency interface is completely concealed until the user inputs their secret PIN followed by `=` to unlock.
- **Incident Categorization:**  
  During an active emergency, users can optionally tap quick one-touch categories (`Medical`, `Harassment`, `Stalking`, `Accident`) to give responders instant situational context without typing.

### 4.5 Offline & Low-Connectivity Resilience
- **IndexedDB Client Queue:**  
  Built with Dexie.js. If network connectivity drops, SOS activations and location updates are committed locally to an IndexedDB queue.
- **Persistent Connectivity Status Indicator:**  
  Global header displays real-time connection status (Green `Online` vs Amber `Offline`).
- **Auto-Flush Protocol:**  
  The client monitors `online` and `window.focus` events. Once connectivity is restored, all queued events are flushed with idempotent `clientRequestId` headers to prevent duplicate incident creation.
- **SMS & Telephony Fallbacks:**  
  If the API cannot be reached, the UI immediately exposes one-tap fallback actions:
  - Direct pre-filled SMS message containing emergency text and GPS coordinates.
  - Direct telephone links (`tel:112` and `tel:181`) requiring zero data connectivity.
- **Low Power / Data Saver Mode:**  
  Disables CSS animations, suppresses non-essential polling, and increases location sample intervals to conserve battery life in low-power scenarios.

### 4.6 Trusted Contact Magic Link Portal (`/c/:token`)
- **Zero-Barrier Access:**  
  Emergency contacts receive an SMS containing an expiring, signed magic link (`/c/:token`). Clicking the link opens a streamlined, mobile-optimized emergency tracking portal without requiring an account.
- **Real-Time Interactive Map:**  
  Integrated OpenStreetMap / Leaflet view displaying the victim's latest GPS position, accuracy radius, and elapsed time since last coordinate update.
- **Status & Responder Coordination:**  
  Displays whether campus responders have acknowledged or been dispatched.
- **Contact Action Controls:**  
  Contacts can tap one-touch response updates:
  - `I am aware / Seen`
  - `Calling her now` (launches phone dialer)
  - `On my way to her`
  - `Mark as resolved / She is safe`

### 4.7 Responder Dashboard (`/responder`)
- **Role-Gated Access:**  
  Restricted strictly to verified accounts with the `responder` role.
- **On-Duty Availability Toggle:**  
  Responders can toggle themselves On-Duty or Off-Duty. Alerts are routed only to on-duty personnel in the designated organization zone.
- **Zone-Based Triage Queue:**  
  Displays incoming alerts filtered by campus or community zone (`organizationZone`).
- **Victim Privacy Guard:**  
  Phone numbers and exact identity details are masked until the responder explicitly taps **Acknowledge Alert**.
- **Incident Lifecycle Management:**  
  Responders can self-assign, mark status as `RESPONDING`, log internal operational notes, and resolve incidents or flag them as `FALSE_ALARM` (with mandatory explanation).
- **Tamper-Evident Audit Logging:**  
  Every view, status transition, and note is automatically logged to the immutable `incident_access_audit` ledger.

### 4.8 Safe Journey Tracker (`/journeys`)
- **Time-Bounded Commute Monitoring:**  
  Users starting a transit journey select an expected arrival duration (e.g., 15 mins, 30 mins, 1 hour) and a designated trusted contact.
- **Contact Journey Notifications:**  
  The selected contact receives an automated SMS notification when the journey begins and when the user safely completes it.
- **Proactive Check-Ins & Extensions:**  
  5 minutes before arrival, the app prompts the user to check in or tap **Extend by 15 mins**.
- **Automated Escalation on Lapse:**  
  If the arrival timer lapses without a user check-in or safe completion, the system transitions the journey to `lapsed` and automatically alerts the contact and campus security.

### 4.9 Community Safety Reports & Geo-Layer (`/reports`)
- **Hazard Reporting:**  
  Users can anonymously report localized hazards across 6 standardized categories: `poor_lighting`, `harassment`, `stalking`, `unsafe_area`, `broken_cctv`, and `other`.
- **K-Anonymity & Geo-Binning:**  
  To prevent victim de-anonymization or tracking, GPS coordinates are truncated to coarse grid boundaries. Heatmaps and safety layer visualizations strictly require a minimum threshold of $k \ge 5$ distinct reports before rendering a zone as high-risk.
- **Administrative Moderation:**  
  Administrators can review and delete obsolete or malicious reports.

### 4.10 Helplines Directory & Safety Pulse (`/resources`)
- **24x7 Verified Directory:**  
  Instant one-tap dialing for national and local emergency resources:
  - **112:** National Emergency Response Support System (ERSS)
  - **181:** Women Helpline (Domestic Abuse & Distress)
  - **1091:** Women Police Helpline
  - **Sakhi One Stop Centres:** Comprehensive medical, legal, and counseling aid
  - **Campus Security Desks:** Direct local security numbers
- **Weekly Anonymous Safety Pulse:**  
  Prompts users with a lightweight 2-question weekly check-in (1–5 feeling of safety, whether they avoided routes due to safety concerns). Aggregated anonymously to identify systemic campus issues.
- **Post-Incident Resolution Rating:**  
  Following an incident resolution, users are invited to provide an optional 1–5 rating on responder efficacy.

### 4.11 Administration & Analytics (`/admin`)
- **Responder Roster Management:**  
  Review registered campus responders, update operational status, and assign organization zones.
- **Immutable Audit Log Viewer:**  
  Inspect detailed chronological records of all responder and administrative data accesses.
- **Privacy-Preserving Safety Metrics:**  
  Aggregates mean acknowledgement times, resolution durations, and incident counts while enforcing $k \ge 5$ privacy thresholds. Includes one-click CSV report export.
- **Demonstration & Simulation Controls:**  
  In development and demo environments (`DEMO_MODE=true`), provides simulation buttons to trigger simulated contact responses, responder acknowledgements, and full database resets.

---

## 5. Non-Functional Requirements & Performance Goals

| Metric | Target | Rationale |
| :--- | :--- | :--- |
| **SOS Trigger Time** | $< 100\text{ ms}$ | Immediate client-side response under acute stress. |
| **Touch Target Size** | $\ge 56\text{ px}$ height | Primary buttons must be easily pressed with one hand or trembling fingers. |
| **Offline Resilience** | $100\%$ of Core SOS | Trigger, cancel, fallback SMS, and queuing work without network reception. |
| **API Response Time** | $< 250\text{ ms}$ (95th percentile) | Fast backend validation and transactional database writes. |
| **Accessibility Compliance** | WCAG 2.1 AA | High contrast ratio ($\ge 4.5:1$), screen-reader support, reduced-motion overrides. |
| **Data Retention Purge** | Automated $\le 24\text{ hours}$ | Sensitive incident location coordinates are purged upon reaching terminal states. |

---

## 6. Assumptions & MVP Boundaries

1. **Cellular Gateway Integrations:**  
   In the MVP, SMS delivery, push notifications, and direct 112 ERSS integrations run against verified mock gateway interfaces (`MockSmsProvider`, `MockPushProvider`, `MockEmergencyServiceGateway`). Production deployment requires carrier contracts (e.g., Twilio, Gupshup, or CDAC 112 API).
2. **Web Browser Geolocation Constraints:**  
   PWA background location tracking in mobile browsers is subject to OS-level background throttling when the screen locks. The app advises keeping the browser tab active during active alerts.
3. **Single Process Architecture:**  
   Designed for single-container deployment (Express API + WebSocket + embedded SQLite in WAL mode). Multi-container horizontal clustering requires transitioning to external PostgreSQL.
