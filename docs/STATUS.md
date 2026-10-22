# Project Status & Baseline Audit

**Date:** 2026-10-22

## Vitest Baseline Totals
```text
Test Files  36 passed (36)
     Tests  169 passed (169)
```

## Known Open Items
1. Outbound SMS, push notifications, and 112 ERSS gateway currently use mock providers and require production telephony/carrier contracts.
2. Background PWA execution cannot guarantee alert dispatching when the browser tab is fully closed or device is sleeping.
3. Live GPS tracking loop can throttle or pause on mobile operating systems when the browser tab is minimized or device locks.
4. Voice code word and device shake sensors depend on experimental browser APIs, ambient noise, and hardware permissions.
5. In-process background scheduler requires a single container instance; horizontal multi-instance scaling is not supported.
6. Real-time client timestamp metrics remain susceptible to client device clock skews, protected by k >= 5 sample thresholds.
7. Secondary safety tools (fake call, loud alarm) pause when backgrounded and rely strictly on physical hardware media volume.
8. PWA home screen icon and application name cannot be dynamically renamed at runtime when entering Calculator Disguise Mode.
