# Phase 01 Report: Foundation (Scaffold, Auth, Design System — Node-Only Stack)

## 1. SQLite Driver & Runtime Verification
- **Node.js Version**: `v22.23.2`
- **Driver Check Results**:
  - `better-sqlite3`: Failed (`node-gyp: command not found` during native C++ compilation).
  - `node:sqlite`: Available in Node `v22.23.2` (with Node experimental warning).
  - `@libsql/client` (`libsql` + `drizzle-orm/libsql` + `drizzle-orm/libsql/migrator`): Installed cleanly with prebuilt binary (`@libsql/client@^0.17.2`, `drizzle-orm@^0.45.2`, `drizzle-kit@^0.31.10`) and verified with versioned SQL migrations.
- **Selected Driver**: `@libsql/client` with `drizzle-orm/libsql` and `drizzle-orm/libsql/migrator`.

---

## 2. What Was Built
Phase 1 establishes the single-process **SAATHI** Node.js/TypeScript foundation, real SQLite database with Drizzle migrations, authentication & RBAC backend, bilingual (`en` + `hi`) web foundation, and calm, high-contrast accessible design system:

1. **Single-Process Architecture (`apps/api/server.ts`)**:
   - **Express (TypeScript)** is the only backend, running in a single process on Port `3000`.
   - Serves all REST API endpoints (`/api/*`), attaches the WebSocket server (`ws` on `/ws`), and mounts Vite in middleware mode during development (or static `dist/` in production).
   - Zero Python, FastAPI, Alembic, `.venv`, or JSON-file (`saathi.local.json`) remnants exist in the repository.
2. **Real SQLite Database & Drizzle Migrations (`apps/api/src/db/`)**:
   - Schema (`apps/api/src/db/schema.ts`):
     - `users`: `id` (PK), `phone_e164` (unique index), `name`, `role` (`user | responder | admin`), `language` (`en | hi`), `created_at`.
     - `otp_codes`: `id` (PK), `phone_e164` (indexed), `code_hash` (HMAC-SHA256), `expires_at` (epoch ms), `attempts`, `created_at`.
   - Versioned SQL migration generated via `drizzle-kit generate` (`apps/api/src/db/migrations/0000_charming_kat_farrell.sql`) and automatically applied via `migrate()` in `initDatabase()`.
3. **Authentication, Security & `MockOtpProvider`**:
   - Endpoints (`apps/api/src/routes/auth.ts`): `GET /api/health`, `POST /api/auth/otp/request`, `POST /api/auth/otp/verify`, `POST /api/auth/refresh`, `POST /api/auth/logout`, `GET /api/me`, `PATCH /api/me`, `GET /api/rbac/admin-check`, `GET /api/rbac/responder-check`.
   - `OtpProvider` interface + `MockOtpProvider` (`apps/api/src/providers/otp.ts`) clearly labeled in code and UI.
   - OTP policy: 300s expiry (`OTP_EXPIRE_SECONDS=300`) and 3-attempt lockout (`OTP_MAX_ATTEMPTS=3`, returning `429 Too Many Requests` on the 3rd failed attempt).
   - JWT access token (15m) and refresh token (7d) stored in `httpOnly` cookies (`saathi_access_token`, `saathi_refresh_token`).
   - Structured JSON logger with `redactPII` (`apps/api/src/core/security.ts`) redacting E.164 phone numbers (`[REDACTED_PHONE]`) and JWT tokens (`[REDACTED_TOKEN]`).
   - Security headers (`X-Content-Type-Options: nosniff`, `X-Frame-Options: SAMEORIGIN`, `Referrer-Policy`, `Permissions-Policy`) and sliding-window auth rate limiting.
4. **RBAC & Seeded Accounts (`apps/api/src/core/seed.ts`)**:
   - Reusable `requireAuth` and `requireRole(...)` middlewares (`apps/api/src/core/middleware.ts`).
   - Seeded accounts created automatically on startup:
     - Demo User: `+919000000001` (`Aarohi Sharma`, role: `user`)
     - Campus Responder: `+919000000002` (`Inspector Kavita Rao`, role: `responder`)
     - Admin: `+919000000003` (`Meera Nair`, role: `admin`)
5. **Web Scaffold, i18n & Touch Targets (`apps/web/`)**:
   - React + TypeScript + Vite + Tailwind CSS, React Router (`/` Welcome, `/login` Login, `/home` Protected Route), TanStack Query, and Zustand (`authStore.ts`).
   - Cookie-authenticated `apiRequest` client (`apps/web/src/lib/api.ts`) with automatic silent token refresh on `401` and retry.
   - Bilingual `i18next` (`en.json` and `hi.json`) with `LanguageToggle` persisting to `localStorage` and `PATCH /api/me`.
   - Strict touch targets: `min-h-[56px]` (`BigButton`) for primary/high-stress actions and `>= 44px` (`min-h-[44px]`) minimum across all buttons, language toggles, theme switchers, modal/toast dismiss controls, and navigation links.

---

## 3. Files Created / Changed
- `PROJECT_BRIEF.md` (replaced with updated Node-only project brief)
- `package.json`, `.env.example`, `docker-compose.yml`, `README.md`, `server.ts`
- `apps/api/drizzle.config.ts`
- `apps/api/server.ts`
- `apps/api/src/core/config.ts`
- `apps/api/src/core/db.ts`
- `apps/api/src/core/security.ts`
- `apps/api/src/core/middleware.ts`
- `apps/api/src/core/seed.ts`
- `apps/api/src/db/schema.ts`
- `apps/api/src/db/migrations/0000_charming_kat_farrell.sql`
- `apps/api/src/db/migrations/meta/_journal.json`, `apps/api/src/db/migrations/meta/0000_snapshot.json`
- `apps/api/src/providers/otp.ts`
- `apps/api/src/schemas/auth.ts`
- `apps/api/src/services/authService.ts`
- `apps/api/src/routes/auth.ts`
- `apps/api/src/tests/auth.test.ts`
- `apps/web/src/components/ui/index.tsx`
- `apps/web/src/components/PageLayout.tsx`
- `apps/web/src/components/LanguageToggle.tsx`
- Deleted: all legacy Python/FastAPI/Alembic files in `apps/api/` and `saathi.local.json`.

---

## 4. Commands to Run
- **Start Single-Process Dev Server (Port 3000):**
  ```bash
  npm run dev
  ```
- **Generate Drizzle SQLite Migrations:**
  ```bash
  npm run db:generate
  ```
- **Run All Automated Tests (API + Web):**
  ```bash
  npm test
  ```

---

## 5. Real `npm run dev` Startup Log
```text
> saathi@0.1.0 dev
> tsx apps/api/server.ts
◇ injected env (0) from .env // tip: ◈ secrets for agents [www.dotenvx.com]
{"level":"INFO","timestamp":"2026-10-04T21:22:27.052Z","message":"Seeded Phase 1 baseline accounts (user, responder, admin)"}
{"level":"INFO","timestamp":"2026-10-04T21:22:28.098Z","message":"[SAATHI Server] Single-process Express + WS + Vite listening on http://0.0.0.0:3000"}
```

---

## 6. Real Test Output (`npm test`)
Each API test in `apps/api/src/tests/auth.test.ts` provisions a fresh temporary SQLite database file (`/tmp/saathi-test-<uuid>.db`), runs Drizzle SQL migrations, seeds the baseline accounts, and cleans up the file after each test:

```text
> saathi@0.1.0 test
> vitest run

 RUN  v5.0.3 /app/applet

 ✓ apps/api/src/tests/auth.test.ts (7 tests) 262ms
   ✓ GET /api/health returns 200 OK and sets strict security headers
   ✓ completes OTP request -> verify -> /me -> PATCH /me against real SQLite
   ✓ rejects an expired OTP with 400 Bad Request
   ✓ enforces 3-attempt OTP lockout with 429 Too Many Requests
   ✓ enforces RBAC role guards across user, responder, and admin accounts
   ✓ rotates tokens via /api/auth/refresh and clears session on /api/auth/logout
   ✓ redacts E.164 phone numbers and JWT tokens from log strings
 ✓ apps/web/src/tests/web_foundation.test.tsx (2 tests) 234ms
   ✓ apiRequest automatically refreshes access token on 401 and retries original request
   ✓ LanguageToggle switches between English (en) and Hindi (hi) and persists choice

 Test Files  2 passed (2)
      Tests  9 passed (9)
   Start at  21:21:51
   Duration  4.46s (environment 54%, import 24%, tests 12%, transform 9%)
```

---

## 7. Assumptions
1. **Phone Number Format**: All phone numbers use strict E.164 format (e.g. `+919000000001`).
2. **Database File Location**: Local development uses `file:./saathi.db` via `@libsql/client` and Drizzle ORM; tests use isolated temporary SQLite files in `os.tmpdir()` per test run.
3. **Port Binding**: The server binds to `3000` (configurable via `SAATHI_PORT`) so it does not collide with the container supervisor's `PORT=8080` environment variable.
4. **Dev OTP Visibility**: In `development`/`test` mode only, `MockOtpProvider` logs the 6-digit OTP to the dev console and returns a clearly labeled `dev_mock_hint` so evaluators can test OTP login in the browser without terminal access.

---

## 8. Known Issues
- None in Phase 1 scope.

---

## 9. What Phase 2 Can Rely On
- Single-process Express + WebSocket (`ws`) + Vite server on port `3000` (`apps/api/server.ts`).
- Drizzle ORM + `@libsql/client` SQLite database (`apps/api/src/core/db.ts` and `apps/api/src/db/schema.ts`) with automated versioned migrations (`apps/api/src/db/migrations/`).
- Authenticated `User` model and session context (`useAuthStore` on web, `requireAuth` and `requireRole` middlewares on API).
- Bilingual i18n infrastructure (`apps/web/src/i18n/en.json` and `hi.json`).
- Accessible design system primitives (`Button` >= 44px, `BigButton` >= 56px, `Card`, `Input`, `Modal`, `ToastContainer`, `PageLayout`, `BottomNav`).
