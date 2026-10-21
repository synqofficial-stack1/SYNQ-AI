import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { useColorScheme } from 'react-native';

import { SessionProvider } from '@/hooks/use-session';
import { WorkspaceProvider } from '@/hooks/use-workspace';

export default function RootLayout() {
  const colorScheme = useColorScheme();
  return (
    <SessionProvider>
      <WorkspaceProvider>
        <ThemeProvider
          value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}
        >
          <Stack screenOptions={{ headerShown: false }} />
        </ThemeProvider>
      </WorkspaceProvider>
    </SessionProvider>
  );
}
