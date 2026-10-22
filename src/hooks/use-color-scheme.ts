import { useSyncExternalStore } from 'react';
import { useColorScheme as useSystemColorScheme } from 'react-native';

import { getAppearancePreference, subscribeAppearance } from '@/lib/appearance';

/** The scheme to draw with: the saved preference, or the system's when it is "system". */
export function useColorScheme(): 'light' | 'dark' {
  const preference = useSyncExternalStore(subscribeAppearance, getAppearancePreference, getAppearancePreference);
  const system = useSystemColorScheme();
  if (preference !== 'system') return preference;
  return system === 'dark' ? 'dark' : 'light';
}
