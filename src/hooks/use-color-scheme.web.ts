import { useSyncExternalStore } from 'react';
import { Appearance } from 'react-native';

import { getAppearancePreference, subscribeAppearance } from '@/lib/appearance';

function subscribeSystem(callback: () => void) {
  const subscription = Appearance.addChangeListener(callback);
  return () => subscription.remove();
}

function getSystem() {
  return Appearance.getColorScheme();
}

// The static web build renders on a server with no window and no saved choice,
// so both snapshots fall back to the light default there.
function getServerSnapshot() {
  return 'light' as const;
}

/** The scheme to draw with: the saved preference, or the system's when it is "system". */
export function useColorScheme(): 'light' | 'dark' {
  const preference = useSyncExternalStore(subscribeAppearance, getAppearancePreference, getServerSnapshot);
  const system = useSyncExternalStore(subscribeSystem, getSystem, getServerSnapshot);
  if (preference !== 'system') return preference;
  return system === 'dark' ? 'dark' : 'light';
}
