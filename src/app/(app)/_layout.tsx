import { Redirect, Slot } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator } from 'react-native';

import { AppShell } from '@/components/app-shell';
import { ThemedView } from '@/components/themed-view';
import { useSession } from '@/hooks/use-session';
import { loadOnboarding } from '@/lib/onboarding';

export default function AppLayout() {
  const { session, isLoading } = useSession();
  const [onboardingChecked, setOnboardingChecked] = useState(false);
  const [needsOnboarding, setNeedsOnboarding] = useState(false);

  useEffect(() => {
    if (isLoading || !session?.user.id) {
      setOnboardingChecked(false);
      return;
    }
    let active = true;
    loadOnboarding(session.user.id)
      .then((row) => {
        if (!active) return;
        setNeedsOnboarding(Boolean(row?.required && row.status !== 'completed'));
        setOnboardingChecked(true);
      })
      .catch(() => {
        // Keep the app available if the optional onboarding status lookup fails;
        // the onboarding screen itself shows actionable errors when opened.
        if (active) setOnboardingChecked(true);
      });
    return () => { active = false; };
  }, [session?.user.id, isLoading]);

  if (isLoading) {
    return <ThemedView style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator /></ThemedView>;
  }
  if (!session) {
    return <Redirect href="/(auth)/login" />;
  }
  if (!onboardingChecked) {
    return <ThemedView style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator /></ThemedView>;
  }
  if (needsOnboarding) {
    return <Redirect href={'/(onboarding)' as never} />;
  }

  // Slot rather than Stack: the shell supplies the chrome, so a stack header and
  // its push animations would just fight the sidebar.
  return (
    <AppShell>
      <Slot />
    </AppShell>
  );
}
