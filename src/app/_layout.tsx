import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { useEffect } from 'react';
import { Platform } from 'react-native';

import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { SessionProvider } from '@/hooks/use-session';
import { WorkspaceProvider } from '@/hooks/use-workspace';
import { loadAppearancePreference } from '@/lib/appearance';

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const palette = Colors[colorScheme];

  useEffect(() => {
    void loadAppearancePreference();
  }, []);

  // The page behind the app, the browser's own controls (scrollbars, date
  // pickers) and Chrome's autofill text all follow the chosen theme.
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return;
    const root = document.documentElement;
    root.style.colorScheme = colorScheme;
    root.style.setProperty('--synq-autofill-text', palette.text);
    document.body.style.backgroundColor = palette.background;
  }, [colorScheme, palette]);

  const base = colorScheme === 'dark' ? DarkTheme : DefaultTheme;
  return (
    <SessionProvider>
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
          <Stack screenOptions={{ headerShown: false }} />
        </ThemeProvider>
      </WorkspaceProvider>
    </SessionProvider>
  );
}
