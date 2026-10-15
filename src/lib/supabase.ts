import 'react-native-url-polyfill/auto';

import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import { Platform } from 'react-native';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabasePublishableKey = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

if (!supabaseUrl || !supabasePublishableKey) {
  throw new Error(
    'Missing Supabase config. Copy .env.example to .env.local and fill in EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY.'
  );
}

export const supabase = createClient(supabaseUrl, supabasePublishableKey, {
  auth: {
    // AsyncStorage's web implementation touches `window` directly, which crashes
    // during Expo's server-side render (no `window` in that Node context). On web,
    // omit it so supabase-js falls back to its own SSR-safe storage handling.
    storage: Platform.OS === 'web' ? undefined : AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    // Google sign-in and the password-reset email both come back as a redirect
    // carrying tokens in the URL. On the web that is this same page, so let
    // supabase-js read them. A phone has no such page: the deep link is handed
    // to `signInWithGoogle` instead, which reads the tokens itself.
    detectSessionInUrl: Platform.OS === 'web',
  },
});
