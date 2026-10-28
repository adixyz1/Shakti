# Stitch prompts for SHAKTI

Before starting: open Stitch, create a new project, choose Mobile. Paste the whole DESIGN.md as your design system
(if Stitch offers a DESIGN.md import, use it; otherwise paste it in the first prompt). Generate screens one at a time.
Real strings only: copy the wording from your en.json. No lorem ipsum, no invented testimonials, no stock phrases.

## Prefix to put before every screen prompt
Design a mobile screen for SHAKTI, a women's safety app. Follow the pasted DESIGN.md exactly. Warm off-white paper
background, ink text, teal for interactive controls, crimson only for SOS and destructive actions. Flat, no shadows,
no gradients, no blur, no glow, 2px corner radius, 1px lines. Plain sans type with Devanagari support, minimum 16px body.
Custom square-cap line icons only, always next to a text label. No emoji, no em dashes, no checkmark bullets, no sparkles.
One column, the main action in the bottom third, targets at least 48px and 72px for emergency actions.

## Screens (generate in this order)
1. Home, idle: status strip (circle ready, nothing queued, online), one full-width SOS button at the bottom third with a flat hold-to-trigger progress fill and the label "Hold to send SOS", a row of three quiet text buttons (Fake call, Loud alarm, Walk with me), bottom navigation with labels, small footer line that SHAKTI complements 112 and 181.
2. Home, SOS countdown: very large number, flat ring or bar, text "Sending in 5 seconds", PIN pad filling the lower half, and a short hint "Enter your PIN to cancel".
3. SOS active status: vertical StatusLadder with Saved on this phone, Sent, Delivered to your circle, Seen by a contact, Acknowledged, Resolved. Reached steps are solid, unreached steps are quiet outlines. Buttons: I am safe, Call 112, Call 181. Never mention arrival times.
4. Home, offline: full-width banner "You are offline. Your alert is saved on this phone and will send when you open the app with a connection." plus buttons Send by SMS and Call 112.
5. Emergency Circle: skeleton rows state and loaded state, 3 of 5 contacts in escalation order with invite status chips, an Add contact button that opens a bottom sheet.
6. Consent Center: grouped On/Off switches with the words On and Off, one sentence each for what, when and how long data is kept, and a plain note that shake and voice triggers work only while the app is open.
7. Safe Journeys: planner (destination note, duration chips 15, 30, 45, 60, who is told) and the active view with a timer and the buttons Check in, Extend, End safely. Include the line "SHAKTI cannot see your location during a walk."
8. Hazard Map: map area with grouped markers, a list alternative, a Report button, and the report sheet with six categories.
9. Helplines: list with 112, 181 and verified 24x7 lines, each with a last verified date and a large Call button.
10. Settings: account, cancel PIN, second safety PIN, triggers, countdown length, language, disguise mode, export data, delete account.
11. Sign in: language switch, phone field, code field, Continue at the bottom, footer links to Terms and Privacy.
12. Legal: Terms of Service, Privacy Policy and What SHAKTI can and cannot do, as plain readable documents with headings and short paragraphs.
13. Contact view (no account): who is asking for help, live location card, Acknowledge, Call, I cannot help right now, Call 112.
14. Desktop responder queue and desktop admin analytics: dense tables with real columns, no decoration, status chips solid or outlined.
15. Hindi versions of screens 1 and 3 to check text overflow.

## After each screen
Ask Stitch: "List every place this screen uses a shadow, gradient, blur, rounded corner larger than 2px, pure white, emoji or icon library, and fix them."
If a screen drifts, use the Edit tab to fix one element at a time, not a full regeneration.

## Export
1. Select all screens you want to export (the export controls appear only when screens are selected).
2. Export the DESIGN.md Stitch generated, and compare it with this one. Keep this one as the source of truth.
3. Export each screen as a PNG at the highest resolution as a backup, and use Export to AI Studio if it is available on your account.
Stitch's generated HTML will probably use its own defaults (rounded corners, shadows, an icon library). Treat it as a layout reference only.
