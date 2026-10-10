import { Redirect, Stack } from 'expo-router';

import { useSession } from '@/hooks/use-session';

export default function AuthLayout() {
  const { session, isLoading } = useSession();

  if (!isLoading && session) {
    return <Redirect href="/(app)" />;
  }

  return <Stack screenOptions={{ headerShown: false }} />;
}
