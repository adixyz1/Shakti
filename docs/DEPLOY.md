# SHAKTI / SAATHI Deployment & Android APK Guide (Oracle Cloud Always Free + Generic Docker Hosts)

This guide provides the verified architecture, cost & billing risk boundaries, and exact step-by-step instructions for deploying **SHAKTI** on an **Oracle Cloud Always Free ARM64 VM** (as well as generic Docker hosts) and distributing the **Android APK**.

---

## 1. Cost & Resource Eligibility Table (₹0 Target Constraint)

> **Important Billing Disclaimer:** A ₹0/month recurring cost is an engineering target using current Always Free tier allowances—**never a guaranteed permanent billing outcome**. Cloud providers may revise free-tier policies, reclaim idle instances, or bill for resources that exceed Always Free thresholds if your account is upgraded to Pay-As-You-Go.

| Component | Recommended Service | Always Free Allowance (Current Official Limits) | Shakti Usage Allocation | Billing / Operational Risk & Mitigation |
| :--- | :--- | :--- | :--- | :--- |
| **Compute VM** | Oracle Cloud `VM.Standard.A1.Flex` (Ampere Altra ARM64, Ubuntu 22.04/24.04) | Up to **3,000 OCPU hours/month** (~4 OCPUs max, or **2 OCPUs** safe baseline) and **18,000 GB-hours/month** (~24 GB max, or **12 GB RAM** safe baseline) across the tenancy | **1 to 2 OCPUs**, **6 GB to 12 GB RAM** (1 single VM) | **Note on your PDF Guide:** Older guides cite 4 OCPUs / 24 GB RAM unconditionally; staying within **2 OCPUs / 12 GB RAM** (or the exact Always Free badge shown in your Oracle regional console) prevents accidental overage charges. |
| **Block Storage** | Oracle Cloud Block Volume (Boot Volume) | **200 GB** total across all Always Free instances | **50 GB** boot volume (stores OS, Docker images, `/data/shakti.db`, and `/data/backups`) | Do not create multiple VMs whose combined boot + block volumes exceed 200 GB. |
| **Outbound Bandwidth** | Oracle Cloud Virtual Cloud Network (VCN) | **10 TB / month** egress | < 5 GB / month for typical prototype/community use | Keep APK downloads rate-limited (Caddy + Express) and avoid hosting large video files. |
| **Domain & DNS** | **DuckDNS** (`<name>.duckdns.org`) or **nip.io** (`<PUBLIC_IP>.nip.io`) | ₹0 free dynamic/wildcard DNS | 1 subdomain pointing to your Oracle VM Public IPv4 address | `nip.io` requires zero registration; `DuckDNS` keeps your URL constant even if the VM IP changes. |
| **TLS / HTTPS Certificate** | **Caddy 2** (automatic Let's Encrypt / ZeroSSL) | ₹0 automated ACME certificates | Automatic HTTPS on port `443` + HTTP-to-HTTPS redirect on port `80` | Browser Geolocation (`navigator.geolocation`), Service Workers, and `Secure` cookies **fail on plain HTTP** on mobile phones. Always access the site via `https://`. |
| **SMS / OTP / 112 Gateways** | Built-in `MockOtpProvider`, `MockSmsProvider`, `MockEmergencyGateway` | ₹0 (in-app simulated outbox) | Enabled via `ALLOW_MOCK_PROVIDERS=true` | **Simulated only:** Mock providers do **not** send real telecom SMS or contact real 112 ERSS dispatchers. Native `sms:` and `tel:112`/`tel:181` links on the phone use the user's own SIM card plan. |
| **Android APK Build & Hosting** | GitHub Actions (`build-android-apk.yml`) + Self-hosted `/shakti.apk` on Oracle VM | 2,000 GitHub Actions minutes/month on free repos | ~4 mins per APK build; served directly from the Oracle VM at `https://<DOMAIN>/shakti.apk` | Google Play Store charges a $25 one-time fee; direct APK download from your HTTPS domain costs ₹0 (users must allow "Install unknown apps" on Android). |

---

## 2. Step-by-Step Oracle Cloud Always Free VM Provisioning

### Step 2.1: Create the Always Free ARM64 Instance
1. Sign in to the **Oracle Cloud Console** and select **Compute -> Instances -> Create Instance**.
2. **Name:** `shakti-server`
3. **Image:** Select **Canonical Ubuntu 22.04 Minimal aarch64** or **Ubuntu 24.04 aarch64**.
4. **Shape:** Click **Change Shape** -> Select **Ampere** (ARM-based) -> Check `VM.Standard.A1.Flex` (verify the **"Always Free-eligible"** label is displayed).
   - Set **1 or 2 OCPUs** and **6 GB or 12 GB Memory**.
5. **Networking:** Create or select a VCN with a public subnet and choose **Assign a public IPv4 address**.
6. **SSH Keys:** Download the private SSH key (`ssh-key.key`) or upload your own `~/.ssh/id_ed25519.pub`.
7. **Boot Volume:** Leave at default (**47–50 GB**; well inside the 200 GB Always Free limit).

### Step 2.2: Open Ports 80 and 443 in Oracle VCN Security List
By default, Oracle Cloud blocks all inbound traffic except SSH (`22`).
1. In the Oracle Console, click your instance's **Subnet** -> click the **Default Security List**.
2. Click **Add Ingress Rules** and add **only** these two rules (never expose port `3000` publicly):
   - **Rule 1 (HTTP ACME & Redirect):** Source CIDR `0.0.0.0/0`, IP Protocol `TCP`, Destination Port Range `80`.
   - **Rule 2 (HTTPS Traffic & WebSocket):** Source CIDR `0.0.0.0/0`, IP Protocol `TCP`, Destination Port Range `443`.

### Step 2.3: Choose Your Free HTTPS Domain (`nip.io` or `DuckDNS`)
- **Option A — Zero-Signup Instant Domain (`nip.io`):**
  If your Oracle VM Public IPv4 is `140.238.10.20`, your domain is immediately:
  ```text
  140.238.10.20.nip.io
  ```
- **Option B — Custom Free Subdomain (`DuckDNS`):**
  Sign in at `https://www.duckdns.org`, create a subdomain (e.g., `shakti-safety.duckdns.org`), and paste your Oracle VM Public IPv4 address.

---

## 3. Initial Deployment on the Oracle Cloud VM

### Step 3.1: SSH into the VM and Clone the Repository
```bash
chmod 600 ~/Downloads/ssh-key.key
ssh -i ~/Downloads/ssh-key.key ubuntu@<YOUR_ORACLE_PUBLIC_IP>

git clone <YOUR_GITHUB_REPO_URL> ~/shakti
cd ~/shakti
```

### Step 3.2: Run the One-Command Oracle Setup Script
The included `scripts/oracle_setup.sh` installs Docker Engine & Docker Compose, opens ports `80` and `443` in Ubuntu's host `iptables` (Oracle Ubuntu images include a restrictive default `REJECT` rule in `iptables`), creates a 2 GB swap file, and generates `.env` with cryptographically strong 48-byte hex secrets:

```bash
chmod +x scripts/oracle_setup.sh scripts/oracle_update.sh
./scripts/oracle_setup.sh <YOUR_DOMAIN_OR_IP.nip.io>
```

Example using `nip.io`:
```bash
./scripts/oracle_setup.sh 140.238.10.20.nip.io
```

### Step 3.3: Launch Shakti + Caddy HTTPS Reverse Proxy
```bash
docker compose up -d --build
```

Verify the deployment:
```bash
docker compose ps
curl -fsS http://127.0.0.1:3000/health
curl -fsS https://<YOUR_DOMAIN>/health
```
Both commands must return:
```json
{"status":"ok","service":"saathi-api","runtime":"node-express-sqlite-drizzle"}
```

---

## 4. Safe Website Updates, Database Backups & Rollbacks

### 4.1: One-Command Safe Update (`scripts/oracle_update.sh`)
Whenever you push changes to your repository (or edit code on the server), update the live website **without losing SQLite user/incident data** by running:
```bash
cd ~/shakti
./scripts/oracle_update.sh
```
What `scripts/oracle_update.sh` does automatically:
1. Runs `VACUUM INTO` inside the running container to snapshot a consistent SQLite backup into `./data/backups/shakti-pre-update-<TIMESTAMP>.db`.
2. Pulls the latest Git commit (`git pull --ff-only`).
3. Rebuilds the Docker image (`docker compose build shakti`) and restarts the container.
4. Polls `http://127.0.0.1:3000/health` for up to 30 seconds to verify the update succeeded.

### 4.2: Manual SQLite Backup & Restore Commands
You can also trigger a live WAL-safe SQLite backup or restore at any time:
```bash
# Create an atomic backup inside the persistent /data/backups directory:
docker compose exec -T shakti npx tsx scripts/db_backup_restore.ts backup /data/backups/manual-backup.db

# Restore from a backup file (stop the app container first to release file locks):
docker compose stop shakti
docker compose run --rm shakti npx tsx scripts/db_backup_restore.ts restore /data/backups/manual-backup.db
docker compose start shakti
```

### 4.3: Automated GitHub Actions Deployment (`.github/workflows/deploy-oracle.yml`)
To automatically deploy whenever you push to `main` (or via the "Run workflow" button in GitHub):
1. In your GitHub repository, go to **Settings -> Secrets and variables -> Actions**.
2. Add three Repository Secrets:
   - `ORACLE_HOST`: Your Oracle VM public IP or domain.
   - `ORACLE_USER`: `ubuntu`
   - `ORACLE_SSH_KEY`: Contents of your private SSH key file.

---

## 5. Android Mobile Application Packaging & Distribution

Shakti supports two complementary Android APK workflows and **Hybrid Local + Remote Operation**:

### 5.1: Option A — Capacitor Standalone + Hybrid Sync APK (Recommended, Included in Repo)
The repository includes a pre-configured Capacitor Android project (`/android`) and an automated GitHub Actions builder (`.github/workflows/build-android-apk.yml`).

1. **Build the APK in GitHub Actions (0 local Android SDK setup required):**
   - Push to `main` or open **Actions -> Build Android APK -> Run workflow** in GitHub.
   - Download the `shakti-android-debug-apk` artifact (`shakti-debug.apk`).
2. **Host the APK directly on your Oracle Server:**
   Copy `shakti-debug.apk` to your server at `~/shakti/public/shakti.apk` and run `./scripts/oracle_update.sh` (or mount it into the container).
   - `GET https://<YOUR_DOMAIN>/apk-status` automatically detects `/shakti.apk` and reports `{ "available": true, "sizeBytes": ... }`.
   - Users visiting your website on Android can tap **"Download Android APK"** to download `https://<YOUR_DOMAIN>/shakti.apk`.
3. **Connect the Installed APK to Your Oracle Server (Hybrid Mode):**
   - Open the installed Android app -> **Settings -> Server Connection & Sync**.
   - Select **Remote Server Sync**, enter `https://<YOUR_DOMAIN>`, and tap **Test & Save HTTPS Server**.
   - The app verifies `GET https://<YOUR_DOMAIN>/health` with a 5-second timeout and syncs queued offline SOS incidents automatically when online, while retaining full offline device tools (Fake Call, Loud Alarm, Calculator Disguise, Offline SOS Queue, and Native SMS/112 Fallback) when disconnected.

### 5.2: Option B — PWABuilder Trusted Web Activity (TWA) Wrapper
If you want a lightweight wrapper around your live HTTPS domain:
1. Ensure your Oracle server is live over HTTPS (`https://<YOUR_DOMAIN>`).
2. Configure `TWA_PACKAGE_NAME` (default `app.shakti.safety`) and `TWA_SHA256_FINGERPRINT` in `.env` on your server so `https://<YOUR_DOMAIN>/.well-known/assetlinks.json` serves your signing key fingerprint.
3. Visit `https://www.pwabuilder.com`, enter `https://<YOUR_DOMAIN>`, and generate the Android TWA package.

### 5.3: Website Updates vs. APK Updates (Crucial Distinction)
- **Website & PWA UI/API updates** deployed via `./scripts/oracle_update.sh` take effect **immediately** for mobile browser users, installed Home-Screen PWAs, and TWA wrappers.
- **Native Capacitor APK updates:** Replacing `/shakti.apk` on your server updates the file for **new downloads**, but **does not automatically overwrite APKs already installed on users' phones** (since sideloaded APKs do not have Google Play auto-update). Users with an older standalone APK must re-download and install `/shakti.apk` when you change bundled Capacitor native plugins or offline assets.

---

## 6. Real-Device Verification Checklist

Before sharing your hosted Oracle Cloud deployment with testers, verify on a physical Android phone:

- [ ] **HTTPS & Padlock:** Open `https://<YOUR_DOMAIN>` in Chrome on Android; verify there are no TLS warnings and `GET /health` returns `{"status":"ok"}`.
- [ ] **Database Isolation Check:** Open `https://<YOUR_DOMAIN>/saathi.db` and `https://<YOUR_DOMAIN>/data/shakti.db` and confirm both return HTTP `404`.
- [ ] **PWA Installability:** Tap **Add to Home screen / Install app** in Chrome and verify Shakti opens in standalone full-screen mode.
- [ ] **APK Download & Hybrid Server Sync:** Download `/shakti.apk` (or install from GitHub Actions artifact), open **Settings -> Server Connection & Sync**, configure `https://<YOUR_DOMAIN>`, and confirm the health check badge turns green.
- [ ] **Offline SOS Delivery State Accuracy:** Turn on **Airplane Mode** and trigger SOS. Verify the UI reports **"Saved on device only"** / **"Queued for server sync"**—never claiming that contacts or emergency services have been notified while offline—and displays direct `112` / `181` / native `sms:` fallback actions.
- [ ] **Reconnect Sync:** Turn off Airplane Mode and verify the queued SOS transitions from `pending` -> `submitted` -> `server_acknowledged`.
