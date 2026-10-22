import { Platform, useWindowDimensions, type ViewStyle } from 'react-native';

import { CompactBreakpoint, Motion, WideBreakpoint } from '@/constants/theme';

/** `#RRGGBB` → `rgba(r, g, b, a)`. Anything else is returned unchanged. */
export function alpha(hex: string, value: number): string {
  const match = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!match) return hex;
  const int = parseInt(match[1], 16);
  return `rgba(${(int >> 16) & 255}, ${(int >> 8) & 255}, ${int & 255}, ${value})`;
}

/**
 * Hover and press changes ease in on the web instead of snapping. React Native
 * Web passes these through; the types do not know about them, hence the cast.
 */
export const transition: ViewStyle = Platform.select({
  web: {
    transitionProperty: 'background-color, border-color, color, opacity, box-shadow',
    transitionDuration: `${Motion.fast}ms`,
    transitionTimingFunction: 'ease-out',
  } as unknown as ViewStyle,
  default: {},
});

/** Layout breakpoints, so every screen agrees on what "phone" and "desktop" mean. */
export function useBreakpoint() {
  const { width } = useWindowDimensions();
  return {
    width,
    /** Persistent sidebar, multi-column layouts. */
    isWide: width >= WideBreakpoint,
    /** Single column, stacked forms, tables as cards. */
    isCompact: width < CompactBreakpoint,
  };
}

/** A soft card shadow for floating surfaces (menus, dialogs) only. */
export function floatingShadow(color: string): ViewStyle {
  return {
    shadowColor: color,
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.14,
    shadowRadius: 28,
    elevation: 12,
  };
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  return parts[0][0].toUpperCase();
}
