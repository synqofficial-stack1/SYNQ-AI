import { Redirect, Slot } from 'expo-router';

import { AppShell } from '@/components/app-shell';
import { useSession } from '@/hooks/use-session';
import { useWorkspace } from '@/hooks/use-workspace';
import { ActivityIndicator, View } from 'react-native';

export default function AppLayout() {
  const { session, isLoading } = useSession();
  const workspace = useWorkspace();

  if (!isLoading && !session) {
    return <Redirect href="/(auth)/login" />;
  }
  if (isLoading || workspace.loading)
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator />
      </View>
    );
  if (
    workspace.error ||
    !workspace.identity?.full_name ||
    workspace.identity.membership?.status !== 'active'
  )
    return <Redirect href="/workspace-setup" />;

  // Slot rather than Stack: the shell supplies the chrome, so a stack header and
  // its push animations would just fight the sidebar.
  return (
    <AppShell>
      <Slot />
    </AppShell>
  );
}
