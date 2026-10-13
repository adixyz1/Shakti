# Phase 7C Report — Resources Directory and Weekly Safety Pulse

## 1. What Was Done
- **Database Schema & Migration (`0009_resources_safety_pulses.sql`)**:
  - Added `resources` table (`id`, `name`, `category`, `phone`, `description`, `available_hours`, `active`) with indexes on `category` and `active`.
  - Added `safety_pulses` table (`id`, `user_id` nullable, `safety_score` 1–5, `avoided_going_somewhere` boolean, `created_at`) with indexes on `user_id` and `created_at`.
  - Fix 1 (migrations): Restored `0007_safe_journeys.sql` to its original state, added `0010_journeys_note.sql` (`ALTER TABLE journeys ADD note text`), removed the `PRAGMA` workaround from `initDatabase()`, and verified migration from `0007` to `0010` + `recoverActiveJourneysOnStartup()`.
  - Fix 2 (rate limits): Confirmed `POST /api/reports` enforces both the per-minute rate limit (`10/min` per IP) and the daily cap (`5/day` per reporter), each with its own dedicated test in `phase7b_reports.test.ts`.
- **Seeded Verified Helplines & Placeholders (`apps/api/src/core/seed.ts`)**:
  - Seeded `112` (ERSS Emergency Helpline) and `181` (Women Helpline).
  - Seeded a generic Sakhi One Stop Centre entry, Campus Security (editable placeholder), Legal Aid, and Counseling — all using `"add your local number"` rather than invented phone numbers.
- **Endpoints (`apps/api/src/routes/resourcesPulse.ts`, `apps/api/src/services/resourcePulseService.ts`)**:
  - `GET /api/resources`: supports text search (`q`) and category filter (`category`).
  - `POST /api/admin/resources`, `PUT /api/admin/resources/:id`, `DELETE /api/admin/resources/:id`: admin-only create/update/delete.
  - `GET /api/pulse/status` & `POST /api/pulse`: enforces at-most-once-a-week prompt/submission per user; asks only the two required questions (`safety_score` 1–5 and `avoided_going_somewhere` boolean); anonymous pulses store `user_id = NULL` and `created_at` truncated to the date (`YYYY-MM-DD`).
- **Web UI (`ResourcesPage.tsx`, `SafetyPulseCard.tsx`, `HomePage.tsx`, `en.json`, `hi.json`)**:
  - Added `/resources` page (English + Hindi) with search, category filter chips, placeholder badges, and 56px one-tap `tel:` links.
  - Added dismissible `SafetyPulseCard` at the bottom of the Home screen (never covering the SOS button, and never rendered during an active/queued alert or when disguise mode is enabled).

## 2. What Was Not Done (Out of Scope)
- Analytics dashboard and demo mode (scheduled for Phase 8).
- No phone numbers beyond `112` and `181` were invented.

## 3. What the Next Phase Can Rely On
- `resources` and `safety_pulses` tables and `resourcesPulseApi` (`listResources`, `createResource`, `updateResource`, `deleteResource`, `getPulseStatus`, `submitPulse`).
- Anonymized `safety_pulses` (`safety_score`, `avoided_going_somewhere`, `created_at`) and `journeys` / `reports` / `incidents` data ready for Phase 8 impact indicators.
