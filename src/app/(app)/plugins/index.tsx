import { LinearGradient } from 'expo-linear-gradient';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState, type ReactNode } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { GmailMark, PlatformMark, InstagramMark, XMark, YouTubeMark } from '@/components/brand-icons';
import { ArrowIcon, ExternalLinkIcon, MoreVerticalIcon, RefreshIcon, UnlinkIcon } from '@/components/icons';
import { ThemedText } from '@/components/themed-text';
import {
  Button,
  ConfirmDialog,
  EmptyState,
  InlineAlert,
  Popover,
  SearchInput,
  Select,
  StatusBadge,
  Tabs,
  showToast,
  transition,
  useBreakpoint,
  type Tone,
} from '@/components/ui';
import { PageMaxWidth, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { connectGmail, disconnectGmail, gmailStatus, type GmailStatus } from '@/lib/outreach';
import { connectPlatform, disconnectPlatform, loadConnections, SocialError, type Connection, type SocialPlatform } from '@/lib/social';

// The plugin directory. Two kinds of entry:
//
// - Live plugins (YouTube, Instagram, X, Gmail) are backed by real OAuth flows.
//   Their status comes from the server's own check of the stored connection,
//   never from the click, and their buttons start that flow.
// - Planned plugins are listed so people can see what is coming, but they carry
//   a "Coming soon" label instead of a button: nothing here may look as if it
//   connects when it does not.

type Category = 'video' | 'social' | 'communication' | 'sales' | 'productivity' | 'ai';
type Filter = 'all' | 'connected' | Category;
type Sort = 'popular' | 'name';
type LiveKey = SocialPlatform | 'gmail';

const CATEGORY_LABEL: Record<Category, string> = {
  video: 'Video & Content',
  social: 'Social Media',
  communication: 'Communication',
  sales: 'Sales & Leads',
  productivity: 'Productivity',
  ai: 'AI Tools',
};

const CATEGORY_TONE: Record<Category, Tone> = {
  video: 'danger',
  social: 'info',
  communication: 'success',
  sales: 'accent',
  productivity: 'warning',
  ai: 'neutral',
};

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'connected', label: 'Connected' },
  { key: 'video', label: 'Video & Content' },
  { key: 'social', label: 'Social Media' },
  { key: 'communication', label: 'Communication' },
  { key: 'sales', label: 'Sales & Leads' },
  { key: 'productivity', label: 'Productivity' },
  { key: 'ai', label: 'AI Tools' },
];

type LivePlugin = { key: LiveKey; name: string; category: Category; description: string };
type PlannedPlugin = { name: string; category: Category; description: string; color: string };

const LIVE: LivePlugin[] = [
  { key: 'youtube', name: 'YouTube', category: 'video', description: 'Publish approved reels to your channel as Shorts.' },
  { key: 'instagram', name: 'Instagram', category: 'social', description: 'Publish approved reels to a professional account.' },
  { key: 'gmail', name: 'Gmail', category: 'communication', description: 'Send approved email duties from your own address.' },
  { key: 'x', name: 'X', category: 'social', description: 'Post approved short videos with a caption.' },
];

const PLANNED: PlannedPlugin[] = [
  { name: 'LinkedIn', category: 'social', description: 'Share posts and articles with your network.', color: '#0A66C2' },
  { name: 'TikTok', category: 'social', description: 'Post short videos and track how they perform.', color: '#111111' },
  { name: 'Google Drive', category: 'productivity', description: 'Save and open files across your workspace.', color: '#1FA463' },
  { name: 'Notion', category: 'productivity', description: 'Sync notes, docs and company knowledge.', color: '#2F2F2F' },
  { name: 'Slack', category: 'communication', description: 'Get notified about leads and share updates.', color: '#611F69' },
  { name: 'Calendly', category: 'productivity', description: 'Let leads book meetings automatically.', color: '#006BFF' },
  { name: 'HubSpot', category: 'sales', description: 'Keep your CRM contacts in sync.', color: '#FF7A59' },
  { name: 'Google Maps', category: 'sales', description: 'Find businesses and their contact details.', color: '#34A853' },
  { name: 'Stripe', category: 'sales', description: 'Accept payments and manage billing.', color: '#635BFF' },
  { name: 'ElevenLabs', category: 'ai', description: 'Generate natural-sounding voice-overs.', color: '#111111' },
  { name: 'Zapier', category: 'productivity', description: 'Connect thousands of apps with workflows.', color: '#FF4F00' },
  { name: 'Airtable', category: 'productivity', description: 'Manage data and projects in shared tables.', color: '#18BFFF' },
];

const SORTS: { value: Sort; label: string }[] = [
  { value: 'popular', label: 'Most popular' },
  { value: 'name', label: 'Name A–Z' },
];

type LiveState = {
  connected: boolean;
  /** Connected, but the provider no longer accepts the stored login. */
  reconnect: boolean;
  /** The server is missing this plugin's credentials. */
  unconfigured: boolean;
  account: string | null;
};

function liveStatus(state: LiveState | undefined, loading: boolean): { label: string; tone: Tone } {
  if (!state) return loading ? { label: 'Checking…', tone: 'neutral' } : { label: 'Status unavailable', tone: 'neutral' };
  if (state.connected) return { label: 'Connected', tone: 'success' };
  if (state.reconnect) return { label: 'Reconnect needed', tone: 'warning' };
  if (state.unconfigured) return { label: 'Setup required', tone: 'neutral' };
  return { label: 'Not connected', tone: 'neutral' };
}

function LiveMark({ plugin, size }: { plugin: LiveKey; size: number }) {
  return <PlatformMark platform={plugin} size={size} />;
}

/** A coloured monogram for planned plugins: Synq ships no artwork for services it does not connect to. */
function Monogram({ name, color, size }: { name: string; color: string; size: number }) {
  return (
    <View style={[styles.monogram, { width: size, height: size, backgroundColor: color, borderRadius: size * 0.26 }]}>
      <Text style={[styles.monogramText, { fontSize: size * 0.42 }]}>{name[0]}</Text>
    </View>
  );
}

/** The ⋮ button on a live plugin card and the small menu it opens. */
function PluginMenu({
  name,
  detailsLabel,
  connected,
  onDetails,
  onDisconnect,
}: {
  name: string;
  detailsLabel: string;
  connected: boolean;
  onDetails: () => void;
  onDisconnect: () => void;
}) {
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
          <Text style={[styles.menuText, { color: theme.text }]}>{detailsLabel}</Text>
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

function PluginCard({
  icon,
  name,
  description,
  category,
  footer,
  menu,
  compact,
}: {
  icon: ReactNode;
  name: string;
  description: string;
  category: Category;
  footer: ReactNode;
  menu?: ReactNode;
  compact?: boolean;
}) {
  const theme = useTheme();
  return (
    <View style={[styles.card, compact && styles.cardCompact, { backgroundColor: theme.surface, borderColor: theme.border }]}>
      <View style={styles.cardTop}>
        {icon}
        {menu}
      </View>
      <View style={styles.cardText}>
        <ThemedText type="cardTitle" numberOfLines={1}>
          {name}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary" numberOfLines={2} style={styles.description}>
          {description}
        </ThemedText>
      </View>
      <View style={styles.tagRow}>
        <StatusBadge label={CATEGORY_LABEL[category]} tone={CATEGORY_TONE[category]} dot={false} />
      </View>
      {footer}
    </View>
  );
}

export default function PluginsDirectory() {
  const theme = useTheme();
  const { width, isCompact } = useBreakpoint();
  const scrollRef = useRef<ScrollView>(null);
  const allY = useRef(0);

  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<Sort>('popular');
  const [connections, setConnections] = useState<Connection[] | null>(null);
  const [gmail, setGmail] = useState<GmailStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [statusError, setStatusError] = useState('');
  const [busy, setBusy] = useState<LiveKey | null>(null);
  const [disconnecting, setDisconnecting] = useState<LiveKey | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    const [social, mail] = await Promise.allSettled([loadConnections(), gmailStatus()]);
    setConnections(social.status === 'fulfilled' ? social.value : null);
    setGmail(mail.status === 'fulfilled' ? mail.value : null);
    setStatusError(
      social.status === 'rejected' && mail.status === 'rejected'
        ? 'Could not check your plugin connections. Check your internet connection and refresh.'
        : social.status === 'rejected'
          ? 'Could not check YouTube, Instagram and X right now.'
          : mail.status === 'rejected'
            ? 'Could not check Gmail right now.'
            : '',
    );
    setLoading(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh]),
  );

  const state = (key: LiveKey): LiveState | undefined => {
    if (key === 'gmail') {
      return gmail ? { connected: gmail.connected, reconnect: false, unconfigured: !gmail.configured, account: gmail.email } : undefined;
    }
    const row = connections?.find((item) => item.platform === key);
    if (!connections) return undefined;
    return {
      connected: Boolean(row?.connected),
      reconnect: Boolean(row?.needs_reconnect),
      unconfigured: row ? !row.configured : false,
      account: row?.account_name ?? null,
    };
  };

  const openDetails = (key: LiveKey) => {
    if (key === 'gmail') router.push('/sales?view=email' as Parameters<typeof router.push>[0]);
    else router.push(`/plugins/${key}` as Parameters<typeof router.push>[0]);
  };

  async function connect(key: LiveKey) {
    const current = state(key);
    // Anything that is not a plain "connect now" — already connected, missing
    // server setup, or status unknown — goes to the page that explains it.
    if (!current || current.connected || current.unconfigured) {
      openDetails(key);
      return;
    }
    if (key === 'gmail') {
      // Gmail's sign-in returns to the web page that started it; the phone app
      // uses the same flow from Email duties.
      if (Platform.OS !== 'web') {
        openDetails('gmail');
        return;
      }
      setBusy('gmail');
      try {
        const { url } = await connectGmail(window.location.origin);
        window.location.assign(url);
      } catch (cause) {
        setBusy(null);
        showToast(cause instanceof Error ? cause.message : 'Could not start the Gmail sign-in.', 'danger');
      }
      return;
    }
    setBusy(key);
    try {
      await connectPlatform(key);
      await refresh();
      showToast(`${LIVE.find((plugin) => plugin.key === key)?.name} connected.`);
    } catch (cause) {
      showToast(cause instanceof SocialError || cause instanceof Error ? cause.message : 'Connecting did not complete.', 'danger');
    } finally {
      setBusy(null);
    }
  }

  async function disconnect(key: LiveKey) {
    setBusy(key);
    try {
      if (key === 'gmail') await disconnectGmail();
      else await disconnectPlatform(key);
      await refresh();
      showToast(`${LIVE.find((plugin) => plugin.key === key)?.name} disconnected.`);
    } catch (cause) {
      showToast(cause instanceof Error ? cause.message : 'Could not disconnect. Try again.', 'danger');
    } finally {
      setBusy(null);
      setDisconnecting(null);
    }
  }

  const exploreAll = () => {
    setFilter('all');
    setQuery('');
    scrollRef.current?.scrollTo({ y: Math.max(0, allY.current - 12), animated: true });
  };

  const needle = query.trim().toLowerCase();
  const matches = (name: string, description: string, category: Category) =>
    (!needle || `${name} ${description} ${CATEGORY_LABEL[category]}`.toLowerCase().includes(needle)) &&
    (filter === 'all' || filter === 'connected' || filter === category);

  const liveShown = LIVE.filter((plugin) => matches(plugin.name, plugin.description, plugin.category)).filter(
    (plugin) => filter !== 'connected' || state(plugin.key)?.connected,
  );
  const plannedShown = filter === 'connected' ? [] : PLANNED.filter((plugin) => matches(plugin.name, plugin.description, plugin.category));
  const all = [
    ...liveShown.map((plugin) => ({ kind: 'live' as const, plugin })),
    ...plannedShown.map((plugin) => ({ kind: 'planned' as const, plugin })),
  ];
  if (sort === 'name') all.sort((a, b) => a.plugin.name.localeCompare(b.plugin.name));

  // Cards take a fixed share of the measured grid width rather than growing to
  // fill a row, so a search that leaves one result does not stretch it across the page.
  const [gridWidth, setGridWidth] = useState(0);
  const GAP = 16;
  const cellWidth = (columns: number) => (gridWidth ? (gridWidth - GAP * (columns - 1)) / columns : undefined);
  const allColumns = gridWidth >= 1350 ? 6 : gridWidth >= 900 ? 4 : gridWidth >= 640 ? 3 : gridWidth >= 420 ? 2 : 1;
  const readyColumns = gridWidth >= 900 ? 4 : gridWidth >= 420 ? 2 : 1;

  const liveFooter = (plugin: LivePlugin) => {
    const current = state(plugin.key);
    const status = liveStatus(current, loading);
    const label = current?.connected ? 'Manage' : current?.reconnect ? 'Reconnect' : current?.unconfigured ? 'View setup' : 'Connect';
    return (
      <View style={styles.footer}>
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
          onPress={() => void (current?.connected ? openDetails(plugin.key) : connect(plugin.key))}
        />
      </View>
    );
  };

  const liveMenu = (plugin: LivePlugin) => (
    <PluginMenu
      name={plugin.name}
      detailsLabel={plugin.key === 'gmail' ? 'Open Email duties' : 'View details'}
      connected={Boolean(state(plugin.key)?.connected)}
      onDetails={() => openDetails(plugin.key)}
      onDisconnect={() => setDisconnecting(plugin.key)}
    />
  );

  const liveCard = (plugin: LivePlugin, compact = false) => (
    <PluginCard
      key={plugin.key}
      compact={compact}
      icon={<LiveMark plugin={plugin.key} size={compact ? 40 : 44} />}
      name={plugin.name}
      description={plugin.description}
      category={plugin.category}
      menu={liveMenu(plugin)}
      footer={liveFooter(plugin)}
    />
  );

  const plannedCard = (plugin: PlannedPlugin) => (
    <PluginCard
      key={plugin.name}
      compact
      icon={<Monogram name={plugin.name} color={plugin.color} size={40} />}
      name={plugin.name}
      description={plugin.description}
      category={plugin.category}
      footer={
        <View style={[styles.soon, { borderColor: theme.border, backgroundColor: theme.surfaceRaised }]}>
          <Text style={[styles.soonText, { color: theme.textSecondary }]}>Coming soon</Text>
        </View>
      }
    />
  );

  const confirmPlugin = LIVE.find((plugin) => plugin.key === disconnecting);

  return (
    <>
      <ScrollView ref={scrollRef} style={styles.fill} contentContainerStyle={[styles.page, { padding: isCompact ? Spacing.three : 28 }]}>
        <View style={styles.header}>
          <View style={styles.headerText}>
            <ThemedText type="pageTitle" accessibilityRole="header">
              Plugins
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              Extend Synq with the tools your business already uses.
            </ThemedText>
          </View>
          <Button label="Refresh status" icon={RefreshIcon} size="sm" loading={loading} onPress={() => void refresh()} />
        </View>

        <Tabs label="Plugin categories" items={FILTERS} value={filter} onChange={setFilter} />

        <LinearGradient
          colors={['#111210', '#1A1A16', '#2A2210']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={[styles.hero, isCompact && styles.heroCompact]}
        >
          {/* The rotated beam overflows its box; this clipped layer keeps it from
              making the banner itself scrollable when a button inside takes focus. */}
          <View pointerEvents="none" style={styles.heroClip}>
            <View style={styles.heroBeam}>
              <LinearGradient
                colors={['rgba(255, 212, 90, 0)', 'rgba(255, 212, 90, 0.35)', 'rgba(255, 212, 90, 0)']}
                start={{ x: 0, y: 0.5 }}
                end={{ x: 1, y: 0.5 }}
                style={styles.heroBeamLine}
              />
            </View>
          </View>
          <View style={styles.heroText}>
            <Text style={[styles.heroTitle, isCompact && styles.heroTitleCompact]}>Supercharge your business with plugins.</Text>
            <Text style={styles.heroBody}>Connect your channels and inbox so Synq can publish and send for you — always after you approve.</Text>
            <View style={styles.heroAction}>
              <Button label="Explore plugins" variant="primary" iconRight={ArrowIcon} onPress={exploreAll} />
            </View>
          </View>
          {width >= 900 ? (
            <View style={styles.heroArt} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
              {[
                { mark: <YouTubeMark size={44} />, style: { top: 46, left: 10, transform: [{ rotate: '-8deg' }] } },
                { mark: <InstagramMark size={44} />, style: { top: 6, left: 130, transform: [{ rotate: '6deg' }] } },
                { mark: <GmailMark size={44} />, style: { top: 104, left: 112, transform: [{ rotate: '-4deg' }] } },
                { mark: <XMark size={40} />, style: { top: 60, left: 236, transform: [{ rotate: '9deg' }] } },
              ].map((tile, index) => (
                <View key={index} style={[styles.heroTile, tile.style]}>
                  {tile.mark}
                </View>
              ))}
            </View>
          ) : null}
        </LinearGradient>

        {statusError ? <InlineAlert tone="warning" message={statusError} action={<Button label="Try again" size="sm" onPress={() => void refresh()} />} /> : null}

        <View style={styles.section}>
          <View style={styles.sectionHead}>
            <View style={styles.headerText}>
              <ThemedText type="sectionTitle">Ready to connect</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                Plugins that work with Synq today.
              </ThemedText>
            </View>
          </View>
          <View style={styles.grid} onLayout={(event) => setGridWidth(event.nativeEvent.layout.width)}>
            {LIVE.map((plugin) => (
              <View key={plugin.key} style={[styles.cell, { width: cellWidth(readyColumns) }]}>
                {liveCard(plugin)}
              </View>
            ))}
          </View>
        </View>

        <View
          style={styles.section}
          onLayout={(event) => {
            allY.current = event.nativeEvent.layout.y;
          }}
        >
          <View style={styles.sectionHead}>
            <View style={styles.headerText}>
              <ThemedText type="sectionTitle">All plugins</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                Everything available now, and what is coming next.
              </ThemedText>
            </View>
            <View style={[styles.tools, isCompact && styles.toolsCompact]}>
              <SearchInput placeholder="Search plugins…" value={query} onChangeText={setQuery} accessibilityLabel="Search plugins" style={styles.search} />
              <View style={styles.sortBox}>
                <Select label="Sort plugins" value={sort} options={SORTS} onChange={setSort} />
              </View>
            </View>
          </View>
          {all.length === 0 ? (
            <EmptyState
              title={filter === 'connected' && !needle ? 'Nothing connected yet' : `No plugins match${needle ? ` “${query.trim()}”` : ''}`}
              description={filter === 'connected' ? 'Connect YouTube, Instagram, X or Gmail above.' : 'Try another name or category.'}
              action={{ label: 'Show all plugins', onPress: exploreAll }}
            />
          ) : (
            <View style={styles.grid}>
              {all.map((row) => (
                <View key={row.plugin.name} style={[styles.cell, { width: cellWidth(allColumns) }]}>
                  {row.kind === 'live' ? liveCard(row.plugin, true) : plannedCard(row.plugin)}
                </View>
              ))}
            </View>
          )}
        </View>
      </ScrollView>


      <ConfirmDialog
        visible={Boolean(confirmPlugin)}
        title={`Disconnect ${confirmPlugin?.name ?? ''}?`}
        description={
          confirmPlugin?.key === 'gmail'
            ? 'Synq will stop sending email duties and checking replies until you connect Gmail again.'
            : 'Synq will stop publishing there until you connect it again. Posts already published stay up.'
        }
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
  header: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' },
  headerText: { flexShrink: 1, gap: 4 },
  hero: { borderRadius: Radius.card + 2, padding: 32, minHeight: 200, flexDirection: 'row', alignItems: 'center', overflow: 'hidden' },
  heroCompact: { padding: 22 },
  heroClip: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, overflow: 'hidden' },
  heroBeam: { position: 'absolute', left: '35%', right: -80, top: 40, height: 140, transform: [{ rotate: '-18deg' }], justifyContent: 'center' },
  heroBeamLine: { height: 60, borderRadius: 30 },
  heroText: { flex: 1, maxWidth: 560, gap: 10 },
  heroTitle: { color: '#F5F4F0', fontSize: 30, fontWeight: '700', letterSpacing: -0.6, lineHeight: 36 },
  heroTitleCompact: { fontSize: 23, lineHeight: 29 },
  heroBody: { color: '#C9C5BC', fontSize: 15, lineHeight: 22 },
  heroAction: { flexDirection: 'row', marginTop: 6 },
  // Wide enough to contain every tile, so the art never overflows the banner.
  heroArt: { width: 330, height: 180 },
  heroTile: {
    position: 'absolute',
    width: 74,
    height: 74,
    borderRadius: 18,
    backgroundColor: '#F5F4F0',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
  },
  section: { gap: Spacing.three },
  sectionHead: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' },
  tools: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  toolsCompact: { width: '100%' },
  search: { width: 300, maxWidth: '100%', flexShrink: 1 },
  sortBox: { width: 170 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 16 },
  cell: { minWidth: 0 },
  card: { flex: 1, borderWidth: 1, borderRadius: Radius.card, padding: 18, gap: 12 },
  cardCompact: { padding: 16, gap: 10 },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  cardText: { gap: 4 },
  description: { minHeight: 38 },
  tagRow: { flexDirection: 'row' },
  footer: { gap: 10, marginTop: 'auto' },
  statusLine: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 22 },
  account: { flex: 1 },
  more: { width: 30, height: 30, borderRadius: 8, alignItems: 'center', justifyContent: 'center', marginRight: -6, marginTop: -4 },
  soon: { marginTop: 'auto', minHeight: 34, borderRadius: Radius.control, borderWidth: 1, borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center' },
  soonText: { fontSize: 13, fontWeight: '600' },
  monogram: { alignItems: 'center', justifyContent: 'center' },
  monogramText: { color: '#FFFFFF', fontWeight: '800' },
  menuItem: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 10, paddingVertical: 10, borderRadius: 8 },
  menuText: { fontSize: 14, fontWeight: '500' },
});
