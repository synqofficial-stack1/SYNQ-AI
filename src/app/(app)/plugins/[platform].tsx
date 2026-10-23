import { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';

import { PlatformMark } from '@/components/brand-icons';
import { ArrowIcon, ArrowLeftIcon, PlusIcon, RefreshIcon, UnlinkIcon } from '@/components/icons';
import { ThemedText } from '@/components/themed-text';
import { Button, Card, ConfirmDialog, EmptyState, InlineAlert, LinkButton, LoadingState, SectionHeader, StatusBadge, Switch } from '@/components/ui';
import { MaxContentWidth, Radius, Spacing } from '@/constants/theme';
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
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);

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

  const status = loading
    ? { label: 'Checking…', tone: 'neutral' as const }
    : statusError
      ? { label: 'Status unavailable', tone: 'warning' as const }
      : !connection?.configured
        ? { label: 'Setup required', tone: 'neutral' as const }
        : connection.connected
          ? { label: 'Connected', tone: 'success' as const }
          : connection.needs_reconnect
            ? { label: 'Reconnect needed', tone: 'warning' as const }
            : connection.verification_error
              ? { label: 'Could not verify', tone: 'warning' as const }
              : { label: 'Not connected', tone: 'neutral' as const };

  return (
    <>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <Button label="All plugins" icon={ArrowLeftIcon} variant="ghost" size="sm" onPress={() => router.push('/plugins' as Parameters<typeof router.push>[0])} />
          <View style={styles.titleRow}>
            {platform ? <PlatformMark platform={platform} size={52} /> : null}
            <View style={styles.titleText}>
              <ThemedText type="pageTitle" accessibilityRole="header">
                {label}
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                Connect to let Synq publish videos to this account. You still approve each post before it goes live.
              </ThemedText>
            </View>
          </View>
        </View>

        <Card>
          <SectionHeader title="Connection status" action={platform ? <StatusBadge label={status.label} tone={status.tone} /> : undefined} />
          {loading ? (
            <LoadingState label="Checking the connection…" />
          ) : !platform ? (
            <EmptyState
              title="This plugin is not supported"
              description="Choose a plugin from the directory."
              action={{ label: 'All plugins', onPress: () => router.push('/plugins' as Parameters<typeof router.push>[0]) }}
              compact
            />
          ) : statusError ? (
            <>
              <InlineAlert tone="warning" message={`${statusError} Synq will not show this account as connected until the provider verifies it.`} />
              <View style={styles.actions}>
                <Button label="Retry verification" icon={RefreshIcon} onPress={() => void refresh()} />
              </View>
            </>
          ) : !connection?.configured ? (
            <InlineAlert tone="info" message={`${label} publishing is not set up on the server yet. It will be available once the Synq team adds its credentials.`} />
          ) : connection.connected ? (
            <>
              <ThemedText type="small">
                Account: <ThemedText type="smallBold">{connection.account_name || `your ${label} account`}</ThemedText>
              </ThemedText>
              <ThemedText type="caption" themeColor="textSecondary">
                Synq verified this account with {label}. Each public post still needs your confirmation.
              </ThemedText>
              {platform === 'youtube' ? (
                <View style={[styles.destinationRow, { borderColor: theme.border }]}>
                  <View style={styles.destinationCopy}>
                    <ThemedText type="smallBold">Use YouTube as a publishing destination</ThemedText>
                    <ThemedText type="caption" themeColor="textSecondary">
                      {connection.publishing_enabled ? 'On: YouTube is offered when you publish a reel.' : 'Off: YouTube is not offered when you publish a reel.'}
                    </ThemedText>
                  </View>
                  <Switch
                    label="Use YouTube as a publishing destination"
                    value={connection.publishing_enabled}
                    onValueChange={(enabled) => void togglePublishing(enabled)}
                    disabled={busy}
                  />
                </View>
              ) : null}
              <View style={styles.actions}>
                <Button label={`Disconnect ${label}`} variant="dangerOutline" icon={UnlinkIcon} disabled={busy} onPress={() => setConfirmDisconnect(true)} />
              </View>
            </>
          ) : connection.needs_reconnect ? (
            <>
              <InlineAlert tone="warning" message={connection.verification_error ?? 'The provider rejected the saved authorization.'} />
              <View style={styles.actions}>
                <Button label={`Reconnect ${label}`} variant="primary" loading={busy} onPress={() => void connect()} />
              </View>
            </>
          ) : connection.verification_error ? (
            <>
              <InlineAlert tone="warning" message={`${connection.verification_error} Synq will not mark this connection active until verification succeeds.`} />
              <View style={styles.actions}>
                <Button label="Retry verification" icon={RefreshIcon} disabled={busy} onPress={() => void refresh()} />
              </View>
            </>
          ) : (
            <>
              <ThemedText type="small" themeColor="textSecondary">
                Not connected. Continue to {label} and grant Synq the publishing permissions it asks for.
              </ThemedText>
              <View style={styles.actions}>
                <Button label={`Connect ${label}`} variant="primary" icon={PlusIcon} loading={busy} onPress={() => void connect()} />
              </View>
            </>
          )}
          {error ? <InlineAlert tone="danger" message={error} /> : null}
        </Card>

        <View style={styles.actions}>
          <LinkButton label="Go to Marketing to make a reel" icon={ArrowIcon} onPress={() => router.push('/marketing')} />
        </View>
      </ScrollView>

      <ConfirmDialog
        visible={confirmDisconnect}
        title={`Disconnect ${label}?`}
        description="Synq will stop publishing there until you connect it again. Posts already published stay up."
        confirmLabel="Disconnect"
        busy={busy}
        onConfirm={() => {
          void disconnect().finally(() => setConfirmDisconnect(false));
        }}
        onClose={() => setConfirmDisconnect(false)}
      />
    </>
  );
}

const styles = StyleSheet.create({
  content: { gap: Spacing.four, padding: 28, width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center' },
  header: { gap: Spacing.three, alignItems: 'flex-start' },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  titleText: { flex: 1, gap: 4 },
  destinationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.three,
    borderWidth: 1,
    borderRadius: Radius.control + 2,
    padding: 14,
  },
  destinationCopy: { flex: 1, gap: Spacing.one },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
});
