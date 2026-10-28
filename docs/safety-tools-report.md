# Safety Tools Guide Implementation Report

## Overview
Added a dedicated Safety Tools Guide to SAATHI providing practical safety awareness for personal safety items without commerce, cart, payments, checkout, tracking, or endorsements.

## 1. Data Schema & Migration
- Created migration `0013_safety_tools.sql` defining table `safety_tools` with columns: `id`, `category`, `title`, `description`, `safe_use_notes`, `legal_note`, `link_url` (nullable), `link_label`, `last_checked`, `is_affiliate`, and `active`.
- Indexed `category` and `active` columns for performant filtering. Added separate category and link table definitions (`safety_tool_categories` and `safety_tool_links`) in `apps/api/src/db/schema.ts`.
- Seeded 5 non-weapon categories: Personal Alarm Keychain, Whistle, Torch Keyring, Portable Door Alarm, and Pepper Spray.
- Created `data/safety-tools.seed.json` with categories and documented "example, delete me" entry.
- All seeded tools have zero brand names, prices, ratings, or prohibited weapons (no stun guns, knives, or striking keyring tools).

## 2. API, Link Checker Script, & Authorization Sweep
- `GET /api/safety-tools`: Public, guest-allowed, protected by rate limiting middleware (60 requests/minute per IP).
- `POST /api/admin/safety-tools`, `PUT /api/admin/safety-tools/:id`, `DELETE /api/admin/safety-tools/:id`: Admin-only access with 401 unauthenticated and 403 for user and responder roles.
- Strict Zod validation: HTTPS-only URLs (`https://...`), verified string lengths, valid category enum, and boolean affiliate flags.
- Added `scripts/check_tool_links.ts` and `npm run check:tool-links` script running static verification against `data/safety-tools.seed.json` and the database with zero network calls.
- Checker rejects non-HTTPS, URL shorteners (bit.ly, tinyurl.com, t.co, goo.gl, ow.ly), javascript: and data: URLs, duplicate links, and last_checked older than 90 days.
- Full authorization sweep passes across unauthenticated, user, responder, and admin tokens.

## 3. UI, Offline Caching, & Disguise Protection
- Route `/safety-tools` reachable from Resources and Settings pages only.
- Completely hidden in disguise mode (renders disguise calculator instead of tools).
- Never displayed on emergency, SOS, or active alert screens.
- Link visibility rules: Public page hides any category that has no active links. If no category has links, displays one calm sentence ("No tools are listed yet.") and disclosure text, nothing else.
- The admin editor still displays every category with "No links added yet".
- Outbound links render only when `link_url` is set, with `target="_blank"` and `rel="noopener noreferrer"`. No external tracking scripts, pixels, or remote images.
- Mandatory top disclosure displayed in English and Hindi:
  "SHAKTI does not sell these items and does not track clicks or purchases. Tools do not guarantee safety. Rules about carrying them can differ by place and change over time, so check before you buy or carry. Ask a qualified person for legal advice."
- Affiliate notice ("We may earn a commission" / "हम कमीशन अर्जित कर सकते हैं") appears dynamically only for flagged links.

## 4. Policy & Limitations Documentation
- Updated `PolicyPage.tsx` with Section 7 ("Safety Tools Guide & External Links"): clearly stating no click tracking, no purchase data storage, and external link departure boundaries.
- Updated `LIMITATIONS.md` with Section 13 ("Safety Tools Guide Boundaries & Disclaimers"): documenting no commercial endorsement, local law variations, safe handling precautions, and zero transactional telemetry.
- Verified that all new strings have English and Hindi translations and contain no em dashes.
