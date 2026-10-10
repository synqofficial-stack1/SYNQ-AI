# Synq AI — design system

Everything here is read from `src/constants/theme.ts`, `src/global.css`, `app.json` and the
components in `src/components/`. Verified 2026-09-21.

## Tokens (`src/constants/theme.ts`)

**Colors** — two themes, resolved through `useTheme()`:

| Token | Light | Dark |
|---|---|---|
| `text` | `#1a1a1a` | `#ffffff` |
| `background` | `#f5f5f5` | `#0d0d0d` |
| `backgroundElement` | `#ffffff` | `#1a1a1a` |
| `backgroundSelected` | `#f0f0f0` | `#2a2a2a` |
| `textSecondary` | `#666666` | `#b0b0b0` |
| `surface` | `#ffffff` | `#141414` |
| `surfaceRaised` | `#fafafa` | `#1c1c1c` |
| `border` | `#e4e4e4` | `#262626` |
| `borderStrong` | `#d0d0d0` | `#363636` |

**Accents** (`AccentColors`): `primary #d4af37` (gold), `primaryDark #aa8c2c`,
`primaryLight #e8c547`, `success #16a34a`, `error #e5484d`, `warning #f59e0b`.
Gold means "the one action worth taking" — one gold control per screen.

**Spacing**: `half 2`, `one 4`, `two 8`, `three 16`, `four 24`, `five 32`, `six 64`.
**Radius**: `control 8`, `card 12`, `modal 14`, `pill 999`.
**Layout**: `SidebarWidth 240`, `WideBreakpoint 900` (sidebar ↔ top bar), `MaxContentWidth 800`,
`BottomTabInset` per platform.

`app.json` sets `userInterfaceStyle: "dark"` and a `#09090B` splash background: the product is
dark-first, and the auth screens are dark-only by design.

## Typography

`ThemedText` (`src/components/themed-text.tsx`) is the only text primitive. Variants:
`default 16/24`, `small 14/20`, `smallBold 14/20 700`, `caption 12/16`, `link 14`,
`linkPrimary 14 (#3c87f7)`, `code` (mono), `sectionTitle 17/24 600`, `pageTitle 28/34 600`,
`metric 30/34 600`, `title 48`, `subtitle 32`.

Fonts come from `src/global.css` CSS variables on web (`Spline Sans, Inter, system-ui…`) mapped by
`Fonts` in `theme.ts`; native falls back to the system font. The Geist font packages in
`package.json` are **not loaded anywhere**.

## Components

| Component | Role |
|---|---|
| `app-shell.tsx` | Page chrome: sidebar (wide) or top bar + drawer (narrow), route titles, command palette destinations |
| `sidebar.tsx` | Dashboard + departments nav; only Sales and Marketing exist |
| `top-bar.tsx` | Title, search trigger, account menu, sign out |
| `tab-strip.tsx` / `sales-tabs.tsx` | Department sub-navigation (Sales, Cold Call, Follow-ups) |
| `chat-panel.tsx` | Department chat: history, suggestions, input, optional video actions |
| `video-actions.tsx` | Veo generation UI, cost confirmation, playback |
| `primary-button.tsx` | Gold primary action with loading state |
| `text-field.tsx` | App-wide input with focus ring |
| `modal-sheet.tsx` | Centered/edge sheet used for confirmations |
| `file-drop.tsx` | Web-only file drop that converts spreadsheets to CSV |
| `themed-text.tsx` / `themed-view.tsx` | Theme-aware primitives |
| `auth-backdrop.tsx` | Sign-in scene: photographic background, SVG centre scrim, vignette wash, `BrandMark` |
| `auth-card.tsx` | Form column (max 440px) + `AuthHeading` |
| `auth-field.tsx` | Glass input row with leading icon and optional trailing control |
| `auth-buttons.tsx` | `GoldButton`, `GoogleButton`, `OrDivider` |
| `auth-icons.tsx` | Mail, lock, eye, eye-off, arrow, chevron and the Google mark, drawn with `react-native-svg` |
| `charts.tsx` | `ActivityLineChart` (smooth gold line, gradient fill, dashed gridlines, hover/tap tooltip) and `DonutChart`, plus the gold `SERIES_COLORS` ramp |
| `icons.tsx` | The app's SVG icon set — no icon dependency is installed |

## Auth screen system

- Backdrop: `assets/images/login-background.jpg` (a desk at dusk over a city skyline) drawn
  `contentFit="cover"` on a near-black `#09090C` base, then shaded twice so text stays legible over
  it — an SVG `100×100` stretched box carrying one radial "pool" of `#05050A` behind the form, and
  an `expo-linear-gradient` vignette down the page.
- The logo and tagline shrink at ≤600px. There is no corner copy: the photograph carries the
  scene on its own.
- Controls: 58px tall; Google and primary buttons are pills (`radius 999`), inputs are `radius 18`
  glass (`rgba(255,255,255,0.06)` fill, `0.12` border, gold border on focus).
- Copy: tagline is letter-spaced uppercase; errors are plain sentences in `AccentColors.error`.

## Branding

- **Logo assets.** `assets/images/synq-logo.jpg` is the original 108×108 dark badge (building mark
  + the words "SYNQ AI", no transparency). `assets/images/synq-mark.png` is the **building mark
  alone on transparency**, 312×448, derived from that file — the black card and the wordmark
  removed, alpha taken from luminance so the anti-aliased edges survive. The app uses the mark
  everywhere (login screens, sidebar) so the logo sits *in* its surface rather than on a tile.
  Aspect is 312/448 ≈ 0.696: set a height and let width follow, with `contentFit="contain"` and no
  border radius. Use these files; do not redraw the logo. The mark's ceiling is the source — the
  glyph is only 33×50 px in the original, so avoid displaying it much above ~120px tall.
- The launcher icon (`assets/images/icon.png`), splash (`splash-icon.png`) and Android adaptive
  icons are **still the Expo template artwork** — a known gap.
- **Login photography: `assets/images/login-background.jpg`** — 1672×941 JPEG, ~290 KB. The
  only photograph in the project — re-encoded from a 1.8 MB PNG master, since it has no transparency and PNG
  stores a photograph badly. It is bright through the window, so anything placed over it needs the
  scrim layers described above.

## UI conventions

1. One gold action per screen; everything else is quiet.
2. Empty states say what is actually true ("Calling integration not configured") rather than
   inventing sample data.
3. Numbers on screen are derived from the user's own rows — never placeholders.
4. Styles live in a `StyleSheet.create` block at the bottom of the file, using tokens.
5. Responsive: compare `useWindowDimensions().width` against `WideBreakpoint`; wide screens get the
   sidebar and two-column layouts, narrow screens stack and scroll.
6. Dark theme is the design target; light tokens exist but the product ships dark.
