# SHAKTI MVP Deployment Guide (Render, Railway, Fly.io)

This guide documents deploying SHAKTI as an installable Progressive Web Application (PWA) on generic container hosts such as **Render**, **Railway**, or **Fly.io**.

---

## 1. Quick Specifications

- **Runtime Architecture:** Single process (Express API + WebSocket server + static Vite bundle) on a single port.
- **Build Command:** `npm ci && npm run build`
- **Start Command:** `npm run start` (or Docker container execution: `CMD ["npm", "run", "start"]`)
- **Health Check Endpoint:** `GET /health` or `GET /api/health` (HTTP 200 `{ "status": "ok" }`)

---

## 2. Environment Variables for Hosted Demo Deployment

| Variable | Recommended Demo Value | Description |
| :--- | :--- | :--- |
| `NODE_ENV` | `staging` or `development` | **Must not be `production`** when `DEMO_MODE=true`. |
| `DEMO_MODE` | `true` | Enables in-app demo simulator and seeded sample accounts. |
| `COOKIE_SECURE` | `true` | Forces `Secure` cookie flag over platform HTTPS even in non-production. |
| `TRUST_PROXY` | `1` | Configures Express to trust reverse proxy headers (`X-Forwarded-Host`, `X-Forwarded-Proto`). |
| `PORT` | `3000` (or host assigned) | Platform port where the single server process binds to `0.0.0.0`. |
| `DATABASE_URL` | `file:/data/shakti.db` | Path to persistent SQLite database mounted on a container volume. |
| `JWT_SECRET_KEY` / `JWT_SECRET` | *(generate via node/openssl)* | Strong random secret (min 32 chars, see generator one-liner below). |
| `HMAC_SECRET_KEY` / `HMAC_SECRET` | *(generate via node/openssl)* | Strong random secret (min 32 chars, see generator one-liner below). |
| `DEMO_ADMIN_HINT` | *(unset by default)* | Leave unset. When explicitly `true`, shows admin demo OTP hint on login screen. |
| `ALLOW_MOCK_PROVIDERS` | `true` | Permits mock SMS, push, and OTP providers for demo verification. |

### Secret Generator One-Liner
To generate cryptographically strong 48-byte hex secrets for `JWT_SECRET_KEY` and `HMAC_SECRET_KEY`:
```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```
Or via OpenSSL:
```bash
openssl rand -hex 48
```

---

## 3. Critical Operational Warnings

1. **Seeded Test Accounts & Mock Gateways:**
   The hosted demo includes pre-seeded demo accounts (`+919000000001`, `+919000000002`, `+919000000003`) with simulated OTP delivery. **Never enter real personal telephone numbers or live confidential safety data.**
2. **Single Instance Invariant:**
   **Exactly ONE container instance must run.** The background escalation ladders, cancel window timers, and journey check-ins use an in-process memory scheduler. Running multiple horizontal replicas will fragment timer state and cause duplicate notifications.
3. **Persistent Volume Required:**
   SQLite requires a persistent disk mount (e.g., `/data`). Ephemeral container disks on free tiers will wipe incident history, contacts, and audit logs whenever the container restarts or spins down.
4. **Free Tier Sleeping Constraints:**
   When free-tier hosting services sleep due to inactivity, in-memory timers are paused until the container wakes on the next HTTP request. Scheduled startup recovery restores timers upon container boot.

---

## 4. Platform Deployment Instructions

### Railway
1. Create a new project and select **Deploy from GitHub repo**.
2. Add a persistent **Volume** mounted at `/data`.
3. Set the Environment Variables listed in Section 2.
4. Railway will detect the root `Dockerfile` and build automatically.

### Render
1. Create a new **Web Service** connected to your repository.
2. Select **Docker** as the environment.
3. Attach a persistent **Disk** mounted at `/data` (e.g. 1 GB).
4. Populate the Environment Variables in the Render dashboard.

### Fly.io
1. Initialize app: `fly launch --no-deploy`.
2. Create persistent volume: `fly volumes create shakti_data --size 1`.
3. Configure `fly.toml` to mount `shakti_data` at `/data` and limit `min_machines_running = 1`, `max_machines_running = 1`.
4. Deploy: `fly deploy`.

---

## 5. Real-Phone Verification Checklist

Before sharing the hosted demo, verify on an actual mobile device:

- [ ] **HTTPS Verification:** Access the deployment via HTTPS; verify that the padlock icon is valid and cookies are received with `Secure` and `HttpOnly`.
- [ ] **Health Check:** Open `https://<your-host>/health` and confirm `{ "status": "ok" }`.
- [ ] **PWA Installation:** Tap browser menu (Chrome / Safari) -> "Add to Home Screen". Verify app launches in standalone display mode with the SHAKTI icon.
- [ ] **Demo Login:** Sign in with demo user `+919000000001` using the on-screen demo OTP hint.
- [ ] **SOS Trigger Flow:** Hold the 2-second SOS button; test the cancel countdown window and transition to live status.
- [ ] **Offline Resilience:** Turn on Airplane mode on the phone; verify that triggered alerts are queued safely in IndexedDB, and the SMS fallback button and 181/112 links appear.
- [ ] **Secondary Safety Tools:** Test Fake Call (Web Audio ringing) and Loud Alarm (sweeping siren, screen wake lock, 5-minute auto-stop).
- [ ] **Support Options Card:** Close the alert (Mark safe or cancel); confirm the calm card appears ("Need someone to talk to? See support options") and links to `/resources` with counseling, legal-aid, One Stop Centre, and 181 listed first.
- [ ] **Trusted Contact Magic Link:** Send an invitation to a contact; open the invitation link on a separate device or private browser window; confirm status transitions to "Accepted & Active".
