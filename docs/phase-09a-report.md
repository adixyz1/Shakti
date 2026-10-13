# Phase 9A Report: Security Hardening

## Summary of What Was Done

1. **Production Safeguards (`apps/api/src/core/config.ts`, `apps/api/server.ts`, `apps/api/src/core/seed.ts`, `apps/api/src/core/security.ts`, `apps/api/src/services/authService.ts`)**:
   - Added `assertValidProductionConfiguration(env)` invoked in `startServer(env)` when `NODE_ENV=production` (or `ENVIRONMENT=production`). The server refuses to start with a clear error if:
     - `DEMO_MODE=true` is set in production (no override);
     - `JWT_SECRET` or `HMAC_SECRET` are missing, shorter than 16 characters, or set to the default development secret (`saathi-dev-secret-key-change-in-production`);
     - `OTP_PROVIDER` is `mock` (default) without an explicit `ALLOW_MOCK_PROVIDERS=true`.
   - Updated `seedDatabase(db, env)` so demo/admin/responder accounts (`+919999990001`, `+919999990002`, `+919999990003`) are only seeded when `DEMO_MODE=true` or `NODE_ENV !== 'production'`. Verified public emergency resources are still seeded idempotently.
   - Confirmed `GET /api/dev/outbox` returns `404` when `NODE_ENV=production` and `dev_mock_hint` is omitted in production OTP responses.
   - Updated `setAuthCookies` to set `HttpOnly`, `SameSite: 'lax'`, and `Secure: true` dynamically when running in production.

2. **Authorization Sweep (`apps/api/src/tests/phase9a_security.test.ts`, `apps/api/src/routes/incidents.ts`, `apps/api/src/services/incidentService.ts`)**:
   - Constructed `REGISTERED_ROUTE_ACCESS_TABLE` covering all 66 canonical Express routes across 6 access classes (`public`, `any_user`, `owner_only`, `contact_token`, `responder`, `admin`).
   - Built an automated route enumeration test that extracts every route registered on the Express app and fails if any route is missing from `REGISTERED_ROUTE_ACCESS_TABLE`, then exercises each route as unauthenticated, non-owner user, owner user, responder, and admin.
   - **Fixed authorization gap on `GET /api/incidents/:id` and `POST /api/incidents/:id/resolve`**: previously, user-facing incident detail and resolution endpoints allowed any `responder` or `admin` role to read or resolve a user's incident via the user endpoint (bypassing the responder dashboard's location-consent filter and audit logging). Restricted both endpoints strictly to the incident owner (`req.user.id === inc.userId`), requiring responders to use `/api/responder/incidents/:id*`.

3. **CSRF & Origin Protection (`apps/api/src/core/middleware.ts`, `apps/api/server.ts`)**:
   - Added `csrfProtectionMiddleware` enforcing `Origin` / `Referer` host verification on all state-changing requests (`POST`, `PUT`, `PATCH`, `DELETE`) authenticated via session cookies (`saathi_access` / `saathi_refresh`). Cross-origin state-changing requests with cookie auth are rejected with HTTP `403`.

4. **Security Headers & Rate Limits (`apps/api/src/core/middleware.ts`, `apps/api/src/routes/contacts.ts`)**:
   - Added `Content-Security-Policy` tailored for the Vite build and OpenStreetMap/Leaflet tiles (`default-src 'self'`, `img-src 'self' data: blob: https://*.tile.openstreetmap.org https://tile.openstreetmap.org`, `frame-ancestors 'none'`, `base-uri 'self'`, `form-action 'self'`), alongside `X-Content-Type-Options: nosniff`, `X-Frame-Options: SAMEORIGIN`, and `Referrer-Policy: strict-origin-when-cross-origin`.
   - Added `contactTokenRateLimitMiddleware` (30 requests/minute per IP+token) on all public contact magic-link and invitation token endpoints (`/invitations/:token*`, `/c/:token*`), complementing existing rate limits on OTP request/verify, PIN attempts/settings, and community report submission.

5. **Input Validation Sweep (`apps/api/src/routes/*.ts`, `apps/api/server.ts`)**:
   - Configured `express.json({ limit: '64kb' })` to reject oversize JSON bodies with HTTP `413`.
   - Added strict Zod validation schemas for body, query, and URL params across all routes that previously lacked Zod validation:
     - `DELETE /api/me` (`deleteAccountSchema`)
     - `PATCH /api/contacts/:id`, `POST /api/contacts/:id/pause`, `POST /api/contacts/:id/resume`, `DELETE /api/contacts/:id`, `POST /api/contacts/:id/remove` (`contactIdParamSchema`)
     - `GET /api/invitations/:token`, `POST /api/invitations/:token/accept`, `POST /api/invitations/:token/decline`, `GET /api/c/:token`, `POST /api/c/:token/respond` (`tokenParamSchema`)
     - `GET /api/incidents/:id`, `POST /api/incidents/:id/cancel`, `POST /api/incidents/:id/location`, `POST /api/incidents/:id/type`, `POST /api/incidents/:id/resolve`, `POST /api/incidents/:id/rating` (`incidentIdParamSchema`)
     - `GET /api/journeys/:id`, `POST /api/journeys/:id/extend`, `POST /api/journeys/:id/complete`, `POST /api/journeys/:id/cancel` (`journeyIdParamSchema`)
     - `GET /api/admin/metrics`, `GET /api/admin/metrics.csv` (`metricsQuerySchema`)
     - `GET /api/safety-layer`, `DELETE /api/admin/reports/:id` (`safetyLayerQuerySchema`, `reportIdParamSchema`)
     - `GET /api/resources`, `PUT /api/admin/resources/:id`, `DELETE /api/admin/resources/:id` (`resourcesQuerySchema`, `resourceIdParamSchema`)
     - `GET /api/responder/incidents/:id`, `POST /api/responder/incidents/:id/*`, `GET /api/admin/audit-log`, `PATCH /api/admin/responders/:id` (`responderIdParamSchema`, `auditLogQuerySchema`, `updateResponderSchema`)

6. **Log & PII Scan (`apps/api/src/core/security.ts`, `apps/api/src/providers/otp.ts`, `apps/api/src/services/reportService.ts`)**:
   - Removed plaintext OTP console logging from `MockOtpProvider.sendOtp`.
   - Removed grid coordinate logging from `reportService.ts`.
   - Enhanced `redactPII` in `apps/api/src/core/security.ts` to redact JSON/querystring PIN fields (`pin`, `cancel_pin`, `duress_pin`) and latitude/longitude coordinates (`lat`, `lng`) in addition to E.164 phone numbers, JWTs, invitation tokens (`inv_*`), and contact alert tokens (`ctk_*`).

---

## Security Findings Table

| # | Finding | Severity | Status | Reason / Resolution |
|---|---------|----------|--------|---------------------|
| 1 | Server allowed starting in `NODE_ENV=production` with default `JWT_SECRET`/`HMAC_SECRET` and active `MockOtpProvider` | High | **Fixed** | Added `assertValidProductionConfiguration()` in `config.ts` and `startServer()` to refuse startup in production unless strong non-default `JWT_SECRET` and `HMAC_SECRET` are provided and `OTP_PROVIDER !== 'mock'` (or `ALLOW_MOCK_PROVIDERS=true` is explicitly set). |
| 2 | `seedDatabase()` created predictable demo/admin/responder accounts unconditionally on startup | High | **Fixed** | Updated `seedDatabase(db, env)` so demo/admin/responder accounts are only created when `DEMO_MODE=true` or `NODE_ENV !== 'production'`. |
| 3 | `GET /api/incidents/:id` and `POST /api/incidents/:id/resolve` allowed any `responder` or `admin` to access/resolve a user's incident via the user endpoint | High | **Fixed** | Restricted `/api/incidents/:id` and `resolveIncidentForUser` strictly to the incident owner (`owner_only`). Responders must use `/api/responder/incidents/:id*`, which enforces location-consent filtering, phone masking prior to acknowledgement, and responder access audit logging. |
| 4 | State-changing requests using cookie authentication lacked Origin/Referer CSRF verification beyond `SameSite=Lax` | Medium | **Fixed** | Added `csrfProtectionMiddleware` in `middleware.ts` verifying that any `POST`/`PUT`/`PATCH`/`DELETE` request carrying auth cookies matches the server `Host` via `Origin` or `Referer` (rejecting mismatches with HTTP `403`). |
| 5 | Missing `Content-Security-Policy` header and missing rate limit on public contact/invitation token endpoints | Medium | **Fixed** | Added CSP header (`default-src 'self'`, Leaflet tile whitelist, `frame-ancestors 'none'`) in `securityHeadersMiddleware` and added `contactTokenRateLimitMiddleware` on `/invitations/:token*` and `/c/:token*`. |
| 6 | Unbounded `express.json()` payload size and unvalidated query/param inputs on several routes (`DELETE /me`, `/admin/metrics`, `/safety-layer`, `/admin/responders/:id`, `:id` params) | Medium | **Fixed** | Configured `express.json({ limit: '64kb' })` and added Zod validation schemas across all route bodies, queries, and params. |
| 7 | `MockOtpProvider` logged plaintext OTP codes to stdout in non-production environments and `reportService` logged grid coordinates | Medium | **Fixed** | Removed plaintext OTP logging from `MockOtpProvider`, removed coordinate logging from `reportService`, and expanded `redactPII()` to scrub PINs and `lat`/`lng` values. |
| 8 | Dev-only `esbuild <=0.24.2` moderate advisory (`GHSA-67mh-4wv8-2f99`) via `drizzle-kit` in `devDependencies` (`npm audit --omit=dev` has 0 vulnerabilities) | Low (Dev Only) | **Accepted** | `npm audit --omit=dev` reports `found 0 vulnerabilities` in production dependencies. The 4 moderate advisories exist only in `drizzle-kit`'s transitive `@esbuild-kit/*` dev dependency, and `npm audit fix --force` would downgrade `drizzle-kit` to breaking version `0.18.1`. `drizzle-kit` is never loaded or exposed at runtime. |

---

## Dependency Audit Summary

- **Production dependencies (`npm audit --omit=dev`)**:
  ```text
  found 0 vulnerabilities
  ```
- **All dependencies including devDependencies (`npm audit`)**:
  - 4 moderate severity vulnerabilities in `esbuild <=0.24.2` (`GHSA-67mh-4wv8-2f99`) via `drizzle-kit -> @esbuild-kit/esm-loader -> @esbuild-kit/core-utils -> esbuild` (devDependency only; accepted because `drizzle-kit` is an offline CLI migration tool not used at runtime and `--force` downgrades `drizzle-kit` to breaking `0.18.1`).

---

## What Was Not Done

- No new product features or UI changes were added.
- The product rename is deferred to Phase 9B as specified.

---

## What the Next Phase Can Rely On

- Full production startup safeguards (`assertValidProductionConfiguration`), strict route-level RBAC and ownership enforcement verified by `REGISTERED_ROUTE_ACCESS_TABLE`, CSRF Origin/Host protection for cookie-authenticated mutations, CSP + security headers, rate limits on all sensitive/token endpoints, 64KB body size limit + comprehensive Zod validation, and zero PII leakage in logs.
