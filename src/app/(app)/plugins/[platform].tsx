import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';

import { PrimaryButton } from '@/components/primary-button';
import { ThemedText } from '@/components/themed-text';
import { AccentColors, MaxContentWidth, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import {
  connectPlatform,
  disconnectPlatform,
  loadConnections,
  SOCIAL_LABELS,
  SocialError,
  type Connection,
  type SocialPlatform,
} from '@/lib/social';

const PLATFORMS: SocialPlatform[] = ['youtube', 'instagram', 'x', 'linkedin'];
const CALLBACK_URI = 'https://jjdrlgwpvxyxeruyygli.supabase.co/functions/v1/social-auth';

const SETUP: Record<SocialPlatform, { credentials: string[]; permissions: string; steps: string[]; providerUrl: string }> = {
  youtube: {
    credentials: ['YOUTUBE_GOOGLE_CONSOLE_CLIENT_ID', 'YOUTUBE_GOOGLE_CONSOLE_CLIENT_SECRET', 'SOCIAL_TOKEN_ENCRYPTION_KEY'],
    permissions: 'YouTube read-only (for channel verification) and YouTube upload.',
    steps: ['Enable YouTube Data API v3 in the Google Cloud project.', 'Create a Web application OAuth client and add the callback URI below as an authorized redirect URI.', 'Add the OAuth client ID and secret to Supabase Edge Function secrets. Add the encryption key there too.', 'If the OAuth consent screen is in Testing, add the Google account you will connect as a test user.'],
    providerUrl: 'https://console.cloud.google.com/auth/clients?project=synq-ai-auth',
  },
  instagram: {
    credentials: ['INSTAGRAM_APP_ID', 'INSTAGRAM_APP_SECRET', 'SOCIAL_TOKEN_ENCRYPTION_KEY'],
    permissions: 'Instagram professional account identity and content publishing.',
    steps: ['Set up an Instagram professional account and a Meta app with Instagram Login and content publishing access.', 'Add the callback URI below to the provider OAuth settings.', 'Add the Meta app ID and secret plus the encryption key to Supabase Edge Function secrets.'],
    providerUrl: 'https://developers.facebook.com/apps/',
  },
  x: {
    credentials: ['X_CLIENT_ID', 'X_CLIENT_SECRET', 'SOCIAL_TOKEN_ENCRYPTION_KEY'],
    permissions: 'Read the authorized account, upload video media, and publish posts.',
    steps: ['Create an X developer app with OAuth 2.0 enabled and the required read, write, media upload, and offline access scopes.', 'Add the callback URI below as the OAuth 2.0 redirect URL.', 'Add the X client ID and secret plus the encryption key to Supabase Edge Function secrets.'],
    providerUrl: 'https://developer.x.com/en/portal/projects-and-apps',
  },
  linkedin: {
    credentials: ['LINKEDIN_CLIENT_ID', 'LINKEDIN_CLIENT_SECRET', 'SOCIAL_TOKEN_ENCRYPTION_KEY'],
    permissions: 'Member profile and member video posting. Organization posting needs additional LinkedIn approval and page roles.',
    steps: ['Create a LinkedIn developer app and request the appropriate sign-in and Community Management access.', 'Add the callback URI below to the app’s authorized redirect URLs.', 'Add the LinkedIn client ID and secret plus the encryption key to Supabase Edge Function secrets.'],
    providerUrl: 'https://www.linkedin.com/developers/apps',
  },
};

export default function PluginScreen() {
  const theme = useTheme();
  const { platform: rawPlatform } = useLocalSearchParams<{ platform: string }>();
  const platform = PLATFORMS.includes(rawPlatform as SocialPlatform) ? (rawPlatform as SocialPlatform) : null;
  const label = platform ? SOCIAL_LABELS[platform] : 'Plugin';
  const [connection, setConnection] = useState<Connection | null>(null);
  const [loading, setLoading] = useState(() => Boolean(platform));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!platform) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const connections = await loadConnections();
      setConnection(connections.find((item) => item.platform === platform) ?? null);
      setStatusError(null);
    } catch (cause) {
      setStatusError(cause instanceof Error ? cause.message : 'Could not verify the connection.');
    } finally {
      setLoading(false);
    }
  }, [platform]);

  useEffect(() => {
    if (!platform) return;
    let active = true;
    loadConnections()
      .then((connections) => {
        if (!active) return;
        setConnection(connections.find((item) => item.platform === platform) ?? null);
        setStatusError(null);
      })
      .catch((cause: unknown) => {
        if (active) setStatusError(cause instanceof Error ? cause.message : 'Could not verify the connection.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [platform]);

  async function connect() {
    if (!platform) return;
    setBusy(true);
    setError(null);
    try {
      await connectPlatform(platform);
      await refresh();
    } catch (cause) {
      setError(cause instanceof SocialError ? cause.message : 'Connecting did not complete.');
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    if (!platform) return;
    setBusy(true);
    setError(null);
    try {
      await disconnectPlatform(platform);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Disconnecting failed.');
    } finally {
      setBusy(false);
    }
  }

  const setup = platform ? SETUP[platform] : null;
  const missing = connection?.configuration_missing ?? [];

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" onPress={() => router.push('/plugins' as Parameters<typeof router.push>[0])}>
          <ThemedText type="caption" style={{ color: AccentColors.primaryLight }}>← All plugins</ThemedText>
        </Pressable>
        <ThemedText type="pageTitle">{label}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          Connect to authorize Synq to publish videos to this account. You still approve each post in Synq before it goes live.
        </ThemedText>
      </View>

      <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
        <ThemedText type="sectionTitle">Connection status</ThemedText>
        {loading ? <ActivityIndicator color={AccentColors.primary} /> : !platform ? (
          <ThemedText type="small" themeColor="textSecondary">This plugin is not supported.</ThemedText>
        ) : statusError ? (
          <>
            <ThemedText type="small" style={{ color: AccentColors.warning }}>Status unavailable</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">{statusError} Synq will not show this account as connected until the provider verifies it.</ThemedText>
            <PrimaryButton title="Retry verification" onPress={() => void refresh()} />
          </>
        ) : !connection?.configured ? (
          <>
            <ThemedText type="small" style={{ color: AccentColors.warning }}>Server setup required</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              Synq cannot start authorization until the required credentials and token-encryption key are configured in Supabase Edge Function secrets.
            </ThemedText>
            {missing.length > 0 ? <ThemedText type="caption" themeColor="textSecondary">Missing: {missing.join(', ')}</ThemedText> : null}
            {platform === 'youtube' ? (
              <ThemedText type="caption" themeColor="textSecondary">
                API key: {connection?.api_key_configured ? 'detected' : 'not detected (not required for OAuth uploads)'}.
              </ThemedText>
            ) : null}
            <PrimaryButton title="Open Supabase function secrets" onPress={() => void Linking.openURL('https://supabase.com/dashboard/project/jjdrlgwpvxyxeruyygli/functions/secrets')} />
          </>
        ) : connection.connected ? (
          <>
            <ThemedText type="small" style={{ color: AccentColors.success }}>Connected and provider-verified</ThemedText>
            <ThemedText type="small">Account: {connection.account_name || `your ${label} account`}</ThemedText>
            <ThemedText type="caption" themeColor="textSecondary">Synq verified this account with {label}. Each public post still requires your confirmation.</ThemedText>
            <PrimaryButton title={busy ? 'Disconnecting…' : `Disconnect ${label}`} onPress={disconnect} disabled={busy} />
          </>
        ) : connection.needs_reconnect ? (
          <>
            <ThemedText type="small" style={{ color: AccentColors.warning }}>Reconnect required</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">{connection.verification_error ?? 'The provider rejected the saved authorization.'}</ThemedText>
            <PrimaryButton title={busy ? 'Connecting…' : `Reconnect ${label}`} onPress={connect} disabled={busy} />
          </>
        ) : connection.verification_error ? (
          <>
            <ThemedText type="small" style={{ color: AccentColors.warning }}>Could not verify</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">{connection.verification_error} Synq will not mark this connection active until verification succeeds.</ThemedText>
            <PrimaryButton title="Retry verification" onPress={() => void refresh()} disabled={busy} />
          </>
        ) : (
          <>
            <ThemedText type="small" themeColor="textSecondary">Not connected. Continue to {label} and grant Synq the requested publishing permissions.</ThemedText>
            <PrimaryButton title={busy ? 'Connecting…' : `+ Connect ${label}`} onPress={connect} disabled={busy} />
          </>
        )}
        {error ? <ThemedText type="small" style={{ color: AccentColors.error }}>{error}</ThemedText> : null}
      </View>

      {setup ? (
        <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          <ThemedText type="sectionTitle">Setup guide</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">Required permissions: {setup.permissions}</ThemedText>
          {setup.steps.map((step, index) => (
            <View key={step} style={styles.step}>
              <ThemedText type="caption" style={styles.stepNumber}>{index + 1}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary" style={styles.stepCopy}>{step}</ThemedText>
            </View>
          ))}
          <ThemedText type="caption" themeColor="textSecondary">Add these server-side configuration names: {setup.credentials.join(', ')}.</ThemedText>
          <ThemedText type="caption" themeColor="textSecondary">OAuth callback URI — register this exact URL with the provider:</ThemedText>
          <ThemedText selectable type="code" style={[styles.callback, { backgroundColor: theme.surfaceRaised, color: theme.text }]}>{CALLBACK_URI}</ThemedText>
          {platform === 'youtube' ? (
            <ThemedText type="caption" themeColor="textSecondary">
              YouTube uploads and channel verification use the authorized account’s OAuth token. A YouTube API key is optional for this flow, not a substitute for the OAuth client ID and secret.
            </ThemedText>
          ) : null}
          <Pressable accessibilityRole="link" onPress={() => void Linking.openURL(setup.providerUrl)}>
            <ThemedText type="small" style={{ color: AccentColors.primaryLight }}>Open {label} developer settings ↗</ThemedText>
          </Pressable>
        </View>
      ) : null}

      <Pressable accessibilityRole="button" onPress={() => router.push('/marketing')} style={styles.marketingLink}>
        <ThemedText type="small" style={{ color: AccentColors.primaryLight }}>Go to Marketing to make a reel →</ThemedText>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { gap: Spacing.three, padding: Spacing.five, width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center' },
  header: { gap: Spacing.two },
  card: { gap: Spacing.three, borderWidth: 1, borderRadius: Radius.card, padding: Spacing.four },
  step: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.two },
  stepNumber: { width: 24, height: 24, textAlign: 'center', textAlignVertical: 'center', borderRadius: Radius.pill, overflow: 'hidden', backgroundColor: 'rgba(232, 197, 71, 0.14)', color: AccentColors.primaryLight },
  stepCopy: { flex: 1 },
  callback: { padding: Spacing.two, borderRadius: Radius.control, overflow: 'hidden' },
  marketingLink: { alignSelf: 'flex-start', paddingVertical: Spacing.two, paddingHorizontal: Spacing.three },
});
