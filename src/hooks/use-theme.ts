import { Colors, type Theme } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

/** The active palette. Read colours from here, not from `Colors` directly. */
export function useTheme(): Theme {
  return Colors[useColorScheme()];
}
