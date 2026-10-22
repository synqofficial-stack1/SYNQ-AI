import { router, useLocalSearchParams } from 'expo-router';
import { useEffect } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { OAUTH_CHANNEL, type OAuthMessage } from '@/lib/social';

// Where social-auth sends the browser after the provider callback. It never
// sees a token, only which platform and whether it worked. Popup flows notify
// their opener; YouTube and Instagram full-page web flows return to the plugin.
//
// It sits outside the (app) group so the session guard cannot bounce it to the
// login screen mid-handshake.

export default function OAuthCompleteScreen() {
  const theme = useTheme();
  const params = useLocalSearchParams<{ platform?: string; status?: string; message?: string }>();
  const platform = params.platform ? String(params.platform) : '';
  const connected = params.status === 'connected';
  const message = params.message ? String(params.message) : '';
  const isFullPagePlugin = Platform.OS === 'web' && typeof window !== 'undefined'
    && (platform === 'youtube' || platform === 'instagram') && !window.opener;

  useEffect(() => {
    if (Platform.OS !== 'web' || !platform) return;

    if (isFullPagePlugin) {
      const pluginPath = platform === 'instagram' ? '/plugins/instagram' : '/plugins';
      const timer = setTimeout(() => router.replace(pluginPath as Parameters<typeof router.replace>[0]), 1800);
      return () => clearTimeout(timer);
    }

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
  }, [connected, isFullPagePlugin, message, platform]);

  return (
    <View style={[styles.page, { backgroundColor: theme.background }]}>
      <ThemedText type="sectionTitle">{connected ? 'Connected' : 'Not connected'}</ThemedText>
      <ThemedText type="small" themeColor="textSecondary" style={styles.text}>
        {isFullPagePlugin
          ? connected
            ? platform === 'instagram'
              ? 'Your Instagram account is connected. Returning to its plugin page…'
              : 'Your YouTube account is connected. Returning to Integrations…'
            : message || (platform === 'instagram'
              ? 'Instagram could not be connected. Returning to its plugin page…'
              : 'YouTube could not be connected. Returning to Integrations…')
          : connected
            ? 'You can close this window and go back to Synq.'
            : message || 'Something went wrong. Close this window and try again.'}
      </ThemedText>
      {isFullPagePlugin ? (
        <Pressable accessibilityRole="button" onPress={() => router.replace((platform === 'instagram' ? '/plugins/instagram' : '/plugins') as Parameters<typeof router.replace>[0])}>
          <ThemedText type="smallBold">{platform === 'instagram' ? 'Back to Instagram plugin' : 'Back to Integrations'}</ThemedText>
        </Pressable>
      ) : null}
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
