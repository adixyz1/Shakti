# SHAKTI System Architecture

## 1. System Overview

SHAKTI is architected as an offline-capable, single-port Progressive Web Application (PWA) backed by an Express REST API, a live WebSocket broadcast hub, and an embedded SQLite database managed via Drizzle ORM.

### Mermaid Component Architecture

```mermaid
graph TB
    subgraph Browser ["Client: Mobile-First Browser / PWA"]
        PWA["React 19 SPA (Vite)"]
        SW["Service Worker (CacheStorage)"]
        IDB["IndexedDB Offline Queue (Dexie)"]
        LocalStore["Zustand (PIN & Trigger Stores)"]
        WSClient["WebSocket Client (Auto-reconnect)"]
        Sensors["Web APIs (Shake, Geolocation, Voice)"]
    end

    subgraph Server ["Server: Express + WebSocket Hub (Port 3000)"]
        direction TB
        SecurityMid["Security Middleware\n(CSP, CORS, CSRF, Rate Limiting, Zod)"]
        RestAPI["Express REST Routes\n(/api/auth, /api/incidents, etc.)"]
        WSHub["WebSocket Hub\n(ws://localhost:3000/ws)"]
        Scheduler["Background Scheduler\n(Escalation Timers & Purge Worker)"]
        StateMachine["Incident State Machine\n(Transactional Events & Audit)"]
    end

    subgraph Storage ["Persistence: Embedded SQLite"]
        Drizzle["Drizzle ORM Engine"]
        SQLiteDB[("saathi.db (WAL Mode)\n19 Normalized Tables")]
    end

    subgraph Providers ["Outbound Dispatch Gateways"]
        MockOTP["OTP Provider (Console/SMS)"]
        MockSMS["SMS Provider (Outbox / Telephony)"]
        MockERSS["112 ERSS Mock Gateway"]
    end

    %% Client internal connections
    PWA --> SW
    PWA --> IDB
    PWA --> LocalStore
    PWA --> Sensors
    PWA --> WSClient

    %% Client to Server
    PWA -- "HTTPS /api (JSON)" --> SecurityMid
    SecurityMid --> RestAPI
    WSClient -- "WSS /ws (Bearer Token / ctk)" --> WSHub

    %% Server internal connections
    RestAPI --> StateMachine
    RestAPI --> Drizzle
    WSHub --> Drizzle
    Scheduler --> StateMachine
    StateMachine --> Drizzle
    Drizzle --> SQLiteDB

    %% External dispatches
    RestAPI --> MockOTP
    StateMachine --> MockSMS
    StateMachine --> MockERSS
```

---

## 2. Data Model Overview

The embedded SQLite database consists of 17 relational tables strictly enforcing privacy, consent, and auditability:

1. **`users`**: User identity records (`id`, `phone_e164`, `name`, `role`, `language`, `organization_zone`, `cancel_pin_hash`, `duress_pin_hash`, `cancel_window_seconds`, `created_at`, `updated_at`).
2. **`otp_codes`**: Transient verification codes with strict 5-minute expiry, salt hashes, and attempt counters.
3. **`consents`**: Append-only consent ledger recording individual grant/revocation timestamps, categories (`data_processing`, `location`, `emergency_sharing`), and consent sources.
4. **`trusted_contacts`**: User-managed emergency contacts (capped at 5 per user) with individual permission flags (`receives_sos`, `receives_checkin`, `can_see_live_location`) and status (`invited`, `accepted`, `declined`, `paused`).
5. **`contact_invitations`**: Secure tokens (`inv_<random>`) for inviting trusted contacts to join a user's safety circle.
6. **`contact_incident_tokens`**: Ephemeral signed tokens (`ctk_<nonce>.<sig>`) granting contact-specific read access to an active incident via magic link.
7. **`incidents`**: Emergency incident records (`id`, `user_id`, `status`, `emergency_type`, `duress`, `source_trigger`, `created_at`, `activated_at`, `closed_at`).
8. **`incident_events`**: Immutable timeline of state transitions recording `from_status`, `to_status`, `actor_type`, and `actor_id` in the same transaction as the state change.
9. **`location_samples`**: Real-time GPS coordinates recorded strictly during active incidents with valid `location` consent, flagged with `expires_at` retention timestamps.
10. **`notifications`**: Internal notification dispatch records tracking recipient delivery states and escalation steps.
11. **`sent_messages`**: Outbox history capturing SMS dispatch bodies, destinations, and timestamps for testing and delivery auditing.
12. **`responders`**: Verified community and campus responder accounts linked to specific organization zones with on-duty status flags.
13. **`incident_assignments`**: Tracking which responder is actively assigned to an incident.
14. **`incident_access_audit` (`audit_log`)**: Tamper-evident audit log recording every access to sensitive incident data, responder views, and administrative actions.
15. **`journeys`**: Safe Journey tracking records (`id`, `user_id`, `status`, `starts_at`, `expected_arrival_at`, `extended_count`, `note`).
16. **`reports`**: Anonymized safety hazard reports with k-anonymity geo-binning and automated daily report caps.
17. **`resources`**: Directory of 24x7 emergency helplines (112, 181, One Stop Centres, campus desks).
18. **`safety_pulses` & `post_incident_ratings`**: Anonymized weekly wellness check-ins and incident resolution feedback.

---

## 3. Incident State Machine

The incident lifecycle strictly implements the state transition model defined in `apps/api/src/services/incidentStateMachine.ts`. State transitions are transactional and immutable: any attempt to transition between disallowed states throws an HTTP `400` error and is rejected.

### Mermaid State Diagram

```mermaid
stateDiagram-v2
    [*] --> TRIGGERED: SOS Triggered (Button, Voice, Shake, Journey Timeout)

    TRIGGERED --> CANCELLED: User cancels during Cancel Window (Valid Cancel PIN)
    TRIGGERED --> ACTIVE: Cancel window elapses (or Duress PIN entered)
    TRIGGERED --> EXPIRED: System timeout / unhandled

    ACTIVE --> NOTIFIED: Outbox notifications dispatched to trusted contacts
    ACTIVE --> ACKNOWLEDGED: Contact opens magic link OR Responder views alert
    ACTIVE --> RESPONDING: Responder marks responding
    ACTIVE --> RESOLVED: User or Responder resolves incident
    ACTIVE --> FALSE_ALARM: Marked as false alarm (with mandatory reason note)
    ACTIVE --> EXPIRED: Max incident lifespan reached

    NOTIFIED --> ACKNOWLEDGED: Contact opens magic link OR Responder views alert
    NOTIFIED --> RESPONDING: Responder dispatched
    NOTIFIED --> RESOLVED: Incident resolved
    NOTIFIED --> FALSE_ALARM: Marked as false alarm
    NOTIFIED --> EXPIRED: Expired

    ACKNOWLEDGED --> RESPONDING: Responder en route
    ACKNOWLEDGED --> RESOLVED: Incident resolved
    ACKNOWLEDGED --> FALSE_ALARM: Marked as false alarm
    ACKNOWLEDGED --> EXPIRED: Expired

    RESPONDING --> RESOLVED: Incident successfully resolved
    RESPONDING --> FALSE_ALARM: Marked as false alarm
    RESPONDING --> EXPIRED: Expired

    RESOLVED --> [*]
    CANCELLED --> [*]
    FALSE_ALARM --> [*]
    EXPIRED --> [*]
```

### State Machine Properties:
- **Terminal States:** `RESOLVED`, `CANCELLED`, `FALSE_ALARM`, and `EXPIRED` are terminal; no further transitions are allowed.
- **Location Retention:** Upon reaching any terminal state, `expires_at` is immediately calculated and set on all associated `location_samples` for retention purging.
- **Duress Handling:** When a user enters a Duress PIN during the `TRIGGERED` window, the client UI mimics `CANCELLED`, but the server immediately transitions the incident to `ACTIVE` (with `duress=1`) and notifies responders silently.
