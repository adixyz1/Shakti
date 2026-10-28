# SHAKTI Design System (DESIGN.md)

Use this file as the single source of truth for how SHAKTI looks and reads.
The product name always comes from the i18n key `app.name` and is wrapped in `translate="no"`.

## 1. Product and mood
SHAKTI is a safety tool for women: a one-press emergency request, a small trusted circle, and calm status information.
The interface is a quiet utility. It must feel steady and exact under stress: no marketing language, no decoration, no surprises.
People using it may be frightened, walking, one-handed and in a hurry. Every choice favors clarity over style.

## 2. Visual theme
- Flat, editorial, paper-like. Warm off-white canvas in light mode, deep ink canvas in dark mode.
- Structure comes from 1px lines, spacing and one step of tone between canvas and surface. Nothing floats.
- One interactive color (teal). One emergency color (crimson). Everything else is ink, muted ink and paper.
- Square-ish geometry: 2px radius on everything, 0 on sheets and the SOS button.
- Density is low to medium. One column. The main action sits in the bottom third.

## 3. Color tokens (the only colors allowed; define them in one @theme block)
Start the block with `--color-*: initial;` so no default palette exists.

| Token | Value | Role |
|---|---|---|
| paper | #F3F1EC | Light canvas. Never pure white. |
| surface | #FAF8F4 | Raised surface on light. Still off-white. |
| ink | #0F172A | Primary text on light. |
| muted | #475569 | Secondary text on light. |
| line | #D6D2C8 | 1px borders on light. |
| teal-700 | #0F766E | Interactive primary. |
| teal-800 | #115E59 | Interactive pressed. |
| crimson-800 | #9F1239 | SOS and alarm fill (about 8:1 against light text, meets the 7:1 SOS target). |
| crimson-900 | #881337 | Emergency pressed. |
| night | #020617 | Dark canvas. |
| night-surface | #0B1220 | Dark raised surface. |
| night-line | #1E293B | 1px borders on dark. |
| night-text | #E7E5DF | Off-white text on dark. |

Rules
- Teal for everything interactive. Crimson only for SOS, the alarm and destructive actions. Nothing else is colored.
- No pastel tints, no gradients, no rainbow, no neon, no purple, no pure white (#fff, #ffffff) and no pure black (#000).
- Chips and tags: solid dark fill with light text, or a 1px outline. Status is always text first; color never carries meaning alone.
- Banners: full 1px border or solid fill. Never a colored stripe on one edge.
- Overlay scrim: flat ink at 60 percent. No blur, no frosted glass.
- Check every text and background pair in both themes: 4.5:1 minimum, 7:1 on SOS screens. Enforce with a script.

## 4. Typography
- Latin: Plus Jakarta Sans. Devanagari: Noto Sans Devanagari. Both self-hosted WOFF2, precached by the service worker. No font CDN.
- Never use Inter, Geist or Space Grotesk.
- Scale in px: 14, 16, 18, 22, 28, 36. Body is 16 minimum. Weights 400, 600 and 700 only.
- Line height: English 1.5, Hindi 1.6. Hindi runs 20 to 30 percent longer: check every screen at large text sizes.
- Tabular numbers on the countdown, PIN pad, calculator, phone numbers and timestamps. Keep Latin digits there in Hindi too.

## 5. Shape and depth
- Radius 2px for buttons, fields, chips, cards and toasts. Sheets and the SOS button use 0.
- No shadows of any kind. No glow. No blur.
- Surfaces are separated by a 1px line and a tone step between paper and surface.

## 6. Icons
- A small custom set (about 24 glyphs) on a 24px grid, 2px stroke, square caps and miters. Draw them as inline SVG components.
- Needed glyphs: back, close, plus, phone, bell, location, mic, route, flag, alarm, calculator, lock, globe, chevron, warning, home, circle, map, more, language, sun, moon, wifi, offline.
- No icon package (no Lucide). No emoji. No sparkle icons. No animated arrows.
- Actions always carry a text label. Icon-only buttons need `aria-label`. Decorative icons use `aria-hidden`.

## 7. Motion
- Motion appears only when state changes: a pressed button, the countdown ring, a sheet opening, the alarm strobe.
- Sheet and toast transitions: 150ms, transform and opacity only. Never `transition: all`.
- No hover animations. Hover may change tone only, and only on pointer devices. No scale, lift or slide on hover.
- Alarm strobe flashes no more than 2 times per second. Under reduced motion it becomes a steady crimson screen and the sound continues.
- Skeletons: flat blocks that pulse between two flat tones. Static under reduced motion. No gradient sweep.

## 8. Components
| Component | Spec |
|---|---|
| BigButton | Full width, 72px minimum height, solid fill, visible pressed state. SOS uses crimson-800 and 0 radius. Hold-to-trigger shows a flat progress fill along the button, not an orb or ring. |
| Button | 48px minimum height. Teal fill, 1px outline, or text only. |
| TextField | 48px minimum height, visible label, `inputmode` and `autocomplete` set, paste never blocked, error text beside the field with `role="alert"`. |
| PinPad | 3x4 grid, 64px keys, tabular numbers, no key sound. Every PIN outcome looks identical. |
| Toggle | 48px target, label plus the words On and Off, never color alone. |
| Sheet | From the bottom, 0 radius, focus trapped, closes with Escape and a visible Close button. |
| StatusChip | Solid dark fill or 1px outline, text always visible. |
| StatusLadder | Vertical list of confirmed steps only. Unreached steps stay quiet. |
| CountdownRing | Flat ring or bar plus a large number. Announces at 10, 5, 3, 2 and 1 seconds. |
| Banner | Full width under the top bar. One at a time, most urgent first. |
| Toast | `aria-live="polite"`, 5 seconds, never covers the primary button. |
| Skeleton | SkeletonRow, SkeletonCard, SkeletonMap. Used on every data-loading screen except SOS. |
| EmptyState and ErrorState | One sentence and one action. Error text names the next step. |
| SyncStatus | Count of queued items and the time of the last attempt. |
| BottomNav | Home, Circle, Journeys, Map, More. Labels always visible. |
| TopBar | Title and back button, single line. |

## 9. Layout and states
- One column. Content max width 40rem on phones and tablets, wider only for responder and admin tables.
- Every screen that loads data has four built states: loading (skeleton), empty, error, offline.
- The SOS path never shows a skeleton, spinner or network-dependent element before it can start.
- Admin tables show real data with no decoration.

## 10. Copy rules
- Short, plain sentences. Verbs on buttons.
- Never use em dashes or en dashes. Never use emoji. No checkmark bullets. No sparkle language.
- Do not write sentences shaped like "this is not X, it is Y".
- Only confirmed statuses: Saved on this phone, Sent, Delivered to your circle, Seen by a contact, Acknowledged, Responder assigned, Resolved.
- Never say help is on the way and never show an arrival time.
- Never mention duress, PIN modes or hidden features in any visible text on shared surfaces.
- Be honest about limits in plain words, for example: shake and voice triggers work only while the app is open.

## 11. Banned patterns (all 30 stay out)
Harsh gradients, Lucide icons, pure white background, rainbow coloring, drop shadows, three feature cards in a row, emojis, liquid glass, em dashes, Inter/Geist/Space Grotesk, colored stripes, fake testimonials, bento grids, terminal windows, "it's not X, it's Y" phrasing, checkmark bullets, three pricing tiers, missing real product demos, soft corner radius, purple and black scheme, missing skeleton loaders, radial or orb elements, dot grids, sparkle icons, animated arrows, missing Terms of Service, missing privacy policy, hover animations on everything, neon colors, basic pastels.
Trust comes from three real pages instead of testimonials: Terms of Service, Privacy Policy, and What SHAKTI can and cannot do. Use real product screenshots, never mockups.

## 12. Behavior that the restyle must never change
- Hold-to-trigger SOS, the cancel window, the cancel PIN and duress PIN screens: identical DOM and timing for both PIN outcomes.
- Disguise mode: page title and favicon read Calculator, and no product name appears.
- Offline queue wording, SMS fallback, Call 112 and Call 181 links always visible on emergency screens.
- Every existing `data-testid`, route, translation key and API call stays as it is.
- English and Hindi key sets stay identical.
