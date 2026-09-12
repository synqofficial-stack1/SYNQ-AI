import { Redirect, Slot } from 'expo-router';

import { AppShell } from '@/components/app-shell';
import { useSession } from '@/hooks/use-session';

export default function AppLayout() {
  const { session, isLoading } = useSession();

  if (!isLoading && !session) {
    return <Redirect href="/(auth)/login" />;
  }

  // Slot rather than Stack: the shell supplies the chrome, so a stack header and
  // its push animations would just fight the sidebar.
  return (
    <AppShell>
      <Slot />
    </AppShell>
  );
}
