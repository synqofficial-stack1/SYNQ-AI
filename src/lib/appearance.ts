import AsyncStorage from '@react-native-async-storage/async-storage';
import { Appearance, Platform } from 'react-native';

import { supabase } from '@/lib/supabase';

// The person's theme choice: light, dark, or follow the system. Light is the
// default until they pick something else in Settings.
//
// This is a tiny external store rather than a React context because two very
// different places read it — the colour-scheme hook every component uses, and
// the Settings screen that writes it — and neither should re-render the tree
// above it. React Native Web has no `Appearance.setColorScheme`, so on the web
// the preference itself is the source of truth; on a phone it is also pushed
// into `Appearance` so the keyboard and system dialogs match.
//
// The choice is kept on this device and, once signed in, on the account
// (`profiles.appearance`), so it is still there at the next sign-in anywhere.

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

/**
 * After sign-in, the choice saved on the account wins, so the theme follows the
 * person to every device. An account that never chose takes this device's
 * choice, if it made one. Failures keep whatever is showing.
 */
export async function syncAppearanceWithAccount(userId: string): Promise<void> {
  await loadAppearancePreference();
  const { data, error } = await supabase.from('profiles').select('appearance').eq('id', userId).maybeSingle();
  if (error) return;
  const saved: unknown = data?.appearance;
  if (isPreference(saved)) {
    if (saved !== preference) apply(saved);
    AsyncStorage.setItem(APPEARANCE_KEY, saved).catch(() => {});
    return;
  }
  const local = await AsyncStorage.getItem(APPEARANCE_KEY).catch(() => null);
  if (isPreference(local)) await supabase.from('profiles').update({ appearance: local }).eq('id', userId);
}

/** Applies at once; resolves false if the choice could not be saved. */
export async function setAppearancePreference(next: AppearancePreference): Promise<boolean> {
  apply(next);
  let saved = true;
  try {
    await AsyncStorage.setItem(APPEARANCE_KEY, next);
  } catch {
    saved = false;
  }
  // Signed in: keep it on the account too, which is what the next sign-in reads.
  const { data } = await supabase.auth.getSession();
  const userId = data.session?.user.id;
  if (userId) {
    const { error } = await supabase.from('profiles').update({ appearance: next }).eq('id', userId);
    if (error) saved = false;
  }
  return saved;
}
