/**
 * Below are the colors that are used in the app. The colors are defined in the light and dark mode.
 * There are many other ways to style your app. For example, [Nativewind](https://www.nativewind.dev/), [Tamagui](https://tamagui.dev/), [unistyles](https://reactnativeunistyles.vercel.app), etc.
 */

import '@/global.css';

import { Platform } from 'react-native';

export const Colors = {
  light: {
    text: '#1a1a1a',
    background: '#f5f5f5',
    backgroundElement: '#ffffff',
    backgroundSelected: '#f0f0f0',
    textSecondary: '#666666',
    // Surfaces sit on top of `background`; `border` is the hairline that
    // separates them. Cards lean on these two instead of shadows.
    surface: '#ffffff',
    surfaceRaised: '#fafafa',
    border: '#e4e4e4',
    borderStrong: '#d0d0d0',
  },
  dark: {
    text: '#ffffff',
    background: '#0d0d0d',
    backgroundElement: '#1a1a1a',
    backgroundSelected: '#2a2a2a',
    textSecondary: '#b0b0b0',
    surface: '#141414',
    surfaceRaised: '#1c1c1c',
    border: '#262626',
    borderStrong: '#363636',
  },
} as const;

export const AccentColors = {
  primary: '#d4af37',  // Gold
  primaryDark: '#aa8c2c',  // Darker gold
  primaryLight: '#e8c547',  // Lighter gold
  success: '#16a34a',
  error: '#e5484d',
  warning: '#f59e0b',
} as const;

export type ThemeColor = keyof typeof Colors.light & keyof typeof Colors.dark;

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

export const Radius = {
  control: 8,
  card: 12,
  modal: 14,
  pill: 999,
} as const;

export const SidebarWidth = 240;

/** Below this the sidebar stops being a column and becomes a top bar. */
export const WideBreakpoint = 900;
