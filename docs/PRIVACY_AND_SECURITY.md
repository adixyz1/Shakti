# SHAKTI Privacy & Security Architecture

## 1. Consent Framework

Consent in SHAKTI is strictly **consent-first, granular, and revocable at any time**:
- **Append-Only Consent Ledger**: Every consent action is stored immutably in the `consents` table with its type (`data_processing`, `location`, `emergency_sharing`), granted state (`true` / `false`), source, and timestamp. Revocation does not delete prior records; it appends a `granted: false` entry, preserving an audit trail.
- **Granular Category Separation**:
  - `data_processing`: Authorizes account creation, contact management, and basic dispatch.
  - `location`: Strictly required for any GPS coordinate capture. When revoked, the background location loop stops immediately, and server endpoints (`POST /api/incidents/:id/location`) instantly reject coordinate samples with HTTP `403`.
  - `emergency_sharing`: Controls whether SMS/magic-link notifications are sent to emergency contacts upon SOS activation.
- **No Coercive Tracking**: The application never tracks background location outside an open emergency incident. There is no passive tracking and no persistent trajectory logging.

---

## 2. Duress Masking

To protect a victim being forced by an aggressor to cancel an alarm under duress:
- **Two Separate PINs**: Users configure a **Cancel PIN** (to genuinely cancel an alert) and a **Duress PIN** (to trigger silent duress). Both are stored using salted PBKDF2 hashes (200,000 iterations).
- **Identical Visual Feedback**: Entering the Duress PIN transitions the local UI into the exact same "Alert cancelled" screen (`closed-status-screen`) as entering the genuine Cancel PIN. No warning or sound is produced.
- **Server Duress State**: The server marks the incident as `duress: 1`, bypasses cancellation, keeps the incident `ACTIVE`, and immediately alerts responders with a silent duress flag.
- **Data Export Masking**: In the personal data export (`GET /api/me/export`), a duress incident is masked to show status `CANCELLED`. If an aggressor forces the user to export their data, no record of a duress activation is exposed.
- **Account Deletion Guard**: If a user attempts to delete their account while an incident is open, `DELETE /api/me` returns an identical `409 Conflict` error and neutral message regardless of whether the incident is GENUINE or DURESS.

---

## 3. Data Retention & Purge Worker

SHAKTI enforces strict data minimisation:
- **Location Retention**: GPS samples (`location_samples`) are retained only during the active incident. Once an incident reaches a terminal state (`RESOLVED`, `CANCELLED`, `FALSE_ALARM`, `EXPIRED`), samples are tagged with `expires_at = now + 7 days`.
- **Periodic Purge Worker**: A background worker runs periodically (or via `/api/test/retention/purge` in tests) executing:
  - Purging all `location_samples` where `expires_at <= now`.
  - Purging `contact_incident_tokens` older than 7 days past expiry.
  - Purging `contact_invitations` older than 30 days past expiry.
  - Scrubbing free-text journey notes (`journeys.note = NULL`) 7 days after journey completion.
  - Deleting expired OTP codes and outbox messages older than 7 days.

---

## 4. Tamper-Evident Incident Audit Logging

- **Access Logging**: Every access to sensitive incident details or victim location via the responder dashboard is recorded in `incident_access_audit` (`audit_log`), capturing the responder's ID, incident ID, action, and timestamp.
- **Phone Number Masking**: In the responder view, victim phone numbers remain hidden (`user_phone_e164: null`) until a responder formally acknowledges the incident.
- **Strict Role Boundaries**: User endpoints (`GET /api/incidents/:id` and `POST /api/incidents/:id/resolve`) strictly enforce `owner_only` access; responders must use `/api/responder/incidents/:id*` which enforces audit logging.

---

## 5. k-Anonymity & Aggregation

To prevent individual re-identification from community reports:
- **k >= 5 Threshold**: Both the public safety layer (`/api/safety-layer`) and admin metrics (`/api/admin/metrics`) require at least 5 independent reports or data points within any geographic grid cell or metric category before aggregated results are returned. Cells with fewer than 5 reports return count 0.
- **Coarse Geo-Binning**: Community reports do not store exact GPS coordinates; they are snapped to coarse grid centroids.
- **Date Truncation**: Report timestamps are truncated to `YYYY-MM-DD`, stripping exact submission times.
- **Daily Report Cap**: To prevent location reconstruction or sybil reporting, submissions are capped per user per 24-hour window.

---

## 6. Account Deletion & Data Export

- **Data Export (`GET /api/me/export`)**: Returns a complete, portable JSON document containing the user's profile, consents, contacts, journeys, and incidents. It excludes internal hashes, tokens, responder notes, and applies duress masking.
- **Account Deletion (`DELETE /api/me`)**:
  - Requires **fresh 6-digit OTP verification ONLY** (Cancel PIN is explicitly rejected).
  - Requires explicit confirmation string `confirmation="DELETE"`.
  - Atomically deletes all user rows across 17 database tables in a single transaction.
  - Invalidates all active sessions and cookies.
  - Clears all local device caches (`IndexedDB` offline queue, contact cache, `localStorage`, `sessionStorage`, and Service Worker `CacheStorage`).

---

## 7. What is Stored on the Device

| Storage Mechanism | Stored Items | Sensitivity & Protection |
| :--- | :--- | :--- |
| **IndexedDB (`saathi_offline_db`)** | Queued outbound SOS alerts & location samples | Held temporarily when offline; flushed and cleared upon reconnection. |
| **LocalStorage** | UI language preference, active disguise theme setting | Non-sensitive preferences. |
| **SessionStorage** | Disguise PIN unlock state during calculator session | Volatile; cleared when tab/browser closes. |
| **Service Worker `CacheStorage`** | Static PWA assets (HTML, JS, CSS, Leaflet tiles) | Static application bundle for offline loading. |
| **Browser Memory (Zustand)** | Salted PBKDF2 hashes of voice code word and disguise secret | Stored as salted PBKDF2 hashes (never in plaintext). |
| **HTTP-Only Cookies** | `saathi_access`, `saathi_refresh` | `HttpOnly`, `SameSite=Lax`, secure session identifiers. |

---

## 8. Summary of Phase 9A Security Hardening

The security baseline established in Phase 9A was audited with a full static and runtime penetration suite:

| # | Security Finding | Severity | Status | Resolution |
|---|:---|:---:|:---:|:---|
| 1 | Server allowed starting in `NODE_ENV=production` with default secrets or mock OTP | High | **Fixed** | Added startup assertion `assertValidProductionConfiguration()` refusing production startup unless strong secrets and real providers are configured. |
| 2 | Predictable seed accounts created unconditionally on server start | High | **Fixed** | Seed accounts restricted strictly to `DEMO_MODE=true` or non-production environments. |
| 3 | User incident endpoints allowed access by any responder or admin role | High | **Fixed** | User endpoints restricted strictly to `owner_only`. Responders must use audited `/api/responder/*` routes. |
| 4 | State-changing cookie requests lacked Origin/Referer CSRF protection | Medium | **Fixed** | Implemented `csrfProtectionMiddleware` verifying `Origin`/`Referer` against server `Host` on all mutating cookie requests. |
| 5 | Missing Content-Security-Policy and public token rate limits | Medium | **Fixed** | Configured CSP header whitelisting Leaflet tiles and added rate limiter on `/invitations/:token*` and `/c/:token*`. |
| 6 | Unbounded JSON body size and unvalidated query/param inputs | Medium | **Fixed** | Limited payload size to 64KB and added strict Zod validation schemas across all endpoints. |
| 7 | Plaintext OTP codes and grid coordinates logged to console | Medium | **Fixed** | Removed sensitive logging and expanded `redactPII()` to scrub PINs and coordinates. |
| 8 | Transitive `drizzle-kit` dev dependency vulnerability (`esbuild`) | Low | **Accepted** | Dev-only CLI tool; zero vulnerabilities in production dependencies (`npm audit --omit=dev`). |
