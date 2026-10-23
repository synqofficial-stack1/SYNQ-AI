import { router, useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { PlatformMark } from '@/components/brand-icons';
import { ExternalLinkIcon, MoreVerticalIcon, UnlinkIcon } from '@/components/icons';
import { ThemedText } from '@/components/themed-text';
import {
  Button,
  ConfirmDialog,
  EmptyState,
  InlineAlert,
  Popover,
  StatusBadge,
  Tabs,
  showToast,
  transition,
  useBreakpoint,
  type Tone,
} from '@/components/ui';
import { PageMaxWidth, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { connectPlatform, disconnectPlatform, loadConnections, SocialError, type Connection, type SocialPlatform } from '@/lib/social';

// The plugins Synq can publish to: YouTube, Instagram and X. Each card's status
// comes from the server's own check of the stored connection, never from the
// click, and its button starts the real OAuth flow.

type Filter = 'all' | 'connected';
type Plugin = { key: SocialPlatform; name: string; category: string; tone: Tone; description: string };

const PLUGINS: Plugin[] = [
  { key: 'youtube', name: 'YouTube', category: 'Video', tone: 'danger', description: 'Publish approved reels to your channel as Shorts.' },
  { key: 'instagram', name: 'Instagram', category: 'Social', tone: 'info', description: 'Publish approved reels to a professional account.' },
  { key: 'x', name: 'X', category: 'Social', tone: 'info', description: 'Post approved short videos with a caption.' },
];

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'connected', label: 'Connected' },
];

type State = {
  connected: boolean;
  /** Connected, but the provider no longer accepts the stored login. */
  reconnect: boolean;
  /** The server is missing this plugin's credentials. */
  unconfigured: boolean;
  account: string | null;
};

function statusOf(state: State | undefined, loading: boolean): { label: string; tone: Tone } {
  if (!state) return loading ? { label: 'Checking…', tone: 'neutral' } : { label: 'Status unavailable', tone: 'neutral' };
  if (state.connected) return { label: 'Connected', tone: 'success' };
  if (state.reconnect) return { label: 'Reconnect needed', tone: 'warning' };
  if (state.unconfigured) return { label: 'Setup required', tone: 'neutral' };
  return { label: 'Not connected', tone: 'neutral' };
}

/** The ⋮ button on a card and the small menu it opens. */
function PluginMenu({ name, connected, onDetails, onDisconnect }: { name: string; connected: boolean; onDetails: () => void; onDisconnect: () => void }) {
  const theme = useTheme();
  const anchor = useRef<View>(null);
  const [open, setOpen] = useState(false);
  const choose = (action: () => void) => {
    setOpen(false);
    action();
  };
  return (
    <>
      <View ref={anchor} collapsable={false}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`More options for ${name}`}
          onPress={() => setOpen(true)}
          style={({ hovered }) => [styles.more, transition, hovered && { backgroundColor: theme.surfaceRaised }]}
        >
          <MoreVerticalIcon size={18} color={theme.textSecondary} />
        </Pressable>
      </View>
      <Popover anchorRef={anchor} visible={open} onClose={() => setOpen(false)} align="right" width={220} label={`${name} options`}>
        <Pressable
          accessibilityRole="menuitem"
          onPress={() => choose(onDetails)}
          style={({ hovered }) => [styles.menuItem, hovered && { backgroundColor: theme.surfaceRaised }]}
        >
          <ExternalLinkIcon size={16} color={theme.textSecondary} />
          <Text style={[styles.menuText, { color: theme.text }]}>View details</Text>
        </Pressable>
        {connected ? (
          <Pressable
            accessibilityRole="menuitem"
            onPress={() => choose(onDisconnect)}
            style={({ hovered }) => [styles.menuItem, hovered && { backgroundColor: theme.dangerSoft }]}
          >
            <UnlinkIcon size={16} color={theme.danger} />
            <Text style={[styles.menuText, { color: theme.danger }]}>Disconnect</Text>
          </Pressable>
        ) : null}
      </Popover>
    </>
  );
}

export default function PluginsDirectory() {
  const theme = useTheme();
  const { isCompact } = useBreakpoint();
  const [filter, setFilter] = useState<Filter>('all');
  const [connections, setConnections] = useState<Connection[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [statusError, setStatusError] = useState('');
  const [busy, setBusy] = useState<SocialPlatform | null>(null);
  const [disconnecting, setDisconnecting] = useState<SocialPlatform | null>(null);
  const [gridWidth, setGridWidth] = useState(0);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setConnections(await loadConnections());
      setStatusError('');
    } catch {
      setConnections(null);
      setStatusError('Could not check your plugin connections. Check your internet connection and try again.');
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh]),
  );

  const state = (key: SocialPlatform): State | undefined => {
    if (!connections) return undefined;
    const row = connections.find((item) => item.platform === key);
    return {
      connected: Boolean(row?.connected),
      reconnect: Boolean(row?.needs_reconnect),
      unconfigured: row ? !row.configured : false,
      account: row?.account_name ?? null,
    };
  };

  const openDetails = (key: SocialPlatform) => router.push(`/plugins/${key}` as Parameters<typeof router.push>[0]);

  async function connect(plugin: Plugin) {
    const current = state(plugin.key);
    // Anything that is not a plain "connect now" — already connected, missing
    // server setup, or status unknown — goes to the page that explains it.
    if (!current || current.connected || current.unconfigured) {
      openDetails(plugin.key);
      return;
    }
    setBusy(plugin.key);
    try {
      await connectPlatform(plugin.key);
      await refresh();
      showToast(`${plugin.name} connected.`);
    } catch (cause) {
      showToast(cause instanceof SocialError || cause instanceof Error ? cause.message : 'Connecting did not complete.', 'danger');
    } finally {
      setBusy(null);
    }
  }

  async function disconnect(key: SocialPlatform) {
    setBusy(key);
    try {
      await disconnectPlatform(key);
      await refresh();
      showToast(`${PLUGINS.find((plugin) => plugin.key === key)?.name} disconnected.`);
    } catch (cause) {
      showToast(cause instanceof Error ? cause.message : 'Could not disconnect. Try again.', 'danger');
    } finally {
      setBusy(null);
      setDisconnecting(null);
    }
  }

  const shown = PLUGINS.filter((plugin) => filter === 'all' || state(plugin.key)?.connected);
  const columns = gridWidth >= 840 ? 3 : gridWidth >= 520 ? 2 : 1;
  const cellWidth = gridWidth ? (gridWidth - 16 * (columns - 1)) / columns : undefined;
  const confirmPlugin = PLUGINS.find((plugin) => plugin.key === disconnecting);

  return (
    <>
      <ScrollView style={styles.fill} contentContainerStyle={[styles.page, { padding: isCompact ? Spacing.three : 28 }]}>
        <View style={styles.header}>
          <ThemedText type="pageTitle" accessibilityRole="header">
            Plugins
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            Connect your channels so Synq can publish there — always after you approve.
          </ThemedText>
        </View>

        <Tabs label="Plugin filter" items={FILTERS} value={filter} onChange={setFilter} />

        {statusError ? <InlineAlert tone="warning" message={statusError} action={<Button label="Try again" size="sm" onPress={() => void refresh()} />} /> : null}

        {shown.length === 0 ? (
          <EmptyState
            title="Nothing connected yet"
            description="Connect YouTube, Instagram or X to publish your reels there."
            action={{ label: 'Show all plugins', onPress: () => setFilter('all') }}
          />
        ) : (
          <View style={styles.grid} onLayout={(event) => setGridWidth(event.nativeEvent.layout.width)}>
            {shown.map((plugin) => {
              const current = state(plugin.key);
              const status = statusOf(current, loading);
              const label = current?.connected ? 'Manage' : current?.reconnect ? 'Reconnect' : current?.unconfigured ? 'View setup' : 'Connect';
              return (
                <View key={plugin.key} style={{ width: cellWidth }}>
                  <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
                    <View style={styles.cardTop}>
                      <PlatformMark platform={plugin.key} size={44} />
                      <PluginMenu
                        name={plugin.name}
                        connected={Boolean(current?.connected)}
                        onDetails={() => openDetails(plugin.key)}
                        onDisconnect={() => setDisconnecting(plugin.key)}
                      />
                    </View>
                    <View style={styles.cardText}>
                      <ThemedText type="cardTitle">{plugin.name}</ThemedText>
                      <ThemedText type="small" themeColor="textSecondary" style={styles.description}>
                        {plugin.description}
                      </ThemedText>
                    </View>
                    <View style={styles.tagRow}>
                      <StatusBadge label={plugin.category} tone={plugin.tone} dot={false} />
                    </View>
                    <View style={styles.statusLine}>
                      <StatusBadge label={status.label} tone={status.tone} />
                      {current?.connected && current.account ? (
                        <ThemedText type="caption" themeColor="textSecondary" numberOfLines={1} style={styles.account}>
                          {current.account}
                        </ThemedText>
                      ) : null}
                    </View>
                    <Button
                      label={label}
                      variant={current?.connected ? 'secondary' : 'primary'}
                      size="sm"
                      fullWidth
                      loading={busy === plugin.key}
                      disabled={busy !== null || (loading && !current)}
                      accessibilityLabel={`${label} ${plugin.name}`}
                      onPress={() => void (current?.connected ? openDetails(plugin.key) : connect(plugin))}
                    />
                  </View>
                </View>
              );
            })}
          </View>
        )}
      </ScrollView>

      <ConfirmDialog
        visible={Boolean(confirmPlugin)}
        title={`Disconnect ${confirmPlugin?.name ?? ''}?`}
        description="Synq will stop publishing there until you connect it again. Posts already published stay up."
        confirmLabel="Disconnect"
        busy={busy !== null}
        onConfirm={() => confirmPlugin && void disconnect(confirmPlugin.key)}
        onClose={() => setDisconnecting(null)}
      />
    </>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  page: { width: '100%', maxWidth: PageMaxWidth, alignSelf: 'center', gap: Spacing.four },
  header: { gap: 4 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 16 },
  card: { borderWidth: 1, borderRadius: Radius.card, padding: 18, gap: 12 },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  cardText: { gap: 4 },
  description: { minHeight: 38 },
  tagRow: { flexDirection: 'row' },
  statusLine: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 22 },
  account: { flex: 1 },
  more: { width: 30, height: 30, borderRadius: 8, alignItems: 'center', justifyContent: 'center', marginRight: -6, marginTop: -4 },
  menuItem: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 10, paddingVertical: 10, borderRadius: 8 },
  menuText: { fontSize: 14, fontWeight: '500' },
});
