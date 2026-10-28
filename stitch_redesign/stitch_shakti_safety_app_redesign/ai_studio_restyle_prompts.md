# AI Studio restyle prompts for SHAKTI

Use these in your EXISTING AI Studio project. Do not start a new project from the Stitch export, because the working app,
its 187 tests and its safety behavior live in the current project. Send the prompts one at a time, in a fresh chat if turns get slow.
After each step wait for the report, check it, then continue.

Common rules to include at the top of every prompt:
"Rules: this is a visual restyle only. Do not change behavior, routes, API calls, translation keys or any data-testid.
Keep English and Hindi key sets identical. Small batches. Run only the tests you touched, then the full suite once at the end.
Report under 15 lines. Never use em dashes, emojis or checkmark glyphs in anything you write."

## R0: setup (no restyling yet)
1. Add DESIGN.md to the project root and scripts/slop-check.mjs, plus an npm script "slop": "node scripts/slop-check.mjs".
2. Run `npm run slop -- --report` and paste only the "Findings by rule" counts. This is our to-do list.
3. Check and report: are fonts loaded from a CDN (Google Fonts)? Where is the retention default for location samples set? List every place the UI says "on the way" or shows an arrival time. Do not change anything.

## R1: tokens, fonts, icons, primitives
Reference images: attach the Stitch screens for Home and SOS countdown.
1. Create src/styles/tokens.css with the @theme block from DESIGN.md, starting with `--color-*: initial;`. Add dark values.
2. Self-host Plus Jakarta Sans and Noto Sans Devanagari as WOFF2 (subset, OFL licensed), add them to the service worker precache, and remove any font CDN link.
3. Replace lucide-react with a small inline SVG icon set (24px grid, 2px stroke, square caps) for the glyphs listed in DESIGN.md. Remove the package from package.json.
4. Restyle the shared primitives (BigButton, Button, Input, Card, Modal, Toast, BottomNav, Spinner, Skeleton) to the DESIGN.md specs. Add Sheet, StatusChip, StatusLadder, Banner, EmptyState and ErrorState if missing.
5. Run the slop check and the primitive tests. Done when the findings in shared components are zero.

## R2: shell and SOS screens
Reference images: Stitch screens 1 to 4.
Restyle PageLayout (top bar, bottom nav, footer), Home idle, the cancel window with the PIN pad, the live status screen and the offline state.
Replace the round SOS button with the full-width flat hold-to-trigger button (keep the testid sos-hold-button and the 2 second hold behavior).
Replace any "Help is on the way" or arrival wording with the confirmed statuses in DESIGN.md section 10.
Duress parity: the page after a cancel PIN and after the second safety PIN must have identical DOM and timing. Add a test that compares them.

## R3: user screens
Reference images: Stitch screens 5 to 11, 15.
Restyle Circle, Consent Center, Journeys, Reports and map, Resources, Pulse, Settings, Login and Welcome. Every data screen gets a skeleton, an empty, an error and an offline state (SOS excluded).
Remove marketing-style hero copy from Welcome; show the plain purpose, the 112 and 181 links, the privacy line and a real screenshot of Home (use Playwright to capture it, never a mockup).

## R4: other roles and stealth tools
Reference images: Stitch screens 13 and 14.
Restyle the contact view, responder console and admin pages, then the calculator disguise, fake call and loud alarm screens. Alarm strobe stays at 2 flashes per second or less, steady crimson under reduced motion. Disguise mode must still show no product name.

## R5: legal pages and copy cleanup
1. Add /legal/terms, /legal/privacy and /legal/limits (keep /policy working as an alias to privacy). Link them from Sign in, Consent Center and Settings. Cache them offline.
2. Draft plain-language Terms of Service and a limits page from the facts in LIMITATIONS.md. Mark them "Draft for legal review" in the report, not on the page.
3. Make the privacy text match the code. Location retention is currently configured as your R0 report states; either change the configured default or change the text, and tell me which you chose.
4. Remove every em dash, en dash, emoji and checkmark glyph from en.json, hi.json and components. Remove "not X, it is Y" constructions.

## R6: gates
1. `npm run slop` must report zero findings (waivers with a reason only).
2. Add a contrast test over the tokens for light and dark (4.5:1 text, 7:1 on SOS surfaces).
3. Run the full Vitest suite and `npm run e2e` (13 tests). Fix regressions in the code, not by weakening tests.
4. Run axe in Playwright for the main screens in English and Hindi, light and dark.
5. Capture Playwright screenshots at 360x640, 390x844 and 768 wide, light and dark, English and Hindi, reduced motion on, into docs/screenshots/.
6. Review the changed UI code against the Vercel web-interface guidelines (fetch the current rules from the vercel-labs/web-interface-guidelines repository) and list findings as fixed or waived with a reason.
