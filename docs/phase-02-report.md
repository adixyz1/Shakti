# Phase 02 Report: Consent and Trusted Circle

## 1. What Was Built
Phase 2 implements the **Consent Center (append-only ledger)**, **Trusted Circle & Public Invitations**, **`MockSmsProvider` & Dev Outbox**, and the single source-of-truth **`getNotifiableContacts(userId, purpose)`** rule enforcement engine:

1. **Drizzle Schema & Versioned SQL Migration (`apps/api/src/db/`)**:
   - Added 4 tables to `apps/api/src/db/schema.ts` without modifying the Phase 1 migration (`0000_charming_kat_farrell.sql`):
     - `consents`: Append-only ledger (`id`, `user_id`, `type` [`location`, `notifications`, `microphone`, `camera`, `data_processing`], `granted`, `created_at`, `source`).
     - `trusted_contacts`: (`id`, `user_id`, `name`, `phone_e164`, `priority_order`, `permissions` JSON `{ receives_sos, receives_checkin, can_see_live_location }`, `status` [`invited`, `accepted`, `paused`, `removed`], `created_at`, `updated_at`).
     - `contact_invitations`: (`id`, `contact_id`, `token_hash` unique SHA-256 index, `expires_at`, `accepted_at`, `created_at`).
     - `sent_messages`: (`id`, `to_phone_e164`, `body`, `provider`, `purpose`, `metadata` JSON, `created_at`).
   - Generated new versioned SQL migration via `drizzle-kit generate`: `apps/api/src/db/migrations/0001_mixed_solo.sql`.
2. **`SmsProvider` & `MockSmsProvider` (`apps/api/src/providers/sms.ts`)**:
   - `SmsProvider` interface + `MockSmsProvider` writing outbound SMS messages to `sent_messages` in SQLite.
   - `GET /api/dev/outbox` returns sent messages in `development`/`test` and strictly returns `404 Not Found` when `NODE_ENV=production`.
3. **Rule Enforcement Service (`getNotifiableContacts(userId, purpose)`)**:
   - Single source-of-truth function in `apps/api/src/services/contactService.ts`.
   - Returns ONLY contacts for `userId` where `status === 'accepted'` (excluding `invited`, `paused`, `removed`) AND the permission for `purpose` (`receives_sos`, `receives_checkin`, or `can_see_live_location`) is `true`.
   - Enforces the user's append-only consent ledger: revoking `data_processing` stops all contact eligibility immediately, and revoking `location` stops `live_location` eligibility immediately.
4. **Web Pages (`apps/web/src/pages/`) & Bilingual i18n (`en` + `hi`)**:
   - `OnboardingPage.tsx` (`/onboarding`): 3 short plain-language screens.
   - `ConsentCenterPage.tsx` (`/consents`): Separate explanations (What, Why, Who, How long) for all 5 permissions, Grant/Revoke toggles, browser permission prompts (`location`, `notifications`) triggered ONLY here with a Reduced-Mode notice if declined, and live append-only ledger history.
   - `TrustedCirclePage.tsx` (`/circle`): List, add (max 5 active), edit, reorder priority, pause/resume, remove, invitation status labels, and development outbox viewer.
   - `PublicInvitePage.tsx` (`/invite/:token`): Public (no login) invitation inspection with `56px` Accept / Decline buttons.
   - `SettingsPage.tsx` (`/settings`): Language toggle, theme toggle, and links to Consent Center, Trusted Circle, and Onboarding.

---

## 2. Table of New Endpoints

| Method | Path | Auth | Description |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/consents` | `requireAuth` | Returns current consent state map + full append-only ledger history for the user |
| `POST` | `/api/consents` | `requireAuth` | Appends a new grant/revoke row to `consents` (never updates or deletes) |
| `GET` | `/api/contacts` | `requireAuth` | Lists active (`invited`, `accepted`, `paused`) trusted contacts ordered by `priority_order` |
| `POST` | `/api/contacts` | `requireAuth` | Creates a trusted contact (max 5 active), creates a signed single-use invitation, and sends SMS via `SmsProvider` |
| `PATCH` | `/api/contacts/:id` | `requireAuth` | Updates contact name, phone, or permissions (`receives_sos`, `receives_checkin`, `can_see_live_location`) |
| `POST` | `/api/contacts/reorder` | `requireAuth` | Reorders `priority_order` (`1..N`) for the user's active contacts |
| `POST` | `/api/contacts/:id/pause` | `requireAuth` | Pauses a contact (`status = 'paused'`), immediately excluding them from `getNotifiableContacts` |
| `POST` | `/api/contacts/:id/resume` | `requireAuth` | Resumes a paused contact (`accepted` if invitation was accepted, else `invited`) |
| `DELETE` | `/api/contacts/:id` | `requireAuth` | Soft-removes a contact (`status = 'removed'`) and normalizes remaining priorities |
| `GET` | `/api/invitations/:token` | Public (No Auth) | Inspects who invited the contact and what permissions are requested |
| `POST` | `/api/invitations/:token/accept` | Public (No Auth) | Single-use accept: marks invitation accepted and transitions contact to `status = 'accepted'` |
| `POST` | `/api/invitations/:token/decline` | Public (No Auth) | Single-use decline: marks invitation declined and transitions contact to `status = 'removed'` |
| `GET` | `/api/dev/outbox` | Dev/Test Only | Lists `MockSmsProvider` messages from SQLite; returns `404` when `NODE_ENV=production` |

---

## 3. Files Created / Changed
- `apps/api/src/db/schema.ts`
- `apps/api/src/db/migrations/0001_mixed_solo.sql`
- `apps/api/src/db/migrations/meta/_journal.json`, `apps/api/src/db/migrations/meta/0001_snapshot.json`
- `apps/api/src/core/security.ts`
- `apps/api/src/providers/sms.ts`
- `apps/api/src/schemas/consent.ts`, `apps/api/src/schemas/contact.ts`
- `apps/api/src/services/consentService.ts`, `apps/api/src/services/contactService.ts`
- `apps/api/src/routes/consents.ts`, `apps/api/src/routes/contacts.ts`
- `apps/api/server.ts`
- `apps/api/src/tests/phase2_consent_contacts.test.ts`
- `apps/web/src/lib/api.ts`
- `apps/web/src/i18n/en.json`, `apps/web/src/i18n/hi.json`
- `apps/web/src/pages/OnboardingPage.tsx`
- `apps/web/src/pages/ConsentCenterPage.tsx`
- `apps/web/src/pages/TrustedCirclePage.tsx`
- `apps/web/src/pages/PublicInvitePage.tsx`
- `apps/web/src/pages/SettingsPage.tsx`
- `apps/web/src/pages/HomePage.tsx`, `apps/web/src/components/PageLayout.tsx`, `apps/web/src/components/ui/index.tsx`, `apps/web/src/App.tsx`
- `apps/web/src/tests/phase2_consent_circle.test.tsx`, `apps/web/src/tests/phase2_e2e_flow.test.tsx`
- `package.json`

---

## 4. Commands to Run
- **Start Single-Process Dev Server (Port 3000):**
  ```bash
  npm run dev
  ```
- **Run All Automated Tests (API + Web + E2E Browser Flow):**
  ```bash
  npm test
  ```

---

## 5. Real Test Output (`npm test`)
```text
 ✓ apps/api/src/tests/phase2_consent_contacts.test.ts (5 tests)
   ✓ maintains a strictly append-only consent ledger (grant/revoke appends rows, never updates/deletes)
   ✓ enforces getNotifiableContacts: excludes invited/paused/removed/permission-off and stops eligibility instantly on revoke
   ✓ rejects a 6th active trusted contact (max 5 active per user) and supports reordering and removing
   ✓ rejects expired invitation tokens and prevents single-use token reuse
   ✓ writes MockSmsProvider invitations to /api/dev/outbox and returns 404 when NODE_ENV=production
 ✓ apps/web/src/tests/phase2_consent_circle.test.tsx (3 tests)
   ✓ ConsentCenterPage renders all 5 permissions, toggles grant/revoke, shows ledger history, and shows reduced-mode notice if browser permission is declined
   ✓ TrustedCirclePage submits new contact form, displays invitation status, and supports pause/remove
   ✓ PublicInvitePage displays invitation details without login and accepts invitation
 ✓ apps/web/src/tests/phase2_e2e_flow.test.tsx (1 test)
   ✓ adds a contact, opens invitation link from /api/dev/outbox in unauthenticated window, accepts, sees status change to Accepted, and revokes consent in ledger
 ✓ apps/api/src/tests/auth.test.ts (7 tests)
 ✓ apps/web/src/tests/web_foundation.test.tsx (2 tests)

 Test Files  5 passed (5)
      Tests  18 passed (18)
```

---

## 6. Phase 1 Bug Fixes / Adjustments
- None required; Phase 1 behavior and migration `0000_charming_kat_farrell.sql` remain untouched.

---

## 7. Assumptions
1. **Active Contacts Definition**: Contacts with status `invited`, `accepted`, or `paused` count toward the 5-contact limit per user. Soft-removed contacts (`status = 'removed'`) do not count toward the limit.
2. **Invitation Expiry**: Invitations default to a 7-day expiry window (`DEFAULT_INVITATION_TTL_MS`), are signed with HMAC-SHA256, stored as SHA-256 hashes in `contact_invitations.token_hash`, and are strictly single-use.
3. **Consent Ledger Enforcement**: `getNotifiableContacts(userId, purpose)` checks both contact-level acceptance/permissions and the user's append-only consent ledger (`data_processing` and `location`).

---

## 8. Known Issues
- None in Phase 2 scope.

---

## 9. What Phase 3 Can Rely On
- `getNotifiableContacts(userId, purpose)` in `apps/api/src/services/contactService.ts` as the single source of truth for selecting eligible trusted contacts for `'sos'`, `'checkin'`, and `'live_location'`.
- `SmsProvider` / `MockSmsProvider` (`apps/api/src/providers/sms.ts`) and `/api/dev/outbox` for inspecting outbound SMS dispatches.
- Append-only `consents` ledger (`getConsentsForUser`, `appendConsentEntry`).
