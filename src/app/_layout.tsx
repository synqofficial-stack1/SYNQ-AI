import { DarkTheme, DefaultTheme, Stack, ThemeProvider, usePathname } from 'expo-router';
import { useEffect } from 'react';
import { Platform } from 'react-native';

import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { SessionProvider, useSession } from '@/hooks/use-session';
import { WorkspaceProvider } from '@/hooks/use-workspace';
import { loadAppearancePreference, syncAppearanceWithAccount } from '@/lib/appearance';
import { PhoneFrame } from '@/components/phone-frame';

/** Applies the theme saved on the account each time someone signs in. */
function AppearanceSync() {
  const userId = useSession().session?.user.id;
  useEffect(() => {
    if (userId) void syncAppearanceWithAccount(userId).catch(() => {});
  }, [userId]);
  return null;
}

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const palette = Colors[colorScheme];
  const pathname = usePathname();
  // The sign-in screens are always dark, whatever the theme. Browser autofill
  // paints the field's text with this colour, so it must be white there.
  const onSignInScreen = /^\/(login|signup|forgot-password|reset-password)(\/|$)/.test(pathname);

  useEffect(() => {
    void loadAppearancePreference();
  }, []);

  // The page behind the app, the browser's own controls (scrollbars, date
  // pickers) and Chrome's autofill text all follow the chosen theme.
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return;
    const root = document.documentElement;
    root.style.colorScheme = colorScheme;
    root.style.setProperty('--synq-autofill-text', onSignInScreen ? '#ffffff' : palette.text);
    document.body.style.backgroundColor = palette.background;
  }, [colorScheme, palette, onSignInScreen]);

  const base = colorScheme === 'dark' ? DarkTheme : DefaultTheme;
  return (
    <SessionProvider>
      <AppearanceSync />
      <WorkspaceProvider>
        <ThemeProvider
          value={{
            ...base,
            colors: {
              ...base.colors,
              primary: palette.accent,
              background: palette.background,
              card: palette.surface,
              text: palette.text,
              border: palette.border,
            },
          }}
        >
          <PhoneFrame>
            <Stack screenOptions={{ headerShown: false }} />
          </PhoneFrame>
        </ThemeProvider>
      </WorkspaceProvider>
    </SessionProvider>
  );
}
