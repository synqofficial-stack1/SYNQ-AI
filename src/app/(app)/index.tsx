import { StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PrimaryButton } from '@/components/primary-button';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useSession } from '@/hooks/use-session';
import { supabase } from '@/lib/supabase';

// Placeholder home screen. Becomes the real task-submission screen in Phase 4.
export default function AppHomeScreen() {
  const { session } = useSession();

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ThemedText type="title" style={styles.title}>
          You&apos;re in
        </ThemedText>
        <ThemedText type="default" style={styles.email}>
          {session?.user.email}
        </ThemedText>
        <ThemedText type="small" style={styles.note}>
          The Sales Agent task screen goes here next.
        </ThemedText>
        <PrimaryButton title="Log Out" onPress={() => supabase.auth.signOut()} />
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safeArea: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.three,
    paddingHorizontal: Spacing.four,
  },
  title: { textAlign: 'center' },
  email: { textAlign: 'center' },
  note: { textAlign: 'center' },
});
