import { useSyncExternalStore } from 'react';
import { Appearance } from 'react-native';

function subscribe(callback: () => void) {
  const subscription = Appearance.addChangeListener(callback);
  return () => subscription.remove();
}

function getSnapshot() {
  return Appearance.getColorScheme();
}

function getServerSnapshot() {
  return 'light' as const;
}

/**
 * To support static rendering, this value needs to be re-calculated on the client side for web
 */
export function useColorScheme() {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
