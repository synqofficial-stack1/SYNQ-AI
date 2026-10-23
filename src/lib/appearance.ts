import AsyncStorage from '@react-native-async-storage/async-storage';
import { Appearance, Platform } from 'react-native';

// The person's theme choice: light, dark, or follow the system. Light is the
// default until they pick something else in Settings.
//
// This is a tiny external store rather than a React context because two very
// different places read it — the colour-scheme hook every component uses, and
// the Settings screen that writes it — and neither should re-render the tree
// above it. React Native Web has no `Appearance.setColorScheme`, so on the web
// the preference itself is the source of truth; on a phone it is also pushed
// into `Appearance` so the keyboard and system dialogs match.

export type AppearancePreference = 'light' | 'dark' | 'system';

export const APPEARANCE_KEY = 'synq-appearance';

let preference: AppearancePreference = 'light';
let loaded = false;
const listeners = new Set<() => void>();

function isPreference(value: unknown): value is AppearancePreference {
  return value === 'light' || value === 'dark' || value === 'system';
}

function apply(next: AppearancePreference) {
  preference = next;
  if (Platform.OS !== 'web' && typeof Appearance.setColorScheme === 'function') {
    Appearance.setColorScheme(next === 'system' ? 'unspecified' : next);
  }
  listeners.forEach((listener) => listener());
}

export function getAppearancePreference(): AppearancePreference {
  return preference;
}

export function subscribeAppearance(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Reads the saved choice once per app start. A storage failure keeps light. */
export async function loadAppearancePreference(): Promise<void> {
  if (loaded) return;
  loaded = true;
  try {
    const saved = await AsyncStorage.getItem(APPEARANCE_KEY);
    if (isPreference(saved)) apply(saved);
  } catch {
    // Private browsing or a locked store: the default theme is fine.
  }
}

/** Applies at once; resolves false if the choice could not be saved. */
export async function setAppearancePreference(next: AppearancePreference): Promise<boolean> {
  apply(next);
  try {
    await AsyncStorage.setItem(APPEARANCE_KEY, next);
    return true;
  } catch {
    return false;
  }
}
