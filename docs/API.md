# SHAKTI API Reference

This document enumerates every route registered in the Express backend, categorized by its access class and authorization requirements. This specification is generated directly from the authoritative route table in `apps/api/src/tests/phase9a_security.test.ts`.

All routes are mounted under the `/api` prefix unless otherwise noted.

---

## Access Classes

- **`public`**: Unauthenticated endpoints accessible without credentials.
- **`any_user`**: Requires a valid user session (JWT bearer token or `saathi_access` cookie).
- **`owner_only`**: Requires a valid user session and verifies that the authenticated user owns the target resource (or incident/contact). Responders and admins are rejected.
- **`contact_token`**: Requires a valid signed invitation token (`inv_*`) or contact magic-link token (`ctk_*`).
- **`responder`**: Requires a verified responder account (`role === 'responder'`) on duty.
- **`admin`**: Requires administrator privileges (`role === 'admin'`).

---

## 1. Authentication & User Profile (`apiRouter`)

| Method | Endpoint | Access Class | Description |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/health` | `public` | Service health status check and uptime verification. |
| `POST` | `/api/auth/otp/request` | `public` | Request a 6-digit OTP code sent to an E.164 phone number. |
| `POST` | `/api/auth/otp/verify` | `public` | Verify a 6-digit OTP code to issue access and refresh JWT tokens. |
| `POST` | `/api/auth/refresh` | `public` | Rotate refresh token and issue a fresh access token. |
| `POST` | `/api/auth/logout` | `public` | Clear session cookies and invalidate client refresh session. |
| `GET` | `/api/me` | `any_user` | Retrieve profile and configuration of the currently authenticated user. |
| `PATCH` | `/api/me` | `any_user` | Update user profile details (display name, preferred language, organization zone). |
| `GET` | `/api/me/export` | `any_user` | Download full machine-readable personal data export (with duress masking). |
| `DELETE` | `/api/me` | `owner_only` | Permanently delete account and erase all personal records (requires fresh OTP). |
| `GET` | `/api/rbac/admin-check` | `admin` | Verify administrator authorization and role privileges. |
| `GET` | `/api/rbac/responder-check` | `responder` | Verify responder authorization and on-duty status. |

---

## 2. Consents Ledger (`consentsRouter`)

| Method | Endpoint | Access Class | Description |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/consents` | `any_user` | List current consent status for data processing, location, and emergency sharing. |
| `POST` | `/api/consents` | `any_user` | Append a new consent grant or revocation entry to the audit ledger. |

---

## 3. Trusted Contacts, Invitations & Magic Links (`contactsRouter`)

| Method | Endpoint | Access Class | Description |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/contacts` | `any_user` | List trusted emergency contacts configured in the user's circle (max 5). |
| `POST` | `/api/contacts` | `any_user` | Add a new trusted contact and generate an SMS invitation token. |
| `POST` | `/api/contacts/reorder` | `owner_only` | Reorder escalation priorities among existing trusted contacts. |
| `PATCH` | `/api/contacts/:id` | `owner_only` | Update notification permissions or details for a specific contact. |
| `POST` | `/api/contacts/:id/pause` | `owner_only` | Temporarily pause SOS and check-in notifications to a contact. |
| `POST` | `/api/contacts/:id/resume` | `owner_only` | Resume paused emergency alerts for a trusted contact. |
| `DELETE` | `/api/contacts/:id` | `owner_only` | Delete a contact from the circle and revoke outstanding invitations. |
| `POST` | `/api/contacts/:id/remove` | `owner_only` | Alternative endpoint to remove a contact and revoke tokens. |
| `GET` | `/api/invitations/:token` | `contact_token` | Inspect invitation details for a contact before accepting. |
| `POST` | `/api/invitations/:token/accept` | `contact_token` | Accept invitation to become a trusted emergency contact. |
| `POST` | `/api/invitations/:token/decline` | `contact_token` | Decline invitation to join an emergency contact circle. |
| `GET` | `/api/c/:token` | `contact_token` | View active emergency alert via contact magic link (rate-limited). |
| `POST` | `/api/c/:token/respond` | `contact_token` | Record contact response (seen, acknowledged, calling, en route). |
| `GET` | `/api/dev/outbox` | `public` | Inspect mock outbound SMS messages (available in development and test only). |

---

## 4. Incidents & Emergency Actions (`incidentsRouter`)

| Method | Endpoint | Access Class | Description |
| :--- | :--- | :--- | :--- |
| `POST` | `/api/incidents` | `any_user` | Trigger a new emergency incident in `TRIGGERED` state. |
| `GET` | `/api/incidents/active` | `any_user` | Retrieve user's currently active or triggered incident. |
| `GET` | `/api/incidents/:id` | `owner_only` | Retrieve detailed status and timeline for an incident owned by the user. |
| `POST` | `/api/incidents/:id/cancel` | `owner_only` | Cancel incident during cancel window (evaluates Cancel vs Duress PIN). |
| `POST` | `/api/incidents/:id/location` | `owner_only` | Record real-time GPS coordinate sample (strictly requires active location consent). |
| `POST` | `/api/incidents/:id/type` | `owner_only` | Update emergency categorization (medical, harassment, stalking, accident). |
| `POST` | `/api/incidents/:id/resolve` | `owner_only` | Mark user's active incident as resolved. |
| `POST` | `/api/incidents/:id/rating` | `owner_only` | Submit post-incident safety and resolution rating. |
| `PUT` | `/api/settings/cancel-window` | `any_user` | Configure SOS cancel window duration (seconds). |
| `PUT` | `/api/settings/cancel-pin` | `any_user` | Set or update 4-digit Cancel PIN (stored as salted PBKDF2 hash). |
| `PUT` | `/api/settings/duress-pin` | `any_user` | Set or update 4-digit silent Duress PIN (stored as salted PBKDF2 hash). |

---

## 5. Safe Journeys (`journeysRouter`)

| Method | Endpoint | Access Class | Description |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/journeys/active` | `any_user` | Check status of user's active journey and arrival timer. |
| `POST` | `/api/journeys` | `any_user` | Create a new scheduled journey with expected arrival time. |
| `POST` | `/api/journeys/start` | `any_user` | Start journey timer and notify designated emergency contacts. |
| `GET` | `/api/journeys/:id` | `owner_only` | View status and parameters of a journey owned by the user. |
| `POST` | `/api/journeys/:id/extend` | `owner_only` | Extend expected arrival time by additional minutes. |
| `POST` | `/api/journeys/:id/complete` | `owner_only` | Safely end journey upon arrival and notify contacts. |
| `POST` | `/api/journeys/:id/cancel` | `owner_only` | Cancel an active or pending journey. |

---

## 6. Community Safety Reports & Layers (`reportsRouter`)

| Method | Endpoint | Access Class | Description |
| :--- | :--- | :--- | :--- |
| `POST` | `/api/reports` | `any_user` | Submit anonymized community safety report (daily rate-capped, k-anonymized). |
| `GET` | `/api/reports` | `admin` | List detailed community reports for administrative moderation. |
| `GET` | `/api/safety-layer` | `any_user` | Retrieve geo-binned safety heatmap (k >= 5 privacy threshold). |
| `GET` | `/api/admin/reports` | `admin` | List all reported incidents and hazards for review. |
| `DELETE` | `/api/admin/reports/:id` | `admin` | Delete an abusive or inaccurate community hazard report. |

---

## 7. Resources Directory & Safety Pulse (`resourcesPulseRouter`)

| Method | Endpoint | Access Class | Description |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/resources` | `public` | List active emergency helplines, One Stop Centres, and campus security numbers. |
| `POST` | `/api/admin/resources` | `admin` | Create a new helpline or support resource entry. |
| `POST` | `/api/resources` | `admin` | Alias to create a helpline or support resource entry. |
| `PUT` | `/api/admin/resources/:id` | `admin` | Update details of an existing support resource. |
| `PUT` | `/api/resources/:id` | `admin` | Alias to update details of an existing support resource. |
| `DELETE` | `/api/admin/resources/:id` | `admin` | Delete or deactivate a support resource entry. |
| `DELETE` | `/api/resources/:id` | `admin` | Alias to delete or deactivate a support resource entry. |
| `GET` | `/api/pulse/status` | `any_user` | Check whether user has completed weekly safety pulse check-in. |
| `POST` | `/api/pulse` | `any_user` | Submit an anonymized weekly safety pulse rating. |

---

## 8. Responder Dashboard & Administration (`responderRouter`, `metricsRouter`)

| Method | Endpoint | Access Class | Description |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/responder/incidents` | `responder` | List active and open emergency alerts within responder's organization zone. |
| `GET` | `/api/responder/incidents/:id` | `responder` | View details and live location for an incident (logs access to audit table). |
| `POST` | `/api/responder/incidents/:id/acknowledge` | `responder` | Acknowledge alert, unmask victim phone, and notify user. |
| `POST` | `/api/responder/incidents/:id/assign` | `responder` | Self-assign or assign a fellow responder to the emergency. |
| `POST` | `/api/responder/incidents/:id/note` | `responder` | Add an operational note to the responder-internal incident log. |
| `POST` | `/api/responder/incidents/:id/responding` | `responder` | Mark responder status as actively en route to the location. |
| `POST` | `/api/responder/incidents/:id/resolve` | `responder` | Close and mark the emergency alert as resolved. |
| `POST` | `/api/responder/incidents/:id/false-alarm` | `responder` | Close incident as false alarm (requires mandatory note). |
| `GET` | `/api/admin/audit-log` | `admin` | Query tamper-evident incident access audit log. |
| `GET` | `/api/admin/audit-logs` | `admin` | Alias for querying administrative audit log entries. |
| `GET` | `/api/admin/responders` | `admin` | List registered responders, their organization zones, and duty statuses. |
| `PATCH` | `/api/admin/responders/:id` | `admin` | Update responder status, active assignments, or duty flag. |
| `GET` | `/api/admin/metrics` | `admin` | Aggregate platform safety and response time metrics (k >= 5 sample minimum). |
| `GET` | `/api/admin/metrics.csv` | `admin` | Export aggregate safety metrics in CSV format. |

---

## 9. Demo Mode & Test Hooks (`demoRouter`)

> **Notice:** All endpoints under `/api/demo/*` and `/api/test/*` are strictly disabled when `NODE_ENV=production`.

| Method | Endpoint | Access Class | Description |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/demo/status` | `public` | Check whether demo mode is currently enabled on the server. |
| `POST` | `/api/demo/reset` | `admin` | Reset database and restore clean initial demo state. |
| `POST` | `/api/demo/simulate/responder` | `owner_only` | Simulate rapid responder dispatch and acknowledgement for demo flows. |
| `POST` | `/api/demo/simulate/contact` | `owner_only` | Simulate trusted contact opening magic link and acknowledging SOS. |
| `POST` | `/api/test/retention/purge` | `public` | Trigger immediate execution of the data retention purge worker. |
| `POST` | `/api/test/providers/failure` | `public` | Toggle simulated failure states on mock SMS/OTP gateways. |
| `POST` | `/api/test/ratelimit/reset` | `public` | Reset in-memory rate limiter windows during integration test runs. |
