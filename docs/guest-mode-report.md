# SAATHI Guest Mode Report

## 1. Executive Summary
Guest Mode allows women to access critical safety tools immediately without signing in or creating an account. The application runs locally in the browser with full offline support, zero server incidents created during guest SOS, and strict device-only data storage.

## 2. Session Modes and Route Access Classes
- **Guest-allowed Routes**: `/`, `/home`, `/resources`, `/reports`, `/settings`, `/policy`, `/invite/:token`, `/c/:token`.
- **Account-required Routes**: `/circle`, `/journeys`, `/consents`, `/onboarding`, `/responder`, `/admin`.
- **AccountRequiredPage**: Visiting an account-required feature without a session displays a calm explanation detailing why an account is needed (e.g. circle invitations, automated escalation, responder credentials) and provides direct links to the available device-only guest tools without redirect loops.

## 3. Guest SOS Engine
- **Zero Server Calls**: Triggering SOS in guest mode makes NO `POST /api/incidents` network call.
- **Cancel Window & PIN**: A configurable countdown (default 5s) displays locally. Cancellation can be protected by a device-only salted PBKDF2 cancel PIN stored in localStorage.
- **Active State Outcome**: When the countdown completes, the alert transitions to active locally. The UI displays:
  - Direct Call 112 button (ERSS)
  - Direct Call 181 button (Women Helpline)
  - Send by SMS fallback panel built from contacts saved on the phone
  - Plain note: "Not signed in. Your phone's SMS app sends this message. Sign in to alert your circle automatically."
  - Location is included in the SMS body ONLY if location consent was already granted.

## 4. Guest Emergency Contacts
- Contacts (name and E.164 phone number) are saved exclusively in IndexedDB (`saathi_offline_db.cachedContacts`) with a maximum of 5 contacts.
- Includes in-place add, edit, and delete functionality.
- Includes a prominent "Clear data on this phone" button with a clear warning that clearing browser data or using private browsing erases local data.

## 5. Duress PIN Restriction
- Silent duress PIN settings are hidden in Guest Mode.
- A calm notice explains that silent duress signaling requires a verified account for server-side escalation without alerting an aggressor.

## 6. Sign-in Later Migration
- When a user signs in after previously saving guest contacts, the Home screen displays an optional invitation card.
- The user can choose to invite saved phone contacts into their emergency Circle. Local copies are deleted only after user confirmation.

## 7. Server Default-Deny & Security
- `optionalAuth` middleware allows public/guest submission for anonymous reports and safety pulse ratings with strict IP-based rate limiting.
- Alert creation, safe journeys, circle contacts, and consent routes remain strictly protected under authenticated session controls.
- The automated authorization sweep in `phase9a_security.test.ts` validates 100% of routes in `REGISTERED_ROUTE_ACCESS_TABLE`.

## 8. Verification & Test Coverage
- `apps/web/src/tests/guest_mode.test.tsx`: 7 tests passing (Home access without redirect, AccountRequiredPage, zero POST on guest SOS, SMS fallback panel with plain note, duress PIN hidden, IndexedDB contact limits, and PBKDF2 device cancel PIN).
- `apps/api/src/tests/phase9a_security.test.ts`: 6 tests passing (authorization sweep and rate limiting).
- `e2e/shakti.spec.ts`: Added test 16 for guest offline SOS flow and SMS panel.
