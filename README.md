# SHAKTI — Safety Assistance & Alert Technology for Help & Intervention
> Fast, discreet emergency support and consent-first safety assistance for women, built for one-handed use, intermittent connectivity, and calm intervention under stress.

SHAKTI addresses the acute challenges women face when confronting distress or harassment: panic under pressure, erratic mobile connectivity, fear of coercive surveillance, and delays in emergency response. By providing a single-action, mobile-first Progressive Web Application (PWA) with offline queuing, multi-tier escalation (trusted contacts, on-duty campus/community responders, and direct 112/181 helplines), and strict consent and duress protections, SHAKTI delivers realistic, reliable intervention without ever compromising personal privacy.

> **Important Disclaimer:** SHAKTI **complements** India's **112 (ERSS)** and **181 Women Helpline**. It never replaces official emergency services and never claims to guarantee physical safety or response times.

---

## Quick Start

### 1. Install Dependencies
```bash
npm install
```

### 2. Development Mode
Starts the combined Express API, WebSocket hub, and Vite frontend server on port 3000:
```bash
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) in your browser.

### 3. Production Mode
Builds the client bundle and starts the production server:
```bash
npm run start:prod
```
> **Security Guardrail:** In production mode (`NODE_ENV=production`), the server strictly requires a strong non-default `JWT_SECRET_KEY` and `HMAC_SECRET_KEY` (minimum 32 characters) and refuses mock OTP providers and demo mode.

---

## Seeded Accounts & How to Log In

During development (`ENVIRONMENT="development"` or `DEMO_MODE=true`), the database automatically seeds three baseline roles:

| Role | Name | Phone (E.164) | Description |
| :--- | :--- | :--- | :--- |
| **User (Survivor)** | Aarohi Sharma | `+919000000001` | Core safety user with active consents and contacts |
| **Responder** | Inspector Kavita Rao | `+919000000002` | On-duty responder with access to `/responder` |
| **Admin** | Meera Nair | `+919000000003` | Safety administrator with access to `/admin` |

### How to Log In (Mock OTP):
1. Navigate to [http://localhost:3000/login](http://localhost:3000/login).
2. Enter one of the seeded phone numbers (e.g., `+919000000001`) and tap **Send Code**.
3. In development mode, the mock OTP is printed directly to the server terminal console:
   ```text
   [DEV OTP] Generated verification code for +919000000001: 123456
   ```
4. Enter the 6-digit code on the verification screen to authenticate.

---

## Running Test Suites

- **All Automated Tests (Vitest Unit, API & Component):**
  ```bash
  npm test
  ```
- **Backend API & Security Tests (Vitest + Supertest + SQLite):**
  ```bash
  npm run test:api
  ```
- **Frontend Web & Accessibility Tests (Vitest + React Testing Library):**
  ```bash
  npm run test:web
  ```
- **Real-Browser End-to-End Suite (Playwright + Axe-Core):**
  ```bash
  npm run e2e
  ```

---

## Demo Mode

SHAKTI includes an interactive end-to-end presentation walkthrough demonstrating the full SOS lifecycle, duress PIN masking, offline SMS fallback, contact alert magic links, and responder dispatch:

- See the complete scripted walkthrough in [`docs/DEMO_SCRIPT.md`](docs/DEMO_SCRIPT.md).
- To run a public demonstration:
  ```bash
  DEMO_MODE=true npm run dev
  ```
  *(Or set `DEMO_MODE="true"` in your `.env` file with `NODE_ENV` left as `development`).*
- **Hosted-Demo Login Assistance**: When `DEMO_MODE=true`, the login screen provides a small "Demo code: 123456" helper hint upon requesting OTP for seeded demo accounts (demo user `+919000000001`, demo responder `+919000000002`, and trusted contacts `+919000000011` / `+919000000012`). In a public demo, visitors can freely explore user, contact, and responder roles without needing server console access. To protect privileged administrative operations, the seeded admin account (`+919000000003`) suppresses the OTP hint unless `DEMO_ADMIN_HINT=true` is set explicitly (recommended only for private/controlled presentations). In all other cases—including any non-demo account or whenever `DEMO_MODE` is disabled or in production—the OTP hint field is strictly absent.
- **Important Note:** A public demo must run with `DEMO_MODE=true` and `NODE_ENV` **not set to production**. Production mode (`NODE_ENV=production`) explicitly blocks demo mode, resets, simulation endpoints, and mock providers by design.

---

## Environment Variables

Configure application settings by copying `.env.example` to `.env`:

```bash
cp .env.example .env
```

| Variable | Default (Dev) | Description |
| :--- | :--- | :--- |
| `ENVIRONMENT` | `development` | Runtime environment (`development`, `test`, `production`) |
| `PORT` | `3000` | HTTP & WebSocket server port |
| `DATABASE_URL` | `file:./saathi.db` | SQLite database file path or URL |
| `JWT_SECRET_KEY` | `saathi-dev-secret-key-change-in-production` | Secret for signing access tokens (min 32 chars in prod) |
| `JWT_ALGORITHM` | `HS256` | JWT signing algorithm |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | `15` | Short-lived access token lifespan |
| `REFRESH_TOKEN_EXPIRE_DAYS` | `7` | Rotation-enabled refresh token lifespan |
| `OTP_EXPIRE_SECONDS` | `300` | OTP code expiry window (5 minutes) |
| `OTP_MAX_ATTEMPTS` | `3` | Maximum failed OTP attempts before invalidation |
| `AUTH_RATE_LIMIT_PER_MINUTE`| `10` | Rate limit for auth endpoints |
| `DEMO_MODE` | `false` | Enables `/api/demo/*` simulation and reset endpoints |
| `ENABLE_AI_ASSIST` | `false` | Strictly `false` by default; core SOS never depends on AI |

---

## Project Structure

```text
shakti/
├── apps/
│   ├── api/                     # Node.js + Express + WebSocket backend
│   │   ├── src/
│   │   │   ├── core/            # Config, DB initialization, middleware, security, seed
│   │   │   ├── db/              # Drizzle schema & migrations (SQLite)
│   │   │   ├── providers/       # Mock/Pluggable OTP, SMS, and 112 gateways
│   │   │   ├── routes/          # Express route controllers with strict Zod validation
│   │   │   ├── schemas/         # Zod input validation schemas
│   │   │   ├── services/        # Incidents, contacts, state machine, retention, privacy
│   │   │   └── tests/           # Vitest integration & security test suites
│   │   └── server.ts            # API server bootstrapping and static file serving
│   └── web/                     # React 19 + TypeScript + Vite + Tailwind CSS frontend
│       └── src/
│           ├── components/      # Accessible UI components (>= 56px primary targets)
│           ├── features/        # Feature domain logic (SOS, offline queue, contacts)
│           ├── i18n/            # English and Hindi translation dictionaries
│           ├── lib/             # API client with token refresh & IndexedDB offline store
│           ├── pages/           # Mobile-first screen views
│           ├── store/           # Zustand state management stores
│           └── tests/           # React Testing Library unit & component tests
├── docs/                        # Architecture, API specifications, and privacy docs
│   ├── API.md                   # Full endpoint specification by access class
│   ├── ARCHITECTURE.md          # Mermaid architecture and incident state machine
│   ├── DEMO_SCRIPT.md           # Presentation and demo script
│   ├── E2E.md                   # Playwright end-to-end scenario documentation
│   ├── PRIVACY_AND_SECURITY.md  # Consent, duress, audit, and retention architecture
│   └── phase-*-report.md        # Detailed phase completion reports
├── e2e/                         # Playwright real-browser end-to-end tests
├── scripts/                     # Operational verification scripts
├── LIMITATIONS.md               # Honest engineering limits and prototype boundaries
├── playwright.config.ts         # Playwright test configuration
└── vite.config.ts               # Vite configuration with PWA service worker
```
