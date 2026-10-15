import { useLocalSearchParams } from 'expo-router';
import { useEffect } from 'react';
import { Platform, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { OAUTH_CHANNEL, type OAuthMessage } from '@/lib/social';

// Where the Instagram and X login popup lands once the platform is done with
// it, by way of the social-auth function. It never sees a token, only which
// platform and whether it worked. Its one job is to tell the app window and
// close itself.
//
// It sits outside the (app) group so the session guard cannot bounce it to the
// login screen mid-handshake.

export default function OAuthCompleteScreen() {
  const theme = useTheme();
  const params = useLocalSearchParams<{ platform?: string; status?: string; message?: string }>();
  const platform = params.platform ? String(params.platform) : '';
  const connected = params.status === 'connected';
  const message = params.message ? String(params.message) : '';

  useEffect(() => {
    if (Platform.OS !== 'web' || !platform) return;

    const payload: OAuthMessage = {
      platform,
      status: connected ? 'connected' : 'error',
      message: message || undefined,
    };
    const channel = new BroadcastChannel(OAUTH_CHANNEL);
    channel.postMessage(payload);
    channel.close();

    // Browsers only let a script close a window that a script opened. If this
    // one was reached some other way, the text below says what to do instead.
    const timer = setTimeout(() => window.close(), 600);
    return () => clearTimeout(timer);
  }, [connected, message, platform]);

  return (
    <View style={[styles.page, { backgroundColor: theme.background }]}>
      <ThemedText type="sectionTitle">{connected ? 'Connected' : 'Not connected'}</ThemedText>
      <ThemedText type="small" themeColor="textSecondary" style={styles.text}>
        {connected
          ? 'You can close this window and go back to Synq.'
          : message || 'Something went wrong. Close this window and try again.'}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    padding: Spacing.five,
  },
  text: { textAlign: 'center', maxWidth: 360 },
});
