import { Redirect, Stack } from 'expo-router';

import { useSession } from '@/hooks/use-session';

export default function AppLayout() {
  const { session, isLoading } = useSession();

  if (!isLoading && !session) {
    return <Redirect href="/(auth)/login" />;
  }

  return <Stack screenOptions={{ headerShown: false }} />;
}
