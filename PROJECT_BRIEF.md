# 00: SAATHI Project Brief and Working Rules

**How to use:** Paste this file FIRST into Antigravity, and also save it in the project root as `PROJECT_BRIEF.md`. Then give the phase prompts (01 to 09) ONE AT A TIME, in order. Do not start the next phase until the current one passes its checklist. At the start of every phase, tell the agent: "Re-read PROJECT_BRIEF.md and the previous phase's report before starting."

---

## Mission
Build **SAATHI** (Safety Assistance & Alert Technology for Help & Intervention): an installable **PWA web application** that gives women a fast, discreet, privacy-respecting way to ask for help, and gives trusted contacts and responders a clear way to respond.

Problem statement (Women & Child Empowerment, 4.1): a technology-based safety and emergency-support solution for women, addressing accessible reporting and reliable emergency response while preserving consent, privacy and freedom of movement.

SAATHI **complements** India's 112 (ERSS) and 181 Women Helpline. It never replaces them, and never claims to guarantee physical safety or response times.

## Six hard constraints (every phase must respect these)
1. **Limited connectivity:** offline-first, queued alerts, SMS fallback, last-known-location fallback.
2. **Consent first:** nothing is shared with anyone without explicit, revocable, per-contact consent. Always show the user exactly what is being shared.
3. **No coercive tracking:** no background tracking, no "track her" feature, no permanent location history. Location is captured only during an active alert or a user-started check-in, and it expires.
4. **Realistic responders:** model trusted contacts, campus security, and 112/181 honestly. Use escalation ladders and acknowledgement timers.
5. **Simple under stress:** one big action, few steps, large targets, no typing in an emergency.
6. **Deterministic SOS path:** the core SOS flow must work with AI, SMS, push and every external service disabled.

## Roles
- **User:** the woman using SAATHI (has an account).
- **Trusted Contact:** family or friend. Needs no account; uses an expiring magic link.
- **Responder:** campus security or community responder (dashboard).
- **Admin:** manages responders, views anonymized analytics and audit logs.

## Fixed tech stack (do not substitute without asking me first)
- **Web:** React + TypeScript + Vite, Tailwind CSS, React Router, TanStack Query, Zustand, Dexie (IndexedDB), Workbox (PWA), Leaflet + OpenStreetMap, i18next (English + Hindi).
- **API:** Node.js + TypeScript, **Express as the ONLY backend**, Zod for validation, `ws` for WebSockets, a **real SQL database (SQLite)** accessed through Drizzle ORM with versioned migrations. Written so it can move to PostgreSQL later. **A JSON file is NOT an acceptable database.** Before choosing the SQLite driver, check the Node version and what actually installs here (built-in `node:sqlite`, `better-sqlite3`, or `libsql`); if no real SQL driver installs, STOP and ask me.
- **Single process, single port:** Express serves the API and WebSocket, and mounts Vite as middleware in dev. No proxy, no second backend, no Python anywhere in the project.
- **Auth:** phone OTP (mock provider), JWT in httpOnly cookies, role-based access control.
- **Integrations behind interfaces, each with a working MOCK:** SmsProvider, PushProvider, EmergencyServiceGateway (mock 112), OtpProvider, optional AssistProvider (AI, off by default).
- **Tests:** Vitest + Supertest (API), Vitest + React Testing Library (web), Playwright (end to end).

## Fixed folder structure (do not reorganize)
```
saathi/
  PROJECT_BRIEF.md
  docker-compose.yml
  .env.example
  docs/                      (phase reports, API notes, LIMITATIONS.md)
  apps/
    api/
      src/
        core/                (config, security, db, middleware)
        db/                  (Drizzle schema + migrations)
        schemas/  routes/  services/
        providers/           (interfaces + mock implementations)
        tests/
      server.ts              (single entry: API + WebSocket + Vite middleware)
    web/
      src/
        components/  pages/  features/  lib/  i18n/  store/
```

## Alert state machine (single source of truth, used by all phases)
`TRIGGERED -> ACTIVE -> NOTIFIED -> ACKNOWLEDGED -> RESPONDING -> RESOLVED`
Side exits: `CANCELLED` (during cancel window), `FALSE_ALARM`, `EXPIRED`.
Every transition writes an immutable row to `incident_events`.

## WORKING RULES (the agent must follow all of these)
1. **Stay in scope.** Only build what the current phase prompt lists. Do not add features, refactor unrelated files, or "improve" earlier phases unless a fix is required for the current phase to work. If you think something outside scope is needed, STOP and ask.
2. **Do not invent.** Do not make up library names, function signatures, config options or API behavior. If unsure, check the installed package's docs/source in the project, or ask me. Pin versions you actually installed.
3. **Verify, don't assume.** After each task, run it: start the server, run the tests, open the app in the browser. Never write "this should work". Report real command output.
4. **No fake implementations.** No functions that silently return dummy data, no `TODO` placeholders pretending to work. If something is mocked, name it `Mock...` and label it in code and UI.
5. **Ask when ambiguous.** If a requirement is unclear or two requirements conflict, list the options and ask me. Do not guess.
6. **Small steps.** Work in the task order given. Commit-sized chunks. Keep files focused and readable.
7. **State assumptions.** Keep a running "Assumptions" list in the phase report.
8. **Phase report.** At the end of each phase, write `docs/phase-NN-report.md` with: what was built, files created/changed, commands to run it, test results (real output), assumptions, known issues, and what the next phase can rely on. Then STOP and wait for my approval.
9. **Respect the six hard constraints** above in every decision.
10. **Never log or expose** phone numbers, locations or tokens in plain text outside the places explicitly designed for them.

## Phase list
1. Foundation (scaffold, auth, design system)
2. Consent and trusted circle
3. SOS engine (backend)
4. SOS experience (frontend)
5. Offline and low connectivity
6. Trusted contact and responder views
7. Journeys, reports and resources
8. Analytics, privacy tools and demo mode
9. Testing, hardening and documentation
10. (Optional) Stretch features
