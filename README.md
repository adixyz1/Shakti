# SAATHI — Safety Assistance & Alert Technology for Help & Intervention

SAATHI is an installable, offline-first, consent-respecting Progressive Web Application (PWA) designed to give women a fast, discreet way to request emergency support while giving trusted contacts and community/campus responders a clear way to respond.

> **Important Disclaimer:** SAATHI **complements** India's **112 (ERSS)** and **181 Women Helpline**. It never replaces official emergency services and never claims to guarantee physical safety or response times.

## Six Hard Constraints
1. **Limited connectivity:** Offline-first architecture, queued alerts, SMS fallback, last-known-location fallback.
2. **Consent first:** Nothing is shared without explicit, revocable, per-contact consent.
3. **No coercive tracking:** No background tracking, no passive tracking, no permanent location history.
4. **Realistic responders:** Honest modeling of trusted contacts, campus security, and 112/181 with escalation ladders and timers.
5. **Simple under stress:** One big action (`>= 56px`), few steps, high contrast, zero typing required in an emergency.
6. **Deterministic SOS path:** Core SOS flow works deterministically with AI, SMS, push, and external services disabled.

## Repository Structure
```
saathi/
  PROJECT_BRIEF.md
  docker-compose.yml
  .env.example
  docs/                      # Phase reports, API documentation, LIMITATIONS.md
  apps/
    api/                     # Node.js + TypeScript + Express + Drizzle ORM (SQLite) + ws + Zod
      src/
        core/                # config, security, db, middleware, seed
        db/                  # Drizzle schema + versioned SQL migrations
        schemas/             # Zod validation schemas
        routes/              # Express API routes
        services/            # Business logic services
        providers/           # Interfaces + Mock implementations (MockOtpProvider, etc.)
        tests/               # Vitest + Supertest API test suite (real SQLite temp DB)
      server.ts              # Single entry: Express API + WebSocket + Vite middleware (Port 3000)
    web/                     # React + TypeScript + Vite + Tailwind CSS + i18next
      src/
        components/          # Accessible design system components (56px primary, 44px min)
        pages/               # Welcome, Login, Home
        features/            # Feature modules
        lib/                 # API client with automatic token refresh
        i18n/                # English (en) and Hindi (hi) translations
        store/               # Zustand state management
```

## Quick Start

### Start Single-Process Server (Port 3000)
```bash
npm run dev
```

### Running Tests
- **All Tests (API + Web):** `npm test`
- **Backend API & Auth Tests (Vitest + Supertest + SQLite):** `npm run test:api`
- **Frontend Unit Tests (Vitest + RTL):** `npm run test:web`
