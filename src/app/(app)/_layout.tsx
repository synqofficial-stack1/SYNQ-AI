import { Redirect, Slot } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator } from 'react-native';
import { AppShell } from '@/components/app-shell';
import { ThemedView } from '@/components/themed-view';
import { useSession } from '@/hooks/use-session';
import { useWorkspace } from '@/hooks/use-workspace';
import { loadOnboarding } from '@/lib/onboarding';

export default function AppLayout() {
  const { session, isLoading } = useSession();
  const workspace = useWorkspace();
  const [onboarding, setOnboarding] = useState<{
    userId: string;
    needsOnboarding: boolean;
  } | null>(null);
  useEffect(() => {
    if (isLoading || !session?.user.id) return;
    let active = true;
    loadOnboarding(session.user.id)
      .then((row) => {
        if (active)
          setOnboarding({
            userId: session.user.id,
            needsOnboarding: Boolean(
              row?.required && row.status !== 'completed',
            ),
          });
      })
      .catch(() => {
        // Business-preference onboarding remains optional on lookup failure.
        // Company approval below is always enforced separately and fails closed.
        if (active)
          setOnboarding({ userId: session.user.id, needsOnboarding: false });
      });
    return () => {
      active = false;
    };
  }, [session?.user.id, isLoading]);
  const checked = !session || onboarding?.userId === session.user.id;
  if (!isLoading && !session) return <Redirect href="/(auth)/login" />;
  if (isLoading || workspace.loading || !checked)
    return (
      <ThemedView
        style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}
      >
        <ActivityIndicator />
      </ThemedView>
    );
  if (
    workspace.error ||
    !workspace.identity?.full_name ||
    workspace.identity.membership?.status !== 'active'
  )
    return <Redirect href="/workspace-setup" />;
  if (onboarding?.needsOnboarding)
    return <Redirect href={'/(onboarding)' as never} />;
  return (
    <AppShell>
      <Slot />
    </AppShell>
  );
}
