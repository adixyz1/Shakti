---
name: Paper Utility
colors:
  surface: '#FAF8F4'
  surface-dim: '#dcdad5'
  surface-bright: '#fbf9f4'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f5f3ee'
  surface-container: '#f0eee9'
  surface-container-high: '#eae8e3'
  surface-container-highest: '#e4e2dd'
  on-surface: '#1b1c19'
  on-surface-variant: '#3e4947'
  inverse-surface: '#30312e'
  inverse-on-surface: '#f3f1ec'
  outline: '#6e7977'
  outline-variant: '#bdc9c6'
  surface-tint: '#006a63'
  primary: '#005c55'
  on-primary: '#ffffff'
  primary-container: '#0f766e'
  on-primary-container: '#a3faef'
  inverse-primary: '#80d5cb'
  secondary: '#216963'
  on-secondary: '#ffffff'
  secondary-container: '#a8ece5'
  on-secondary-container: '#266d68'
  tertiary: '#a0133a'
  on-tertiary: '#ffffff'
  tertiary-container: '#c23050'
  on-tertiary-container: '#ffe4e5'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#9cf2e8'
  primary-fixed-dim: '#80d5cb'
  on-primary-fixed: '#00201d'
  on-primary-fixed-variant: '#00504a'
  secondary-fixed: '#abefe8'
  secondary-fixed-dim: '#8fd3cc'
  on-secondary-fixed: '#00201e'
  on-secondary-fixed-variant: '#00504b'
  tertiary-fixed: '#ffd9dc'
  tertiary-fixed-dim: '#ffb2ba'
  on-tertiary-fixed: '#400010'
  on-tertiary-fixed-variant: '#910130'
  background: '#fbf9f4'
  on-background: '#1b1c19'
  surface-variant: '#e4e2dd'
  paper: '#F3F1EC'
  ink: '#0F172A'
  muted: '#475569'
  line: '#D6D2C8'
  teal-700: '#0F766E'
  teal-800: '#115E59'
  crimson-800: '#9F1239'
  crimson-900: '#881337'
  night: '#020617'
  night-surface: '#0B1220'
  night-line: '#1E293B'
  night-text: '#E7E5DF'
typography:
  display:
    fontFamily: Plus Jakarta Sans
    fontSize: 36px
    fontWeight: '700'
    lineHeight: 44px
  display-mobile:
    fontFamily: Plus Jakarta Sans
    fontSize: 32px
    fontWeight: '700'
    lineHeight: 40px
  headline-lg:
    fontFamily: Plus Jakarta Sans
    fontSize: 28px
    fontWeight: '700'
    lineHeight: 36px
  headline-md:
    fontFamily: Plus Jakarta Sans
    fontSize: 22px
    fontWeight: '600'
    lineHeight: 30px
  headline-sm:
    fontFamily: Plus Jakarta Sans
    fontSize: 18px
    fontWeight: '600'
    lineHeight: 26px
  body-lg:
    fontFamily: Plus Jakarta Sans
    fontSize: 18px
    fontWeight: '400'
    lineHeight: 28px
  body-base:
    fontFamily: Plus Jakarta Sans
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
  label-lg:
    fontFamily: Plus Jakarta Sans
    fontSize: 16px
    fontWeight: '600'
    lineHeight: 24px
  label-sm:
    fontFamily: Plus Jakarta Sans
    fontSize: 14px
    fontWeight: '600'
    lineHeight: 20px
  caption:
    fontFamily: Plus Jakarta Sans
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
spacing:
  gutter: 1rem
  margin: 1rem
  space-xs: 0.25rem
  space-sm: 0.5rem
  space-md: 1rem
  space-lg: 1.5rem
  space-xl: 2rem
---

## Brand & Style

The design system represents a calm, high-contrast, flat editorial utility engineered specifically for critical safety operations. Its primary purpose is to provide immediate, unambiguous, and dependable interactions under acute physical and emotional stress. The interface addresses users who may be navigating dimly lit streets, walking briskly, operating devices one-handed, or facing imminent danger.

Drawing inspiration from editorial paper utilities and structural administrative forms, the design system explicitly rejects modern digital consumer tropes: there are no drop shadows, no liquid glass or skeuomorphic blurs, no decorative illustrations, and no gradient fills. Hierarchy is established entirely through precise 1px hairline rules, calculated tonal contrast between canvas and surface tiers, and disciplined typography.

The tone is understated, honest, and unshakeable. It communicates absolute mechanical reliability. Every element exists to shorten the distance between human intention and critical execution.

## Colors

The color system operates under strict functional partitioning. No decorative or marketing palettes exist.

- `paper` (`#F3F1EC`) forms the foundational canvas in light mode. Pure white (`#FFFFFF`) is prohibited across all layouts to eliminate harsh screen glare during nighttime use.
- `surface` (`#FAF8F4`) sits one tonal step above `paper`, providing a resting ground for structured components and cards.
- `ink` (`#0F172A`) serves as primary foreground text and structural graphics.
- `muted` (`#475569`) provides secondary informational hierarchy, meta-labels, and non-actionable descriptors.
- `line` (`#D6D2C8`) defines all component borders, hairlines, and grid dividers at exactly 1px.
- `teal-700` (`#0F766E`) and its pressed state `teal-800` (`#115E59`) govern all regular interactive controls, buttons, toggles, and highlights.
- `crimson-800` (`#9F1239`) and pressed state `crimson-900` (`#881337`) are reserved exclusively for emergency triggers (SOS), immediate duress actions, and irreversible destructive operations. This achieves at least an 8:1 contrast ratio against light backgrounds, exceeding the 7:1 accessibility threshold required for emergency states.
- Dark mode inverses this architecture through `night` (`#020617`), `night-surface` (`#0B1220`), `night-line` (`#1E293B`), and `night-text` (`#E7E5DF`).

Pure black (`#000000`), pure white (`#FFFFFF`), arbitrary color ramps, and multi-colored status badges are strictly excluded.

## Typography

The type system prioritizes immediate legibility and optical density. Latin typography relies on Plus Jakarta Sans, while Devanagari text uses Noto Sans Devanagari. Standard tech sans typefaces such as Inter, Geist, and Space Grotesk are forbidden to preserve the editorial paper identity.

To maintain accessibility during high-stress scenarios:
- Base body copy is strictly bounded to a minimum size of 16px.
- Line height is fixed at 1.5 for English and expanded to 1.6 for Hindi scripts to prevent vertical clipping of matras.
- Tabular figures (`font-variant-numeric: tabular-nums`) are mandatory on all countdown displays, PIN entry pads, phone numbers, clock timers, and coordinates. Latin digits persist across both English and Hindi locales on numeric grids.
- Em dashes, en dashes, emoji characters, and checkmark glyphs are strictly forbidden in UI text. All visual confirmations rely on explicit words or dedicated inline geometric iconography.

## Layout & Spacing

Layouts follow a single-column, mobile-first mental model with a strict maximum container width of 40rem (640px) on consumer hand-held viewports. Expanded multi-column table layouts are strictly reserved for desktop responder consoles and incident management dashboards.

Key structural rules:
- Primary interactive actions are anchored within the lower third of the viewport to accommodate one-handed thumb reach during walking or movement.
- A standard 4px spatial rhythm governs all padding and element separation (`space-xs` = 4px, `space-sm` = 8px, `space-md` = 16px, `space-lg` = 24px, `space-xl` = 32px).
- Minimum tap targets are 48px high for standard controls and 72px high for emergency or hold-to-activate controls.
- Three-column marketing feature cards and bento grids are forbidden architectural patterns. Information flows vertically in sequential order.

## Elevation & Depth

This design system is strictly flat. Box shadows, drop shadows, ambient blurs, frosted glass backdrops, glow effects, and skeuomorphic highlights are completely banned.

Physical layering and structural depth are achieved exclusively through:
1. **Tonal separation:** Alternating between `paper` (`#F3F1EC`) for page foundations and `surface` (`#FAF8F4`) for interactive groupings and cards.
2. **Hairline boundaries:** Crisp, unvarying 1px structural borders using `line` (`#D6D2C8`) on light surfaces or `night-line` (`#1E293B`) on dark surfaces.
3. **Modal scrims:** Full-screen overlays utilize a flat 60% opacity fill of `ink` (`#0F172A`) without any backdrop filter or blur applied.

Surface hierarchy communicates containment rather than simulated elevation off the screen plane.

## Shapes

The geometric signature is square-ish and utilitarian. Fully rounded pill buttons, circular badges, and large consumer radii are prohibited.

- Components (buttons, inputs, cards, notification banners, chips, and toasts) standardize on a sharp 2px corner radius.
- Sheets, full-width emergency banners, and primary SOS buttons employ an absolute 0px radius (`rounded-none`), docking flush with device borders and structural division lines.
- Borders are uniformly 1px in width. Double borders, decorative dashed strokes, or uneven border widths are forbidden.

## Components

### Buttons
- **BigButton (Emergency SOS):** Full-width, minimum 72px height, 0px radius. Rendered in solid `crimson-800` with `surface` text. Hold-to-trigger state renders a linear, flat progress bar fill traveling across the horizontal button face; radial progress indicators or pulsing glows are prohibited.
- **Button (Standard):** Minimum 48px height, 2px radius. Three visual tiers: Primary (`teal-700` fill with `surface` text, shifting to `teal-800` on press), Secondary (1px `line` border, transparent background, `ink` text), and Tertiary/Quiet (plain text with no background or border). Verbs drive button labels.

### Input Fields & PIN Entry
- **TextField:** Minimum 48px height, 2px radius, 1px `line` border, `surface` background fill. Visible text label permanently positioned above field. In-line error text renders beneath with an explicit `role="alert"`. Copy-paste functionality is never blocked.
- **PinPad:** 3x4 structured grid of 64px square keys using tabular numbers. Cancellation PIN and duress safety PIN interactions share identical visual responses, sound suppression, and transition durations to prevent shoulder-surfing detection.

### Status Indicators & Chips
- **StatusChip:** 2px radius, 1px hairline border or solid dark ink fill. Color never carries meaning independently; an explicit textual label is mandatory. Checkmark glyphs (`✓`) are banned.
- **StatusLadder:** A vertical progression displaying only confirmed physical states (e.g., *Saved on this phone*, *Sent*, *Delivered to your circle*, *Acknowledged*, *Resolved*). Confirmed steps use solid ink indicators; unreached steps use quiet hairline outlines. Estimated arrival times or "help is on the way" conjectures are strictly disallowed.

### Overlays, Sheets & Banners
- **Sheet:** Slides upward from the bottom edge with 0px radius. Always features a visible text-based close button and supports hardware Escape key dismissals.
- **Banner:** Full-width container placed directly below top app bar with a 1px border. Rendered in single occurrences with prioritized severity.
- **Toast:** Emits `aria-live="polite"` for non-critical updates. Automatically dismisses after 5 seconds and never obstructs primary touch targets in the lower third of the screen.

### Iconography
- Third-party icon packs (Lucide, Heroicons, Phosphor) are excluded.
- Handled via custom inline 24px SVG components rendered with 2px constant strokes, square line caps, and miter joins. Icons never stand alone as interactive controls without an accompanying text label or mandatory `aria-label`.