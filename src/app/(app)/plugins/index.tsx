import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Switch, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';

import { SearchIcon } from '@/components/icons';
import { TextField } from '@/components/text-field';
import { ThemedText } from '@/components/themed-text';
import { AccentColors, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { connectPlatform, disconnectPlatform, loadConnections, setPublishingEnabled, SOCIAL_LABELS, SocialError, type Connection, type SocialPlatform } from '@/lib/social';

type Category = 'All' | 'Social' | 'Video';

const CATEGORIES: Category[] = ['All', 'Social', 'Video'];

const CATALOG: {
  platform: SocialPlatform;
  category: Exclude<Category, 'All'>;
  glyph: string;
  description: string;
}[] = [
  { platform: 'youtube', category: 'Video', glyph: '▶', description: 'Connect a YouTube channel and publish approved Synq reels as Shorts.' },
  { platform: 'instagram', category: 'Social', glyph: '◎', description: 'Connect an Instagram professional account to publish approved reels.' },
  { platform: 'x', category: 'Social', glyph: '𝕏', description: 'Connect X to publish approved short videos with a caption.' },
];

const pushPlugin = (platform: SocialPlatform) =>
  router.push(`/plugins/${platform}` as Parameters<typeof router.push>[0]);

function statusText(connection: Connection | undefined, statusError: string | null) {
  if (statusError) return 'Status unavailable';
  if (!connection) return 'Not connected';
  if (connection.connected) return `Connected${connection.account_name ? ` · ${connection.account_name}` : ''}`;
  if (connection.needs_reconnect) return 'Reconnect required';
  if (connection.verification_error) return 'Could not verify';
  if (!connection.configured) return 'Setup required';
  return 'Not connected';
}

export default function PluginsDirectory() {
  const theme = useTheme();
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<Category>('All');
  const [connections, setConnections] = useState<Connection[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<SocialPlatform | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [toggleBusy, setToggleBusy] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setStatusError(null);
    try {
      setConnections(await loadConnections());
    } catch (error) {
      setStatusError(error instanceof Error ? error.message : 'Could not verify plugin status.');
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { void refresh(); }, [refresh]));

  const visiblePlugins = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return CATALOG.filter((plugin) => {
      const matchesCategory = category === 'All' || plugin.category === category;
      const matchesQuery = !normalizedQuery || `${SOCIAL_LABELS[plugin.platform]} ${plugin.description} ${plugin.category}`.toLowerCase().includes(normalizedQuery);
      return matchesCategory && matchesQuery;
    });
  }, [category, query]);

  async function connect(platform: SocialPlatform) {
    const connection = connections.find((item) => item.platform === platform);
    if (!connection?.configured || statusError || connection.verification_error && !connection.needs_reconnect) {
      pushPlugin(platform);
      return;
    }
    if (connection.connected) {
      pushPlugin(platform);
      return;
    }
    setBusy(platform);
    setActionError(null);
    try {
      await connectPlatform(platform);
      await refresh();
    } catch (error) {
      setActionError(error instanceof SocialError ? error.message : 'Connection did not complete.');
      pushPlugin(platform);
    } finally {
      setBusy(null);
    }
  }

  async function toggleYouTube(enabled: boolean) {
    setToggleBusy(true);
    setActionError(null);
    try {
      await setPublishingEnabled('youtube', enabled);
      await refresh();
    } catch (error) {
      setActionError(error instanceof SocialError ? error.message : 'Could not update the YouTube destination.');
    } finally {
      setToggleBusy(false);
    }
  }

  async function toggleYouTubeConnection(connected: boolean) {
    if (connected) {
      await connect('youtube');
      return;
    }
    setBusy('youtube');
    setActionError(null);
    try {
      await disconnectPlatform('youtube');
      await refresh();
    } catch (error) {
      setActionError(error instanceof SocialError ? error.message : 'Could not disconnect YouTube.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <ThemedText type="pageTitle">Integrations</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          Connect a platform to give Synq permission to publish there. You approve each post before it goes live; Synq verifies the connection first.
        </ThemedText>
      </View>

      <View style={[styles.search, { backgroundColor: theme.surface, borderColor: theme.border }]}>
        <SearchIcon size={18} color={theme.textSecondary} />
        <TextField value={query} onChangeText={setQuery} placeholder="Search plugins" style={styles.searchInput} />
      </View>

      <View style={styles.filters}>
        {CATEGORIES.map((item) => {
          const active = item === category;
          return (
            <Pressable
              key={item}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              onPress={() => setCategory(item)}
              style={[styles.filter, { backgroundColor: active ? AccentColors.primary : theme.surface, borderColor: active ? AccentColors.primary : theme.border }]}
            >
              <ThemedText type="caption" style={{ color: active ? '#111' : theme.textSecondary }}>{item}</ThemedText>
            </Pressable>
          );
        })}
        <View style={styles.filterSpacer} />
        {loading ? <ActivityIndicator size="small" color={AccentColors.primary} /> : null}
        <Pressable accessibilityRole="button" onPress={() => void refresh()}>
          <ThemedText type="caption" style={{ color: AccentColors.primaryLight }}>Refresh status</ThemedText>
        </Pressable>
      </View>

      {statusError ? (
        <View style={[styles.notice, { borderColor: theme.border, backgroundColor: theme.surface }]}>
          <ThemedText type="small" themeColor="textSecondary">{statusError}</ThemedText>
        </View>
      ) : null}
      {actionError ? <ThemedText type="small" style={{ color: AccentColors.error }}>{actionError}</ThemedText> : null}

      <View style={styles.grid}>
        {visiblePlugins.map((plugin) => {
          const connection = connections.find((item) => item.platform === plugin.platform);
          const status = statusText(connection, statusError);
          const connected = Boolean(connection?.connected);
          const reconnect = Boolean(connection?.needs_reconnect);
          return (
            <View key={plugin.platform} style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`View ${SOCIAL_LABELS[plugin.platform]} plugin details`}
                onPress={() => pushPlugin(plugin.platform)}
                style={({ hovered }) => [styles.cardMain, hovered && { backgroundColor: theme.surfaceRaised }]}
              >
                <View style={[styles.brandIcon, { borderColor: theme.border, backgroundColor: theme.surfaceRaised }]}>
                  <ThemedText type="sectionTitle" style={{ color: plugin.platform === 'youtube' ? '#ff5a52' : theme.text }}>{plugin.glyph}</ThemedText>
                </View>
                <View style={styles.cardCopy}>
                  <View style={styles.titleRow}>
                    <ThemedText type="sectionTitle">{SOCIAL_LABELS[plugin.platform]}</ThemedText>
                    <ThemedText type="caption" themeColor="textSecondary">{plugin.category}</ThemedText>
                  </View>
                  <ThemedText type="small" themeColor="textSecondary">{plugin.description}</ThemedText>
                  <ThemedText type="caption" style={{ color: connected ? AccentColors.success : reconnect ? AccentColors.warning : theme.textSecondary }}>
                    {status}
                  </ThemedText>
                </View>
              </Pressable>
              {plugin.platform === 'youtube' ? (
                <View style={styles.youtubeControls}>
                  <View style={styles.destinationToggle}>
                    <View style={styles.destinationCopy}>
                      <ThemedText type="smallBold">YouTube account</ThemedText>
                      <ThemedText type="caption" themeColor="textSecondary">
                        {connected
                          ? `Connected${connection?.account_name ? ` · ${connection.account_name}` : ''}`
                          : reconnect ? 'Authorization expired · reconnect required' : connection?.configured === false ? 'Server setup required' : 'Not connected'}
                      </ThemedText>
                    </View>
                    <Switch
                      accessibilityLabel={connected ? 'Disconnect YouTube account' : 'Connect YouTube account'}
                      value={connected}
                      onValueChange={(value) => void toggleYouTubeConnection(value)}
                      disabled={busy === plugin.platform || connection?.configured === false}
                      trackColor={{ false: theme.border, true: AccentColors.primary }}
                    />
                  </View>
                  {connected ? (
                    <View style={styles.destinationToggle}>
                      <View style={styles.destinationCopy}>
                        <ThemedText type="smallBold">Marketing destination</ThemedText>
                        <ThemedText type="caption" themeColor="textSecondary">{connection?.publishing_enabled ? 'Enabled' : 'Disabled'}</ThemedText>
                      </View>
                      <Switch
                        accessibilityLabel="Enable YouTube publishing destination"
                        value={Boolean(connection?.publishing_enabled)}
                        onValueChange={(enabled) => void toggleYouTube(enabled)}
                        disabled={toggleBusy}
                        trackColor={{ false: theme.border, true: AccentColors.primary }}
                      />
                    </View>
                  ) : null}
                </View>
              ) : (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${reconnect ? 'Reconnect' : 'Connect'} ${SOCIAL_LABELS[plugin.platform]}`}
                  onPress={() => void connect(plugin.platform)}
                  disabled={busy === plugin.platform}
                  style={({ pressed }) => [styles.connectButton, { backgroundColor: AccentColors.primary, borderColor: AccentColors.primary, opacity: busy === plugin.platform ? 0.7 : pressed ? 0.8 : 1 }]}
                >
                  {busy === plugin.platform ? <ActivityIndicator size="small" color="#111" /> : (
                    <ThemedText type="smallBold" style={{ color: '#111' }}>{reconnect ? 'Reconnect' : '+ Connect'}</ThemedText>
                  )}
                </Pressable>
              )}
            </View>
          );
        })}
      </View>

      {visiblePlugins.length === 0 ? (
        <View style={[styles.notice, { borderColor: theme.border, backgroundColor: theme.surface }]}>
          <ThemedText type="small" themeColor="textSecondary">No plugins match “{query}”.</ThemedText>
        </View>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { gap: Spacing.three, padding: Spacing.five, width: '100%', maxWidth: 1120, alignSelf: 'center' },
  header: { gap: Spacing.one, marginBottom: Spacing.one },
  search: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, borderWidth: 1, borderRadius: Radius.card, paddingHorizontal: Spacing.three },
  searchInput: { flex: 1, borderWidth: 0, backgroundColor: 'transparent', paddingHorizontal: 0 },
  filters: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, flexWrap: 'wrap' },
  filter: { paddingVertical: Spacing.two, paddingHorizontal: Spacing.three, borderRadius: Radius.pill, borderWidth: 1 },
  filterSpacer: { flex: 1 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.three },
  card: { width: '48%', minWidth: 280, flexGrow: 1, gap: Spacing.three, borderWidth: 1, borderRadius: Radius.card, padding: Spacing.three },
  cardMain: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.three, borderRadius: Radius.control, padding: Spacing.one },
  brandIcon: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center', borderRadius: Radius.card, borderWidth: 1 },
  cardCopy: { flex: 1, gap: Spacing.one },
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.two },
  connectButton: { minHeight: 40, alignItems: 'center', justifyContent: 'center', paddingHorizontal: Spacing.three, borderRadius: Radius.control, borderWidth: 1, alignSelf: 'flex-end' },
  destinationToggle: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.two, paddingHorizontal: Spacing.one },
  destinationCopy: { gap: Spacing.one },
  youtubeControls: { flex: 1, gap: Spacing.two },
  notice: { padding: Spacing.three, borderRadius: Radius.card, borderWidth: 1 },
});
