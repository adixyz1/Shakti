# SAATHI / SHAKTI — ₹0 Oracle Cloud Hosting, Hybrid Mobile APK & Auto-Update Plan

Deliver a complete, zero-cost (₹0/month) hosting and mobile app distribution setup on Oracle Cloud Always Free (Ampere A1), including automatic HTTPS via free subdomains (`nip.io` or `DuckDNS`), hybrid offline-first + live-server sync for the Android APK, and one-command + GitHub Actions automatic updates whenever you modify the website or mobile app.

## User Review & Critical Decisions

> [!IMPORTANT]
> **Oracle Cloud Always Free Hardware Limit Check (₹0 Guarantee):**
> The PDF guide you shared mentions `4 OCPUs / 24 GB RAM`, which exceeds Oracle's current official Always Free allowance (`2 OCPUs` and `12 GB RAM` total across Ampere A1 instances, plus `200 GB` block storage). Our automated setup and guide strictly configure **2 OCPUs, 12 GB RAM, and 50–100 GB storage** on an Always Free account so your bill remains **₹0 forever** without needing to upgrade to Pay-As-You-Go.

- **Confirmed Decision 1 — Free HTTPS Domain (`DuckDNS` or `nip.io`)**: Use Caddy reverse proxy in Docker to automatically issue and renew free Let's Encrypt TLS certificates for either a zero-signup `<PUBLIC_IP>.nip.io` address or a free `<name>.duckdns.org` subdomain. HTTPS is mandatory for mobile GPS geolocation, Service Workers, and PWA installation.
- **Confirmed Decision 2 — Hybrid Android APK (Standalone Offline + Live Server Sync)**: Enhance the Android APK API layer so it works 100% offline/standalone out of the box, while seamlessly syncing with your live Oracle Cloud server when connected (configurable automatically during build or in the in-app Settings screen).
- **Confirmed Decision 3 — One-Command Update + GitHub Actions Auto-Deploy**: Provide both a single-command server update script (rebuilds the web bundle, compiles the latest Android APK, and restarts the container without losing database state) and an automated GitHub Actions deployment workflow triggered on `git push`.

---

## 1. Overview & Core Concept

- **What It Does**:
  1. **Hosts the Full-Stack Website for ₹0**: Runs the Express API, WebSocket real-time hub, SQLite persistent database, and React PWA frontend inside Docker on an Oracle Cloud Always Free Ampere A1 VM (`ARM64`), fronted by Caddy for automatic HTTPS.
  2. **Hosts & Distributes the Mobile App for ₹0**: Serves both the installable PWA (Android & iOS) and the direct 1-tap downloadable Android APK (`/shakti.apk`) directly from your Oracle Cloud server.
  3. **Hybrid Mobile APK Connectivity**: Allows installed Android APK users to operate completely offline/standalone on their device or sync live SOS alerts, responder actions, and trusted contact links with your Oracle Cloud server.
  4. **Zero-Downtime Updates**: Lets you edit code anytime and publish updates to both the website and hosted mobile app via a single SSH command or automatic GitHub push.
- **Target Audience / Persona**: Project owner/developer deploying SAATHI/SHAKTI on a ₹0 student/prototype budget, and mobile testers/judges installing the app on Android or iOS phones.
- **Key Value**: Eliminates cloud hosting bills and app-store fees while ensuring real-phone HTTPS features (GPS, Web Audio siren/fake call, offline queue, and APK downloads) work reliably.

---

## 2. User Experience & Visual Design

- **Key User Flows**:
  1. **First-Time Oracle Cloud Setup**: You run a single bootstrap script on your fresh Ubuntu VM (`2 OCPU / 12 GB RAM`), which opens firewall ports `80/443`, installs Docker, configures your free `<IP>.nip.io` or `.duckdns.org` HTTPS domain, and starts SAATHI.
  2. **Mobile App Installation Flow**: Visitors open your HTTPS URL on their phone and tap **"Download Android App (.apk)"** or **"Add to Home Screen"** (iOS/Android PWA) in 1–2 taps.
  3. **Hybrid Mobile Server Sync Flow (Settings)**: Inside the mobile app's **Settings** page, a clean, calm **Cloud Server Sync (Optional)** card shows whether the app is operating in **Local Standalone Mode** or synced with a **Live Server URL**, allowing 1-tap switching or testing connection health without clutter.
  4. **Making Changes Later**: When you edit any UI or backend feature, pushing to GitHub (or running the update script) automatically rebuilds the website, regenerates the downloadable `/shakti.apk` with your new changes, and restarts the server while keeping `/data/shakti.db` intact.
- **Visual Identity & Theme**:
  - *Aesthetic Direction*: Calm, high-contrast Paper Utility safety interface matching the existing app design.
  - *Color Palette & Mood*: Warm alabaster/slate surfaces (`bg-slate-50` / `dark:bg-slate-900`), deep slate typography (`text-slate-900` / `dark:text-white`), and trustworthy teal accents (`bg-teal-700`) for install/sync status badges. No heavy gradients.
  - *Typography & Hierarchy*: Clear, scannable status indicators with large touch targets (`min-h-[44px]`) for one-hand mobile operation.
  - *Interactive Feedback & Motion*: Instant connection test feedback badge ("Connected to Live Server" vs. "Offline Standalone Ready — Auto-fallback active") and toast confirmation when updating the server URL.

---

## 3. Key Product Decisions & Trade-Offs

- **Decision 1: Caddy Reverse Proxy + `nip.io` / `DuckDNS` for Zero-Cost HTTPS**
  - *Chosen Approach*: Bundle a lightweight Caddy service in Docker Compose that automatically provisions Let's Encrypt SSL certificates for `<ORACLE_PUBLIC_IP>.nip.io` (zero registration required) or `<yourname>.duckdns.org`.
  - *Why*: Mobile browsers block `navigator.geolocation` (GPS), Service Workers, and Web Wake Lock on plain `http://` IP addresses. Caddy + `nip.io` gives instant valid HTTPS with ₹0 domain cost.
  - *Alternatives Considered*: Self-signed certificates (rejected because phones show scary security warnings and block PWA service workers).

- **Decision 2: Hybrid Standalone + Live Server API Routing in Android APK**
  - *Chosen Approach*: When the APK is built on or connected to your Oracle server, it attempts requests against the configured live HTTPS server URL (`VITE_API_BASE_URL` or user-configured Server URL in Settings) and automatically falls back to the on-device standalone engine (`standaloneApkApi`) if offline or unreachable.
  - *Why*: Guarantees that emergency SOS, fake calls, loud alarm, and local contacts never fail when a user has poor connectivity, while still allowing multi-device demos (e.g., Responder Dashboard on laptop + SOS on Android APK) when online.

- **Decision 3: Single-Instance SQLite Persistence on Docker Volume**
  - *Chosen Approach*: Mount the `shakti_data` Docker volume to `/data/shakti.db` on the Oracle VM's boot volume (up to 200 GB free).
  - *Why*: Zero external database cost, survives all container rebuilds and code updates, and keeps sensitive data self-contained on your instance.

---

## 4. Technical Architecture & Data Strategy *(Technical Reference)*

- **Architecture & Component Diagram**:

```
┌─────────────────────────────────────────────────────────────────────────┐
│             ORACLE CLOUD ALWAYS FREE VM (VM.Standard.A1.Flex)           │
│                  2 OCPUs • 12 GB RAM • Ubuntu ARM64 (₹0)                │
│                                                                         │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │ Docker Compose Network                                            │  │
│  │                                                                   │  │
│  │  [Internet: Ports 80 / 443]                                       │  │
│  │              │                                                    │  │
│  │              ▼                                                    │  │
│  │  ┌─────────────────────────────────────────────────────────────┐  │  │
│  │  │ Caddy Reverse Proxy Container                               │  │  │
│  │  │ • Auto Let's Encrypt HTTPS for <IP>.nip.io or *.duckdns.org │  │  │
│  │  └───────────────────────────┬─────────────────────────────────┘  │  │
│  │                              │ HTTP :3000                         │  │
│  │                              ▼                                    │  │
│  │  ┌─────────────────────────────────────────────────────────────┐  │  │
│  │  │ SAATHI / SHAKTI App Container (Node 22 + Express + WS)      │  │  │
│  │  │ • Serves React PWA Bundle (dist/)                           │  │  │
│  │  │ • Serves Direct Android App Download (/shakti.apk)          │  │  │
│  │  │ • REST API (/api/*) & Real-Time WebSocket Hub (/ws)         │  │  │
│  │  └───────────────────────────┬─────────────────────────────────┘  │  │
│  │                              │                                    │  │
│  │                              ▼                                    │  │
│  │  ┌─────────────────────────────────────────────────────────────┐  │  │
│  │  │ Persistent Docker Volume (shakti_data -> /data/shakti.db)   │  │  │
│  │  │ • Retains SQLite DB across code updates & restarts          │  │  │
│  │  └─────────────────────────────────────────────────────────────┘  │  │
│  └───────────────────────────────────────────────────────────────────┘  │
└────────────────────────────────────▲────────────────────────────────────┘
                                     │
         ┌───────────────────────────┴───────────────────────────┐
         │                                                       │
┌────────┴───────────────────────────────┐     ┌─────────────────┴────────────────┐
│ Android APK & Mobile PWA Clients       │     │ Auto-Update Pipeline             │
│ • Hybrid API Router:                   │     │ • One-Command Update Script      │
│   1. Live Oracle Server Sync (Online)  │     │ • GitHub Actions SSH Auto-Deploy │
│   2. Local Standalone Engine (Offline) │     │ • Auto-rebuilds Web + APK        │
└────────────────────────────────────────┘     └──────────────────────────────────┘
```

- **Data Model & State**:
  - **Remote Server Config Store (Client LocalStorage)**: Stores an optional `shakti_remote_server_url` (defaulting to `VITE_API_BASE_URL` or the origin where the APK was downloaded) and a boolean `sync_enabled` toggle.
  - **Persistent Server SQLite Volume (`/data/shakti.db`)**: Stores users, consents, trusted circle contacts, active incidents, safe journeys, k-anonymous safety reports, and audit logs on the Oracle VM disk.
- **Interactive Component & State Mapping**:
  - **Hybrid API Client**: Checks if a remote server URL is configured and reachable; if enabled, sends API requests with `credentials: 'include'` and `X-Demo-Role` header to the Oracle Cloud server, and transparently falls back to `handleStandaloneApkApiRequest` if offline or in standalone-only mode.
  - **Settings Cloud Sync Card**: Lets the user view current connection mode (`Standalone Offline` vs. `Synced with Oracle Server`), enter or reset the server URL, and run a 1-tap `Test Connection` check against `/api/health`.
  - **Oracle Cloud Bootstrap & Update Scripts**:
    - First-time VM setup script configures Ubuntu `iptables`/UFW for ports `80/443`, installs Docker & Docker Compose, auto-detects the VM's public IP to configure `<PUBLIC_IP>.nip.io` (or custom DuckDNS domain), and launches the stack.
    - Update script pulls the latest git commits, optionally rebuilds `public/shakti.apk` with the server's live URL baked in, and runs `docker compose up -d --build` with zero database loss.
  - **GitHub Actions Auto-Deploy Workflow**: Connects via SSH to your Oracle Cloud VM whenever you push changes to `main`/`master` (when repository secrets `ORACLE_HOST`, `ORACLE_USER`, and `ORACLE_SSH_KEY` are configured) and triggers the update script automatically.
