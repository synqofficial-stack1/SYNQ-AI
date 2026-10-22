import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Switch, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';

import { PrimaryButton } from '@/components/primary-button';
import { ThemedText } from '@/components/themed-text';
import { AccentColors, MaxContentWidth, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import {
  connectPlatform,
  disconnectPlatform,
  loadConnections,
  setPublishingEnabled,
  SOCIAL_LABELS,
  SocialError,
  type Connection,
  type SocialPlatform,
} from '@/lib/social';

const PLATFORMS: SocialPlatform[] = ['youtube', 'instagram', 'x'];
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

  async function togglePublishing(enabled: boolean) {
    if (!platform) return;
    setBusy(true);
    setError(null);
    try {
      await setPublishingEnabled(platform, enabled);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not update the publishing destination.');
    } finally {
      setBusy(false);
    }
  }

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
            <ThemedText type="small" style={{ color: AccentColors.warning }}>Temporarily unavailable</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">This connection is being prepared. Please try again later.</ThemedText>
          </>
        ) : connection.connected ? (
          <>
            <ThemedText type="small" style={{ color: AccentColors.success }}>Connected and provider-verified</ThemedText>
            <ThemedText type="small">Account: {connection.account_name || `your ${label} account`}</ThemedText>
            <ThemedText type="caption" themeColor="textSecondary">Synq verified this account with {label}. Each public post still requires your confirmation.</ThemedText>
            {platform === 'youtube' ? (
              <View style={styles.destinationRow}>
                <View style={styles.destinationCopy}>
                  <ThemedText type="smallBold">Use YouTube as a publishing destination</ThemedText>
                  <ThemedText type="caption" themeColor="textSecondary">{connection.publishing_enabled ? 'Enabled' : 'Disabled'}</ThemedText>
                </View>
                <Switch accessibilityLabel="Enable YouTube publishing destination" value={connection.publishing_enabled} onValueChange={(enabled) => void togglePublishing(enabled)} disabled={busy} trackColor={{ false: theme.border, true: AccentColors.primary }} />
              </View>
            ) : null}
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
  destinationRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.three },
  destinationCopy: { flex: 1, gap: Spacing.one },
  marketingLink: { alignSelf: 'flex-start', paddingVertical: Spacing.two, paddingHorizontal: Spacing.three },
});
