# Phase 10B Report: Calm Support Links on Closed-Alert Screens

- **Calm Support Card**: Rendered `ClosedAlertSupportCard` on all closed-alert states (`RESOLVED`, `CANCELLED`, `EXPIRED`, and masked duress) with identical wording ("Need someone to talk to? See support options") and position.
- **Support-First Resources**: Navigates to `/resources`, prioritizing counseling, legal-aid, One Stop Centre, and 181 entries at top of list.
- **Offline Resilience**: When offline or if resources API fails, displays local constant call links for 181 and 112 with 56px targets.
- **Isolation**: Hidden during active alerts, in disguise mode, and absent from contact/responder pages.
- **Localization**: Full English (`en.json`) and Hindi (`hi.json`) translation coverage.
- **Testing**: `phase10b_support_links.test.tsx` passed (7/7 tests).
