import '@/global.css';

import { Platform } from 'react-native';

// The workspace palette. Light is the default: warm ivory pages, white cards,
// near-black text, and one warm yellow that is kept for the things a person is
// meant to act on — the primary button, the selected nav item, focus, and the
// odd highlight. Cards are separated by hairline borders rather than shadows.
//
// Yellow is a fill colour only. Yellow text on white is unreadable, so anything
// that needs to *read* as gold (a link, a "selected" label) uses `accentText`,
// which is a darker gold in light mode and the yellow itself in dark mode.

export const Colors = {
  light: {
    text: '#171717',
    // Warm grey that still clears 4.5:1 on the secondary surface, not just on white.
    textSecondary: '#6B6862',
    // Placeholders and timestamps only; never body copy.
    textTertiary: '#8C887F',
    background: '#F8F6F1',
    backgroundElement: '#FFFFFF',
    backgroundSelected: '#F2EFE8',
    surface: '#FFFFFF',
    surfaceRaised: '#F2EFE8',
    border: '#E8E4DC',
    borderStrong: '#D8D2C6',
    accent: '#FFD45A',
    accentHover: '#EAB938',
    accentSoft: '#FFF5D6',
    accentBorder: '#F0CF6E',
    accentText: '#8A6400',
    onAccent: '#171717',
    success: '#15803D',
    successSoft: '#E7F4EA',
    warning: '#B45309',
    warningSoft: '#FCF0E1',
    danger: '#C62828',
    dangerSoft: '#FBEAEA',
    info: '#1D5FD1',
    infoSoft: '#E8EFFC',
    overlay: 'rgba(23, 23, 23, 0.42)',
    shadow: '#1B1A16',
  },
  dark: {
    text: '#F5F4F0',
    textSecondary: '#A9A59C',
    textTertiary: '#7E7A72',
    background: '#0F0F0E',
    backgroundElement: '#1A1A18',
    backgroundSelected: '#262522',
    surface: '#171716',
    surfaceRaised: '#201F1D',
    border: '#2A2926',
    borderStrong: '#3A3834',
    accent: '#FFD45A',
    accentHover: '#EAB938',
    accentSoft: 'rgba(255, 212, 90, 0.12)',
    accentBorder: 'rgba(255, 212, 90, 0.42)',
    accentText: '#FFD45A',
    onAccent: '#171717',
    success: '#4ADE80',
    successSoft: 'rgba(74, 222, 128, 0.12)',
    warning: '#FBBF24',
    warningSoft: 'rgba(251, 191, 36, 0.12)',
    danger: '#F87171',
    dangerSoft: 'rgba(248, 113, 113, 0.12)',
    info: '#60A5FA',
    infoSoft: 'rgba(96, 165, 250, 0.12)',
    overlay: 'rgba(0, 0, 0, 0.6)',
    shadow: '#000000',
  },
} as const;

export type ThemeColor = keyof typeof Colors.light & keyof typeof Colors.dark;
export type Theme = { [K in ThemeColor]: string };

/**
 * The sidebar stays near-black in both themes — it is the brand's one dark
 * surface, and the yellow reads best against it.
 */
export const SidebarColors = {
  background: '#111210',
  raised: '#1B1C19',
  hover: 'rgba(255, 255, 255, 0.06)',
  border: 'rgba(255, 255, 255, 0.08)',
  text: '#F5F4F0',
  textSecondary: '#A9A59C',
  activeBackground: 'rgba(255, 212, 90, 0.13)',
  activeBorder: 'rgba(255, 212, 90, 0.38)',
  accent: '#FFD45A',
} as const;

/**
 * Fixed accent values for places that are not themed (the auth scene, native
 * chrome). Inside the app prefer the theme's `accent`/`accentText` and status
 * colours, which are tuned per theme.
 */
export const AccentColors = {
  primary: '#FFD45A',
  primaryHover: '#EAB938',
  primaryDark: '#8A6400',
  primaryLight: '#FFE28A',
  success: '#16A34A',
  error: '#DC2626',
  warning: '#D97706',
  info: '#2563EB',
} as const;

/**
 * Series and department colours: Sales gold, Marketing violet, Company blue.
 * Used for chart lines, department icon tiles and legends — never for buttons.
 */
export const DataColors = {
  sales: '#E0A800',
  marketing: '#B44FE0',
  company: '#2F7BEA',
  neutral: '#8C887F',
} as const;

export const Fonts = Platform.select({
  ios: {
    /** iOS `UIFontDescriptorSystemDesignDefault` */
    sans: 'system-ui',
    /** iOS `UIFontDescriptorSystemDesignSerif` */
    serif: 'ui-serif',
    /** iOS `UIFontDescriptorSystemDesignRounded` */
    rounded: 'ui-rounded',
    /** iOS `UIFontDescriptorSystemDesignMonospaced` */
    mono: 'ui-monospace',
  },
  default: {
    sans: 'normal',
    serif: 'serif',
    rounded: 'normal',
    mono: 'monospace',
  },
  web: {
    sans: 'var(--font-display)',
    serif: 'var(--font-serif)',
    rounded: 'var(--font-rounded)',
    mono: 'var(--font-mono)',
  },
});

/** A 4px scale. */
export const Spacing = {
  half: 2,
  one: 4,
  two: 8,
  three: 16,
  four: 24,
  five: 32,
  six: 64,
} as const;

export const BottomTabInset = Platform.select({ ios: 50, android: 80 }) ?? 0;
export const MaxContentWidth = 800;
/** The widest a page's content gets before it centres. */
export const PageMaxWidth = 1360;

export const Radius = {
  control: 10,
  card: 16,
  modal: 18,
  pill: 999,
} as const;

/** Hover, focus and press transitions. Short enough to feel immediate. */
export const Motion = { fast: 150, base: 200 } as const;

export const SidebarWidth = 240;
export const SidebarCollapsedWidth = 76;

/** Below this the sidebar stops being a column and becomes a drawer. */
export const WideBreakpoint = 900;
/** Below this a page drops to one column and tables become cards. */
export const CompactBreakpoint = 640;
