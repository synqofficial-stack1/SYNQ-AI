import { Redirect, useLocalSearchParams } from 'expo-router';
import { ActivityIndicator, StyleSheet } from 'react-native';

import { ThemedView } from '@/components/themed-view';
import { useSession } from '@/hooks/use-session';

// Root screen: sends the user to the right place based on whether they're logged in.
export default function Index() {
  const { session, isLoading } = useSession();
  const { ai } = useLocalSearchParams<{ ai?: string }>();

  if (isLoading) {
    return (
      <ThemedView style={styles.container}>
        <ActivityIndicator />
      </ThemedView>
    );
  }

  return <Redirect href={session ? { pathname: '/(app)', params: ai === '1' ? { ai: '1' } : {} } : '/(auth)/login'} />;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
