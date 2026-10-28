# Engineering Limitations & Prototype Disclaimers

This document provides a realistic, unembellished assessment of the technical boundaries, prototype implementations, and operational limitations of the SHAKTI safety platform.

---

## 1. Prototype Status & Mock Integrations

- **Simulated External Gateways**: The current implementation is a functioning software prototype. Outbound **SMS alerts**, **push notifications**, **OTP delivery**, and the **112 Emergency Response Support System (ERSS)** gateway are backed by mock providers (`MockSmsProvider`, `MockOtpProvider`, `MockEmergencyGateway`). In development, outbound messages are routed to an in-memory test outbox (`/api/dev/outbox`) rather than a live telecom operator or government emergency gateway.
- **Production Prerequisites**: Production deployment requires contracting certified SMS/telephony carriers, obtaining authorized API access to national emergency dispatch systems (ERSS 112 / Women Helpline 181), and undergoing rigorous third-party legal, agency, and cybersecurity audits.

---

## 2. Connectivity & Background Execution Constraints

- **Offline Queuing Behavior**: Alerts triggered while offline are safely queued in client-side storage (`IndexedDB`). However, because standard browser PWAs without native OS background sync permissions cannot guarantee background background-sync execution, queued alerts are dispatched to the server **only when the web application is actively opened and online in a browser tab**.
- **Background Location Pauses**: Mobile browsers and operating systems aggressively throttle or suspend JavaScript execution and Geolocation APIs when a tab is in the background, minimized, or when the phone screen is locked/sleeping. Consequently, live GPS tracking—including the silent duress location loop—**can pause or cease updating when the application is backgrounded or the device sleeps**.

---

## 3. Hardware Triggers & Browser Sensor Variability

- **Sensor Reliability**: Discreet triggers such as **device shake**, **voice code word recognition**, and **power button / volume button actions** depend heavily on individual device hardware, accelerometer sensitivity, ambient noise, operating system permissions, and browser implementation:
  - The Web Speech API is experimental, requires explicit microphone permissions, and may not operate reliably offline or in loud environments.
  - Shake detection requires DeviceMotion permissions which mobile Safari and modern Chromium browsers may restrict or prompt for.
  - Hardware buttons (power/volume) cannot be intercepted by web browsers or PWAs.

---

## 4. Emergency & Physical Response Realism

- **No Safety Guarantee**: SHAKTI provides technology for alerting and communication; it **cannot guarantee personal physical safety, responder arrival, or specific response times**.
- **Complementary System**: SHAKTI is designed to complement official emergency mechanisms. It **never replaces dialling 112 or 181 directly** during an imminent life-threatening emergency.
- **Response Team Availability**: Alerts to campus security or community responders assume that those responders are on duty, monitoring the dashboard, and physically equipped to assist. SHAKTI makes no claims regarding actual physical intervention capabilities.

---

## 5. Metrics & Client Clock Discrepancies

- All response time, arrival, and escalation metrics recorded in the database are measured based on server-received timestamps and client-reported GPS intervals. Inaccurate or manipulated client device clocks can skew client-side timestamps. Metrics thresholds enforce $k \ge 5$ sampling minimums to protect aggregate confidentiality.

---

## 6. Access Control & Admin Visibility

- Safety administrators have access to incident-level audit entries (`incident_access_audit`) to review operational handling. Because administrators can see which responders accessed an incident and at what time, **administrative access must be tightly controlled** and restricted to vetted personnel with strong multi-factor authentication.

---

## 7. Storage Key & Schema Naming Legacy

- Certain client-side storage keys, session cookies (`saathi_access`, `saathi_refresh`), and the client IndexedDB database (`saathi_offline_db`) still retain the original internal project prefix (`saathi_*`). These names are internal implementation details and do not affect user privacy, but are documented here for technical clarity.

---

## 8. Disguise Mode & Home Screen Limitations

- **Home Screen App Icon & Name**: When installed as a PWA on a mobile home screen, the operating system assigns the application name and icon chosen at the time of installation. Entering "Calculator Disguise Mode" within the web view transforms the in-app screen into a functioning calculator, but **does not dynamically alter the operating system home screen icon or application title**. Users in hostile environments are advised to assign a neutral label during home screen installation.
- **Client Hash Exposure via DevTools**: The disguise PIN unlock sequence and the voice code word are stored locally as salted PBKDF2 hashes (200,000 iterations). While they are never stored in plaintext, an adversary with physical access to the device and developer tools or browser storage inspection could extract the salt and hash to attempt an offline brute-force or dictionary attack.

---

## 9. Anonymity Boundaries

- The $k$-anonymity threshold ($k \ge 5$), coarse geo-binning, and daily submission limits applied to community hazard reports significantly reduce the likelihood of re-identification, but **do not completely eliminate re-identification risks** in sparsely populated regions or isolated incidents where external context (e.g., local news reports) may correlate with a specific time and location.

---

## 10. Audit & Lighthouse Benchmarking

- Lighthouse performance and PWA scores vary depending on network throttling, host hardware, and device CPU, and have not yet been recorded for formal benchmarking. Real-world deployment will require independent load testing, performance auditing, and compliance certification before deployment in high-stakes environments.

---

## 11. Secondary Safety Tools (Fake Call & Loud Alarm)

- **Background Timer Pauses**: In mobile web browsers, JavaScript timers (`setTimeout`/`setInterval`) are throttled or suspended when the device screen locks or the browser tab is sent to the background. Therefore, the fake incoming call countdown timer pauses if the phone locks or the app goes to the background, and resumes when brought back to the foreground.
- **Device Volume & Silent Switch Control**: Web Audio API synthesis output is governed strictly by the physical device's master media volume and operating system audio profiles. The web application cannot override hardware volume buttons, hardware mute switches, or operating system "Do Not Disturb" / silent profiles. Users must ensure device volume is turned up for the loud alarm to be effective.

---

## 12. Guest Mode Boundaries

- **Device-Only Data Storage**: Guest emergency contacts, trigger preferences, and device cancel PIN hashes are stored solely within the local browser IndexedDB (`saathi_offline_db`) and localStorage. This data is never synchronized to the server and cannot be recovered if the browser storage or site cookies are erased, or if private / incognito browsing is used.
- **Local Cancel PIN Storage**: The local cancel PIN is a salted hash on the device and could be guessed by someone with developer-tools access.
- **SMS Fallback Without Silent Escalation**: Guest SOS operates strictly on the device with zero server API interaction. When the cancel window elapses, the application builds emergency SMS messages using the phone's native messaging application (`sms:` protocol). Because it is not connected to a server account, guest SOS cannot silently dispatch notifications or trigger server-side automated escalations.
- **Duress Protection Requires a Server Account**: The silent duress safety PIN is unavailable in Guest Mode. Silent duress signaling relies on server-authoritative state transitions, real-time responder dispatch, and background tracking continuity that cannot function without a verified account.

---

## 13. Safety Tools Guide & Outbound Links
- **No Endorsement or Safety Guarantee**: Tools cataloged in the Safety Tools guide (e.g., personal alarm keychains, whistles, torch keyrings, portable door alarms, pepper spray) are provided strictly as educational and informational references. SHAKTI does not manufacture, sell, warrant, or endorse any specific tool or supplier. Possessing or carrying a safety device does not guarantee personal safety.
- **No Click Tracking or Purchase Records**: SHAKTI does not track outbound clicks, referral pathways, or browsing activities, and stores zero purchase, payment, cart, or checkout data.
- **Outbound Links Leave the Application**: Outbound links redirect to third-party web destinations that operate independently under their own privacy policies and terms of service.
- **Jurisdictional & Regulatory Differences**: Laws and carriage rules for personal safety devices (such as pepper spray or alarms) vary across jurisdictions, transit authorities, aviation rules, and institutional premises, and may evolve over time. Users must verify local regulations independently.


