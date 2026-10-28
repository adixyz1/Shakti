# SAATHI — Technical Requirements Document (TRD)
**Safety Assistance & Alert Technology for Help & Intervention**  
**Document Version:** 1.0 (MVP Canonical Technical Specification)  
**Status:** Approved & Implemented  
**Date:** October 2026  

---

## 1. Architectural Principles & System Design

### 1.1 Single-Process, Single-Port Architecture
To eliminate proxy overhead, cross-origin resource sharing (CORS) race conditions, and deployment complexity, SAATHI runs as a **unified single-process Node.js server on Port 3000**:
- **API Engine:** Express.js REST API mounted under `/api/*`.
- **Real-Time Hub:** `ws` WebSocket Server mounted at `ws://localhost:3000/ws`.
- **Frontend Delivery:** 
  - *Development Mode (`npm run dev`):* Express mounts the Vite development server as an internal middleware (`vite.middlewares`). Hot module reload and client bundles are served from the same process on port 3000.
  - *Production Mode (`npm run start:prod`):* Express serves pre-built static assets from `apps/web/dist` with cache headers, with client-side routing fallback to `index.html`.
- **No Secondary Runtimes:** No external Python processes, no nginx reverse-proxy dependency, and no microservice fragmentation.

### 1.2 Technology Stack Matrix

| Domain | Technology / Library | Version | Selection Justification |
| :--- | :--- | :--- | :--- |
| **Frontend Framework** | React + TypeScript | 19.x | Strict typing, robust concurrency, functional components & hooks. |
| **Client Bundler** | Vite | 6.x | Near-instant cold start, native ES module compilation. |
| **Styling & Theme** | Tailwind CSS v4 | 4.x | Utility-first, zero runtime CSS-in-JS overhead, `@import "tailwindcss";` setup. |
| **Routing** | React Router | 7.x | Declarative client-side routing, protected role guardrails. |
| **Server State** | TanStack Query (React Query) | 5.x | Automatic caching, stale-while-revalidate, zero refetch on stress. |
| **Client State** | Zustand | 5.x | Ultra-lightweight reactive stores (`authStore`, `triggerSettingsStore`, `demoStore`). |
| **Offline Storage** | Dexie.js (IndexedDB) | 4.x | Structured, transactional offline queuing for emergencies and location telemetry. |
| **Maps & Geo** | Leaflet + OpenStreetMap | 1.9.x | Free, zero-key dependency, robust vector and tile map rendering. |
| **Localization** | i18next + react-i18next | 24.x | Native English (`en`) and Hindi (`hi`) dictionaries with instant switching. |
| **Backend Runtime** | Node.js + Express | Node 20+ / Express 4.x | High-throughput asynchronous event loop, extensive ecosystem. |
| **Validation** | Zod | 3.x | End-to-end schema validation for HTTP payloads and environment variables. |
| **WebSockets** | `ws` | 8.x | High-performance, lightweight real-time event broadcasting. |
| **Database & ORM** | Drizzle ORM + SQLite (`saathi.db`) | Drizzle 0.38+ | Real relational SQL database in WAL mode with versioned migrations. Zero-refactor path to PostgreSQL. |
| **Security & Auth** | Jose / jsonwebtoken, PBKDF2 | Native Node / 9.x | Signed HMAC-SHA256 JWT tokens, salted PBKDF2 hashes for PINs and OTPs. |
| **Testing** | Vitest, Supertest, RTL, Playwright | Latest | Unified testing runner for API unit/integration, UI components, and browser E2E. |

---

## 2. Security, Authentication & Session Architecture

### 2.1 Cryptographic Storage & Secrets
- **Passwordless Phone OTP:**  
  Six-digit numeric OTPs generated with `crypto.randomInt(100000, 999999)`. Stored in `otp_codes` as a salted PBKDF2 hash (`10,000` iterations, SHA-512). Expiry strictly enforced at 300 seconds (5 minutes); maximum 3 attempts before code invalidation.
- **Safety PINs (Cancel & Duress):**  
  User PINs are four digits. They are stored as salted PBKDF2 hashes (`cancel_pin_hash`, `duress_pin_hash`). They are never stored in plaintext, never logged, and never returned in API payloads.
- **Secret Keys:**  
  Controlled by `JWT_SECRET_KEY` and `HMAC_SECRET_KEY`. In production mode (`NODE_ENV=production`), the application strictly enforces a minimum key length of 32 characters and terminates on startup if default development secrets are detected.

### 2.2 Token-Based Access & RBAC
- **Access Tokens:**  
  JWT containing `{ sub: userId, role: 'user' | 'responder' | 'admin', zone: string }`. Lifespan is 15 minutes. Delivered either via `Authorization: Bearer <token>` header or `saathi_access` httpOnly secure cookie (`SameSite=Lax`).
- **Refresh Tokens:**  
  JWT containing `{ sub: userId, type: 'refresh' }`. Lifespan is 7 days. Stored in `saathi_refresh` httpOnly cookie. Refreshed via `/api/auth/refresh` using single-use token rotation.
- **Role-Based Access Control (RBAC) Guardrails:**
  - `public`: Unauthenticated.
  - `any_user`: Valid user session required.
  - `owner_only`: Valid user session where `req.user.id === resource.userId`. Prevents horizontal privilege escalation.
  - `contact_token`: Valid signed token (`inv_*` or `ctk_*`).
  - `responder`: Valid session with `role === 'responder'` and `on_duty === true`.
  - `admin`: Valid session with `role === 'admin'`.

### 2.3 Contact Magic Link Cryptography
When an emergency is triggered, contacts receive an expiring link formatted as `/c/:token`.
- The token payload contains `{ incidentId, contactId, nonce }`.
- Encrypted and signed via HMAC-SHA256 using `HMAC_SECRET_KEY`.
- Stored hashed in `contact_incident_tokens` with an expiration timestamp (`expires_at`).
- Access to `/api/c/:token` is rate-limited (30 requests/minute) and logs every inspection to `incident_access_audit`.

### 2.4 HTTP Security Headers & Middleware Pipeline
1. **Helmet & Strict CSP:** Configured with directives allowing Leaflet OpenStreetMap tiles (`*.tile.openstreetmap.org`) while disallowing unsafe script execution.
2. **CORS:** Bound to the application's origin; rejects external credentialed requests.
3. **Rate Limiting:** In-memory sliding window rate limiters:
   - Auth endpoints (`/api/auth/*`): 10 requests / minute / IP.
   - Emergency SOS trigger (`/api/incidents`): 20 requests / minute / IP.
   - Contact tokens (`/api/c/*`): 30 requests / minute.
4. **Input Sanitization:** Every route body, query, and parameter set is parsed through strict Zod schemas before reaching business logic controllers.

---

## 3. Incident State Machine & Real-Time Protocol

### 3.1 State Machine Lifecycle
The alert lifecycle is governed by the state machine defined in `apps/api/src/services/incidentStateMachine.ts`:

```
[TRIGGERED]
    │
    ├── (Cancel window expires or Duress PIN entered) ────────► [ACTIVE]
    ├── (Valid Cancel PIN entered within window) ─────────────► [CANCELLED]*
    └── (Timeout without activation) ─────────────────────────► [EXPIRED]*

[ACTIVE]
    │
    ├── (SMS/Gateway notifications dispatched) ───────────────► [NOTIFIED]
    ├── (Contact opens magic link / Responder views) ─────────► [ACKNOWLEDGED]
    ├── (Responder marks en route) ───────────────────────────► [RESPONDING]
    ├── (User or Responder marks safe) ───────────────────────► [RESOLVED]*
    ├── (Responder flags false alarm with note) ──────────────► [FALSE_ALARM]*
    └── (Lifespan timeout reached) ───────────────────────────► [EXPIRED]*

[NOTIFIED]
    ├── (Contact/Responder acknowledges) ─────────────────────► [ACKNOWLEDGED]
    ├── (Responder en route) ─────────────────────────────────► [RESPONDING]
    ├── (Mark safe) ──────────────────────────────────────────► [RESOLVED]*
    └── (False alarm / Expiry) ───────────────────────────────► [FALSE_ALARM]* / [EXPIRED]*

[ACKNOWLEDGED] ──► [RESPONDING] ──► [RESOLVED]*
```
*\* Terminal states. Upon reaching any terminal state, the retention purge worker schedules deletion of location samples.*

### 3.2 WebSocket Hub Protocol
Mounted at `/ws`, the hub manages real-time bi-directional synchronization:
- **Authentication:** Clients authenticate upon connection using `?token=<jwt>` or `?ctk=<contact_token>`.
- **Channel Subscriptions:**
  - `user:<userId>`: Pushes alert status changes, responder acknowledgements, and journey check-ins.
  - `incident:<incidentId>`: Pushes live GPS location updates (`lat`, `lng`, `accuracyM`, `capturedAt`).
  - `zone:<organizationZone>`: Pushes real-time alerts to on-duty responders.
- **Heartbeat & Reconnection:** 30-second ping/pong keepalive. Front-end client implements exponential backoff reconnection.

---

## 4. Offline Synchronization & Telemetry Pipeline

### 4.1 Dexie IndexedDB Architecture
The web client maintains an offline database `saathi_offline_db` with stores:
- `pending_incidents`: `{ id, clientRequestId, payload, createdAt, attempts }`
- `pending_locations`: `{ id, incidentId, lat, lng, accuracyM, capturedAt }`
- `cached_resources`: Offline cache of 24x7 emergency helpline directory.
- `cached_contacts`: Offline cache of user's trusted contacts for emergency dialing.

### 4.2 Idempotent Sync Protocol
1. **Trigger Action:** When user taps SOS offline, an incident record is created in `pending_incidents` with a unique UUID `clientRequestId`.
2. **Network Event Detection:** Client listens to `window.online` and `window.focus`.
3. **Queue Flush (`flushOfflineAlertQueue`):** 
   - Sends `POST /api/incidents` with header `X-Client-Request-Id: <uuid>`.
   - The backend checks `idx_incidents_user_client_request`. If an incident with that `clientRequestId` already exists, it returns the existing record (`200 OK`) instead of duplicating.
   - On success, the item is purged from IndexedDB.

---

## 5. Pluggable Provider Interfaces

To ensure zero external cloud dependency during testing while allowing production drop-in adapters, the backend abstracts all outbound communication behind TypeScript interfaces:

### 5.1 Provider Interfaces (`apps/api/src/providers/`)
```typescript
export interface OtpProvider {
  sendOtp(phoneE164: string, code: string): Promise<{ success: boolean; messageId?: string }>;
}

export interface SmsProvider {
  sendSms(toPhoneE164: string, message: string, metadata?: Record<string, unknown>): Promise<{ success: boolean; messageId?: string }>;
  getOutbox(): Promise<Array<{ toPhoneE164: string; body: string; createdAt: string }>>;
}

export interface EmergencyServiceGateway {
  dispatchEmergency(incidentId: string, details: EmergencyDispatchPayload): Promise<{ success: boolean; referenceId: string }>;
}
```

### 5.2 Implementations
- **Development & Test:**
  - `MockOtpProvider`: Logs verification codes directly to terminal output `[DEV OTP]` and stores in memory.
  - `MockSmsProvider`: Appends sent messages to the `sent_messages` SQLite table and provides `/api/dev/outbox` inspection.
  - `MockEmergencyServiceGateway`: Simulates successful handoff to CDAC 112 ERSS gateway with mock reference IDs.
- **Production Extension:** Replace mock implementations with Twilio, AWS SNS, or CDAC ERSS SOAP/REST clients without changing route controllers.

---

## 6. Background Schedulers & Workers

The server runs an in-process scheduler (`apps/api/src/services/scheduler.ts`) executing periodic maintenance tasks:
1. **Escalation Engine (Every 10 Seconds):**  
   Queries `incidents` where `status = 'ACTIVE'` and time elapsed exceeds escalation window. Dispatches notifications to secondary contacts or campus responders.
2. **Safe Journey Expiry Worker (Every 30 Seconds):**  
   Evaluates `journeys` where `status = 'active'` and `endsAt < current_time`. Automatically transitions status to `lapsed` and fires alerts to designated contacts.
3. **Data Retention Purge Worker (Every 10 Minutes):**  
   Queries `location_samples` where `expiresAt <= current_timestamp`. Permanently deletes expired coordinate rows to protect survivor location privacy.

---

## 7. Complete API Route Specification

All routes are mounted under the `/api` prefix.

### 7.1 Authentication & User Profile
| Method | Route | Access | Payload Schema | Description |
| :--- | :--- | :--- | :--- | :--- |
| `GET` | `/api/health` | `public` | None | Returns `{ status: 'ok', uptime: number, db: 'connected' }` |
| `POST` | `/api/auth/otp/request` | `public` | `{ phoneE164: string }` | Dispatches 6-digit verification code. |
| `POST` | `/api/auth/otp/verify` | `public` | `{ phoneE164: string, code: string }` | Verifies code; sets session cookies and returns user object. |
| `POST` | `/api/auth/refresh` | `public` | None (reads cookie) | Issues fresh access token using refresh cookie. |
| `POST` | `/api/auth/logout` | `public` | None | Clears `saathi_access` and `saathi_refresh` cookies. |
| `GET` | `/api/me` | `any_user` | None | Retrieves authenticated user profile, zone, and settings. |
| `PATCH` | `/api/me` | `any_user` | `{ name?: string, language?: 'en'\|'hi', organizationZone?: string }` | Updates user profile settings. |
| `GET` | `/api/me/export` | `any_user` | None | Downloads complete personal data export JSON with duress masking. |
| `DELETE`| `/api/me` | `owner_only` | `{ code: string }` | Permanently deletes user account, contacts, and historical logs. |

### 7.2 Consent Ledger
| Method | Route | Access | Payload Schema | Description |
| :--- | :--- | :--- | :--- | :--- |
| `GET` | `/api/consents` | `any_user` | None | Lists current consent status across all categories. |
| `POST` | `/api/consents` | `any_user` | `{ type: ConsentType, granted: boolean, source: string }` | Appends new grant/revocation entry to immutable ledger. |

### 7.3 Trusted Contacts & Invitations
| Method | Route | Access | Payload Schema | Description |
| :--- | :--- | :--- | :--- | :--- |
| `GET` | `/api/contacts` | `any_user` | None | Lists up to 5 contacts in the user's circle. |
| `POST` | `/api/contacts` | `any_user` | `{ name: string, phoneE164: string, permissions: ContactPermissions }` | Adds contact and triggers invitation SMS. |
| `POST` | `/api/contacts/reorder` | `owner_only` | `{ contactIds: string[] }` | Reorders escalation ladder priority. |
| `PATCH` | `/api/contacts/:id` | `owner_only` | `{ permissions?: Partial<ContactPermissions>, name?: string }` | Updates contact permissions. |
| `POST` | `/api/contacts/:id/pause` | `owner_only` | None | Temporarily pauses notifications to contact. |
| `POST` | `/api/contacts/:id/resume`| `owner_only` | None | Resumes paused contact notifications. |
| `DELETE`| `/api/contacts/:id` | `owner_only` | None | Removes contact and revokes pending tokens. |
| `GET` | `/api/invitations/:token`| `contact_token`| None | Inspects circle invitation details. |
| `POST` | `/api/invitations/:token/accept` | `contact_token` | None | Accepts emergency circle invitation. |
| `POST` | `/api/invitations/:token/decline`| `contact_token` | None | Declines emergency circle invitation. |
| `GET` | `/api/c/:token` | `contact_token`| None | Retrieves live incident data for contact tracking. |
| `POST` | `/api/c/:token/respond` | `contact_token`| `{ status: 'seen'\|'calling'\|'responding'\|'safe' }` | Records contact response action. |

### 7.4 Incidents & Safety Triggers
| Method | Route | Access | Payload Schema | Description |
| :--- | :--- | :--- | :--- | :--- |
| `POST` | `/api/incidents` | `any_user` | `{ emergencyType?: string, sourceTrigger?: string, clientRequestId?: string }` | Triggers new emergency incident (`TRIGGERED`). |
| `GET` | `/api/incidents/active` | `any_user` | None | Retrieves user's currently active emergency. |
| `GET` | `/api/incidents/:id` | `owner_only` | None | Retrieves full timeline and events for incident. |
| `POST` | `/api/incidents/:id/cancel` | `owner_only` | `{ pin: string }` | Validates Cancel vs Duress PIN; transitions state. |
| `POST` | `/api/incidents/:id/location` | `owner_only` | `{ lat: number, lng: number, accuracyM?: number }` | Logs GPS sample (requires active location consent). |
| `POST` | `/api/incidents/:id/type` | `owner_only` | `{ emergencyType: string }` | Updates emergency category (medical, harassment, etc.). |
| `POST` | `/api/incidents/:id/resolve` | `owner_only` | None | Closes incident as resolved. |
| `POST` | `/api/incidents/:id/rating` | `owner_only` | `{ score: number }` (1–5) | Submits post-incident feedback rating. |
| `PUT` | `/api/settings/cancel-window`| `any_user` | `{ seconds: number }` (5–30) | Configures cancel countdown duration. |
| `PUT` | `/api/settings/cancel-pin` | `any_user` | `{ pin: string }` (4 digits) | Updates salted Cancel PIN hash. |
| `PUT` | `/api/settings/duress-pin` | `any_user` | `{ pin: string }` (4 digits) | Updates salted Duress PIN hash. |

### 7.5 Safe Journeys
| Method | Route | Access | Payload Schema | Description |
| :--- | :--- | :--- | :--- | :--- |
| `GET` | `/api/journeys/active` | `any_user` | None | Checks current active journey status. |
| `POST` | `/api/journeys` | `any_user` | `{ contactId?: string, durationMinutes: number, note?: string }` | Starts a scheduled journey with timer. |
| `POST` | `/api/journeys/:id/extend` | `owner_only` | `{ extensionMinutes: number }` | Extends journey arrival deadline. |
| `POST` | `/api/journeys/:id/complete`| `owner_only` | None | Marks journey successfully completed. |
| `POST` | `/api/journeys/:id/cancel` | `owner_only` | None | Cancels active journey. |

### 7.6 Community Safety Reports & Layers
| Method | Route | Access | Payload Schema | Description |
| :--- | :--- | :--- | :--- | :--- |
| `POST` | `/api/reports` | `any_user` | `{ category: ReportCategory, lat: number, lng: number, note?: string }` | Submits anonymized hazard report. |
| `GET` | `/api/safety-layer` | `any_user` | None | Retrieves geo-binned safety clusters ($k \ge 5$). |
| `GET` | `/api/reports` | `admin` | None | Lists reports for moderation review. |
| `DELETE`| `/api/admin/reports/:id`| `admin` | None | Deletes abusive report. |

### 7.7 Helplines & Safety Pulse
| Method | Route | Access | Payload Schema | Description |
| :--- | :--- | :--- | :--- | :--- |
| `GET` | `/api/resources` | `public` | None | Lists verified emergency helplines. |
| `POST` | `/api/admin/resources` | `admin` | `{ name: string, category: string, phone: string, description: string, availableHours: string }` | Adds new helpline resource. |
| `PUT` | `/api/admin/resources/:id` | `admin` | Partial resource fields | Updates helpline details. |
| `DELETE`| `/api/admin/resources/:id` | `admin` | None | Removes resource entry. |
| `GET` | `/api/pulse/status` | `any_user` | None | Checks if weekly safety pulse has been completed. |
| `POST` | `/api/pulse` | `any_user` | `{ safetyScore: number, avoidedGoingSomewhere: boolean }` | Submits anonymous weekly pulse. |

### 7.8 Responder Operations & Administrative Governance
| Method | Route | Access | Payload Schema | Description |
| :--- | :--- | :--- | :--- | :--- |
| `GET` | `/api/responder/incidents` | `responder` | None | Lists active emergencies in responder's zone. |
| `GET` | `/api/responder/incidents/:id` | `responder` | None | Views incident telemetry; logs access to audit. |
| `POST` | `/api/responder/incidents/:id/acknowledge` | `responder` | None | Acknowledges alert, unmasks phone, notifies victim. |
| `POST` | `/api/responder/incidents/:id/assign` | `responder` | `{ responderId?: string }` | Self-assigns or assigns responder to incident. |
| `POST` | `/api/responder/incidents/:id/note` | `responder` | `{ note: string }` | Adds operational triage note. |
| `POST` | `/api/responder/incidents/:id/responding` | `responder` | None | Marks responder actively en route. |
| `POST` | `/api/responder/incidents/:id/resolve` | `responder` | None | Closes incident as resolved. |
| `POST` | `/api/responder/incidents/:id/false-alarm` | `responder` | `{ note: string }` (mandatory) | Closes incident as false alarm. |
| `GET` | `/api/admin/audit-log` | `admin` | None | Inspects tamper-evident data access audit trail. |
| `GET` | `/api/admin/responders` | `admin` | None | Lists registered responders and duty statuses. |
| `PATCH` | `/api/admin/responders/:id` | `admin` | `{ onDuty?: boolean, active?: boolean, organizationZone?: string }` | Updates responder operational parameters. |
| `GET` | `/api/admin/metrics` | `admin` | None | Returns aggregated safety metrics ($k \ge 5$). |
| `GET` | `/api/admin/metrics.csv` | `admin` | None | Exports aggregated metrics in CSV format. |

---

## 8. Development & Testing Framework

### 8.1 Testing Philosophy & Matrix
- **Unit & Integration Suite (Vitest):**  
  Automates testing of all 19 database tables, service layers, incident state machine transitions, and RBAC security guardrails.
  - Run command: `npm run test:api`
- **Frontend & Accessibility Suite (Vitest + React Testing Library):**  
  Tests component rendering, touch targets ($\ge 44\text{px} / \ge 56\text{px}$), screen-reader attributes (`aria-labels`), offline queuing, and i18n switching.
  - Run command: `npm run test:web`
- **End-to-End Browser Automation (Playwright):**  
  Runs real browser automated flows covering SOS triggering, cancel window countdowns, duress PIN deception, contact magic links, and responder acknowledgements.
  - Run command: `npm run e2e`
