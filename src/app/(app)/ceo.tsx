import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useState, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useLayoutWidth } from '@/components/phone-frame';

import { ActivityLineChart, DonutChart, SERIES_COLORS } from '@/components/charts';
import {
  ArrowIcon,
  BoltIcon,
  CheckCircleIcon,
  ClockIcon,
  CrownIcon,
  InboxIcon,
  PlugIcon,
  SearchIcon,
  UsersIcon,
} from '@/components/icons';
import { ModalSheet } from '@/components/modal-sheet';
import { TextField } from '@/components/text-field';
import { ThemedText } from '@/components/themed-text';
import { AccentColors, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import {
  AdminError,
  ago,
  loadFeed,
  loadSnapshot,
  loadUserDetail,
  searchPlatform,
  toChartDays,
  type AdminEvent,
  type AdminUser,
  type Integration,
  type SearchHit,
  type Severity,
  type Snapshot,
  type UserDetail,
} from '@/lib/admin';

// The CEO Control Center: the whole platform on one page, for the two accounts
// allowed to see it.
//
// Three rules this screen keeps:
//
//   1. **The server decides.** Every byte here comes from the `admin-console`
//      Edge Function, which checks `app_admins` before it reads anything. This
//      file renders a 403 as plainly as it renders data.
//   2. **Activity, not content.** Counts, statuses and timings — never the text
//      of anyone's messages, prompts or call notes. Running the company is not
//      a reason to read the work.
//   3. **Say what is missing.** Revenue, organisations and automations have no
//      data source in Synq today. They appear as named gaps with the reason,
//      never as a zero that reads like a measurement.

const CARD_RADIUS = 18;
const CONTENT_MAX_WIDTH = 1420;
/** Above this the feed sits beside the page; below, it stacks under it. */
const TWO_COLUMN = 1120;
const SHEEN = ['rgba(255, 255, 255, 0.05)', 'rgba(255, 255, 255, 0.01)', 'transparent'] as const;

/** How often the activity feed re-reads. Synq polls rather than subscribing. */
const FEED_INTERVAL_MS = 15000;

const severityColor = (severity: Severity) =>
  severity === 'error' ? AccentColors.error : severity === 'warning' ? AccentColors.warning : AccentColors.primary;

const STATUS_COLOR: Record<Integration['status'], string> = {
  healthy: AccentColors.success,
  failing: AccentColors.error,
  idle: AccentColors.warning,
  not_configured: '#6b7280',
};

const STATUS_LABEL: Record<Integration['status'], string> = {
  healthy: 'Healthy',
  failing: 'Failing',
  idle: 'Idle',
  not_configured: 'Not configured',
};

function GlassCard({ children, style }: { children: ReactNode; style?: object }) {
  const theme = useTheme();
  return (
    <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }, style]}>
      <LinearGradient
        pointerEvents="none"
        colors={SHEEN}
        style={StyleSheet.absoluteFill}
        start={{ x: 0, y: 0 }}
        end={{ x: 0.6, y: 1 }}
      />
      {children}
    </View>
  );
}

function SectionHead({ title, subtitle, trailing }: { title: string; subtitle?: string; trailing?: ReactNode }) {
  return (
    <View style={styles.sectionHead}>
      <View style={styles.sectionHeadText}>
        <ThemedText type="sectionTitle">{title}</ThemedText>
        {subtitle ? (
          <ThemedText type="caption" themeColor="textSecondary">
            {subtitle}
          </ThemedText>
        ) : null}
      </View>
      {trailing}
    </View>
  );
}

function Metric({ label, value, note, icon, tint }: { label: string; value: string; note: string; icon: ReactNode; tint: string }) {
  return (
    <GlassCard style={styles.metricCard}>
      <View style={styles.metricTop}>
        <View style={[styles.tile, { backgroundColor: tint }]}>{icon}</View>
        <ThemedText type="caption" themeColor="textSecondary" style={styles.metricLabel}>
          {label}
        </ThemedText>
      </View>
      <ThemedText type="metric">{value}</ThemedText>
      <ThemedText type="caption" themeColor="textSecondary">
        {note}
      </ThemedText>
    </GlassCard>
  );
}

function Dot({ color }: { color: string }) {
  return <View style={[styles.dot, { backgroundColor: color }]} />;
}

/** A column of label/value rows — the console's substitute for a real table. */
function Row({ cells, widths, muted }: { cells: ReactNode[]; widths: number[]; muted?: boolean }) {
  const theme = useTheme();
  return (
    <View style={[styles.row, { borderColor: theme.border }, muted && styles.rowMuted]}>
      {cells.map((cell, index) => (
        <View key={index} style={{ flexGrow: widths[index], flexShrink: 1, flexBasis: 0 }}>
          {cell}
        </View>
      ))}
    </View>
  );
}

function Gap({ title, reason, needed }: { title: string; reason: string; needed: string }) {
  const theme = useTheme();
  return (
    <View style={[styles.gap, { borderColor: theme.border }]}>
      <ThemedText type="smallBold">{title}</ThemedText>
      <ThemedText type="caption" themeColor="textSecondary">
        {reason}
      </ThemedText>
      <ThemedText type="caption" themeColor="accentText">
        Needs: {needed}
      </ThemedText>
    </View>
  );
}

export default function CeoScreen() {
  const theme = useTheme();
  const width = useLayoutWidth();
  const roomy = width >= TWO_COLUMN;

  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [events, setEvents] = useState<AdminEvent[]>([]);
  const [feedAt, setFeedAt] = useState<number | null>(null);
  const [error, setError] = useState<{ message: string; forbidden: boolean } | null>(null);
  const [attempt, setAttempt] = useState(0);

  const [query, setQuery] = useState('');
  // Results carry the term they answered, so a stale reply can never be shown
  // against a newer query — and the empty case is derived, not stored.
  const [hits, setHits] = useState<{ term: string; results: SearchHit[] }>({ term: '', results: [] });
  const [detail, setDetail] = useState<UserDetail | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);

  // The snapshot: everything except the feed, loaded once per visit.
  useEffect(() => {
    let live = true;
    loadSnapshot()
      .then((result) => {
        if (!live) return;
        setSnapshot(result);
        setError(null);
      })
      .catch((cause: unknown) => {
        if (!live) return;
        const admin = cause instanceof AdminError;
        setError({
          message: admin ? cause.message : 'Could not load the control centre.',
          forbidden: admin ? cause.forbidden : false,
        });
      });
    return () => {
      live = false;
    };
  }, [attempt]);

  // The feed, on its own clock. Synq has no Realtime subscriptions anywhere
  // (see the architecture notes); polling keeps this consistent with the rest
  // of the app and needs no extra database configuration.
  useEffect(() => {
    let live = true;
    const pull = () => {
      loadFeed(50)
        .then((result) => {
          if (!live) return;
          setEvents(result.events);
          setFeedAt(Date.now());
        })
        .catch(() => {
          /* The snapshot already reports a broken connection. */
        });
    };
    pull();
    const timer = setInterval(pull, FEED_INTERVAL_MS);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [attempt]);

  // Search, debounced so typing does not fire a request per keystroke.
  useEffect(() => {
    const term = query.trim();
    if (term.length < 2) return;
    let live = true;
    const timer = setTimeout(() => {
      searchPlatform(term)
        .then((result) => {
          if (live) setHits({ term, results: result.results });
        })
        .catch(() => {
          if (live) setHits({ term, results: [] });
        });
    }, 300);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [query]);

  const visibleHits = hits.term === query.trim() ? hits.results : [];

  const openUser = (userId: string) => {
    setDetailOpen(true);
    setDetail(null);
    loadUserDetail(userId)
      .then(setDetail)
      .catch(() => setDetail(null));
  };

  if (error) {
    return (
      <View style={styles.centre}>
        <GlassCard style={styles.errorCard}>
          <View style={[styles.tile, { backgroundColor: 'rgba(229, 72, 77, 0.14)' }]}>
            <CrownIcon size={18} color={AccentColors.error} />
          </View>
          <ThemedText type="sectionTitle">
            {error.forbidden ? 'Not authorized' : 'Could not load'}
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary" style={styles.centreText}>
            {error.message}
          </ThemedText>
          {error.forbidden ? (
            <ThemedText type="caption" themeColor="textSecondary" style={styles.centreText}>
              Access is granted per account in the app_admins table and enforced by the server,
              so nothing on this page loaded.
            </ThemedText>
          ) : (
            <Pressable
              accessibilityRole="button"
              onPress={() => setAttempt((value) => value + 1)}
              style={[styles.retry, { borderColor: theme.border }]}
            >
              <ThemedText type="small">Try again</ThemedText>
            </Pressable>
          )}
        </GlassCard>
      </View>
    );
  }

  if (!snapshot) {
    return (
      <View style={styles.centre}>
        <ActivityIndicator color={AccentColors.primary} />
        <ThemedText type="caption" themeColor="textSecondary" style={styles.centreText}>
          Reading the platform…
        </ThemedText>
      </View>
    );
  }

  const { overview, usage, workforce, alerts, integrations, security, unavailable, users } = snapshot;
  const openAlerts = alerts.length;
  const brokenIntegrations = integrations.filter((row) => row.status === 'failing').length;

  const feedPanel = (
    <GlassCard style={styles.panel}>
      <SectionHead
        title="Live activity"
        subtitle="Everything happening across Synq"
        trailing={
          <View style={styles.live}>
            <Dot color={AccentColors.success} />
            <ThemedText type="caption" themeColor="textSecondary">
              {feedAt ? ago(new Date(feedAt).toISOString()) : 'connecting'}
            </ThemedText>
          </View>
        }
      />
      {events.length === 0 ? (
        <ThemedText type="small" themeColor="textSecondary">
          Nothing recorded yet.
        </ThemedText>
      ) : (
        <View style={styles.feed}>
          {events.slice(0, 22).map((event) => (
            <Pressable
              key={event.id}
              accessibilityRole={event.userId ? 'button' : 'text'}
              disabled={!event.userId}
              onPress={() => event.userId && openUser(event.userId)}
              style={({ hovered }) => [
                styles.feedRow,
                { borderColor: theme.border, backgroundColor: hovered ? theme.surfaceRaised : 'transparent' },
              ]}
            >
              <View style={styles.feedDot}>
                <Dot color={severityColor(event.severity)} />
              </View>
              <View style={styles.feedBody}>
                <ThemedText type="small" numberOfLines={2}>
                  {event.summary}
                </ThemedText>
                <ThemedText type="caption" themeColor="textSecondary" numberOfLines={1}>
                  {event.email ?? 'platform'} · {ago(event.createdAt)}
                  {event.backfilled ? ' · from history' : ''}
                </ThemedText>
              </View>
            </Pressable>
          ))}
        </View>
      )}
      <ThemedText type="caption" themeColor="textSecondary" style={styles.footnote}>
        Refreshes every {FEED_INTERVAL_MS / 1000}s. Events marked “from history” were reconstructed
        from row timestamps when the event log was added; everything since is recorded as it happens.
      </ThemedText>
    </GlassCard>
  );

  return (
    <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
      <View style={styles.page}>
        {/* Header ---------------------------------------------------------- */}
        <GlassCard style={styles.hero}>
          <View style={styles.heroRow}>
            <View style={styles.heroText}>
              <View style={styles.heroBadge}>
                <CrownIcon size={13} color={AccentColors.primaryLight} />
                <ThemedText type="caption" themeColor="accentText">
                  {snapshot.viewer.role === 'ceo' ? 'CEO' : 'ADMIN'}
                </ThemedText>
              </View>
              <ThemedText type="pageTitle">Control Center</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                Every number below is counted from Synq&apos;s own rows, read {ago(snapshot.generatedAt)}.
              </ThemedText>
            </View>
            <Pressable
              accessibilityRole="button"
              onPress={() => setAttempt((value) => value + 1)}
              style={({ hovered }) => [
                styles.refresh,
                { borderColor: theme.border, backgroundColor: hovered ? theme.surfaceRaised : 'transparent' },
              ]}
            >
              <ClockIcon size={15} color={theme.textSecondary} />
              <ThemedText type="small" themeColor="textSecondary">
                Refresh
              </ThemedText>
            </Pressable>
          </View>

          {/* Global search ------------------------------------------------- */}
          <View style={styles.searchWrap}>
            <View style={[styles.searchIcon, { borderColor: theme.border, backgroundColor: theme.surfaceRaised }]}>
              <SearchIcon size={16} color={theme.textSecondary} />
            </View>
            <View style={styles.searchField}>
              <TextField
                placeholder="Search users, leads, sales runs or events…"
                value={query}
                onChangeText={setQuery}
                autoCapitalize="none"
              />
            </View>
          </View>
          {visibleHits.length > 0 ? (
            <View style={[styles.hits, { borderColor: theme.border, backgroundColor: theme.surfaceRaised }]}>
              {visibleHits.slice(0, 8).map((hit) => (
                <Pressable
                  key={`${hit.kind}-${hit.id}`}
                  accessibilityRole="button"
                  onPress={() => {
                    const target = hit.kind === 'user' ? hit.id : hit.userId;
                    if (target) openUser(target);
                  }}
                  style={({ hovered }) => [
                    styles.hit,
                    { backgroundColor: hovered ? theme.backgroundSelected : 'transparent' },
                  ]}
                >
                  <ThemedText type="caption" style={styles.hitKind} themeColor="accentText">
                    {hit.kind}
                  </ThemedText>
                  <View style={styles.hitBody}>
                    <ThemedText type="small" numberOfLines={1}>
                      {hit.title}
                    </ThemedText>
                    <ThemedText type="caption" themeColor="textSecondary" numberOfLines={1}>
                      {hit.subtitle}
                    </ThemedText>
                  </View>
                  <ArrowIcon size={14} color={theme.textSecondary} />
                </Pressable>
              ))}
            </View>
          ) : null}
        </GlassCard>

        {/* Company overview ------------------------------------------------ */}
        <View style={styles.metrics}>
          <Metric
            label="ACCOUNTS"
            value={String(overview.users)}
            note={`${overview.activeUsers7d} active this week`}
            icon={<UsersIcon size={17} color={AccentColors.primaryLight} />}
            tint="rgba(232, 197, 71, 0.12)"
          />
          <Metric
            label="ACTIONS"
            value={String(overview.totalActions)}
            note={`${overview.actions7d} in the last 7 days`}
            icon={<BoltIcon size={17} color={AccentColors.primaryLight} />}
            tint="rgba(232, 197, 71, 0.12)"
          />
          <Metric
            label="TASK SUCCESS"
            value={overview.taskSuccessRate === null ? '—' : `${overview.taskSuccessRate}%`}
            note={`${overview.completedTasks} of ${overview.tasks} completed`}
            icon={<CheckCircleIcon size={17} color={AccentColors.success} />}
            tint="rgba(22, 163, 74, 0.12)"
          />
          <Metric
            label="OPEN ALERTS"
            value={String(openAlerts)}
            note={brokenIntegrations > 0 ? `${brokenIntegrations} integration failing` : 'across all accounts'}
            icon={<InboxIcon size={17} color={openAlerts > 0 ? AccentColors.error : theme.textSecondary} />}
            tint={openAlerts > 0 ? 'rgba(229, 72, 77, 0.12)' : 'rgba(255, 255, 255, 0.05)'}
          />
        </View>

        <View style={[styles.columns, !roomy && styles.columnsStacked]}>
          {/* Left column -------------------------------------------------- */}
          <View style={[styles.column, styles.columnWide, !roomy && styles.unflex]}>
            <GlassCard style={styles.panel}>
              <SectionHead
                title="Platform activity"
                subtitle="Tasks, chats, calls and videos per day, all accounts, 30 days"
                trailing={
                  <ThemedText type="caption" themeColor="textSecondary">
                    {overview.totalActions} total
                  </ThemedText>
                }
              />
              <ActivityLineChart days={toChartDays(usage.days)} height={230} unit="actions" />
            </GlassCard>

            <GlassCard style={styles.panel}>
              <SectionHead title="AI workforce" subtitle="Every department, counted across every account" />
              <Row
                widths={[3, 1, 1, 1, 2]}
                muted
                cells={[
                  <ThemedText key="d" type="caption" themeColor="textSecondary">DEPARTMENT</ThemedText>,
                  <ThemedText key="c" type="caption" themeColor="textSecondary">CHATS</ThemedText>,
                  <ThemedText key="m" type="caption" themeColor="textSecondary">MSGS</ThemedText>,
                  <ThemedText key="t" type="caption" themeColor="textSecondary">TASKS</ThemedText>,
                  <ThemedText key="l" type="caption" themeColor="textSecondary">LAST ACTIVE</ThemedText>,
                ]}
              />
              {workforce.map((department) => (
                <Row
                  key={department.type}
                  widths={[3, 1, 1, 1, 2]}
                  cells={[
                    <View key="n" style={styles.cellRow}>
                      <Dot color={department.failedTasks > 0 ? AccentColors.warning : AccentColors.success} />
                      <View>
                        <ThemedText type="small">{department.name}</ThemedText>
                        <ThemedText type="caption" themeColor="textSecondary">
                          {department.seats} seats
                          {department.failedTasks > 0 ? ` · ${department.failedTasks} failed` : ''}
                        </ThemedText>
                      </View>
                    </View>,
                    <ThemedText key="c" type="small">{department.conversations}</ThemedText>,
                    <ThemedText key="m" type="small">{department.messages}</ThemedText>,
                    <ThemedText key="t" type="small">{department.tasks}</ThemedText>,
                    <ThemedText key="l" type="small" themeColor="textSecondary">
                      {ago(department.lastActiveAt)}
                    </ThemedText>,
                  ]}
                />
              ))}
            </GlassCard>

            <GlassCard style={styles.panel}>
              <SectionHead
                title="Accounts"
                subtitle="One account is one workspace — Synq has no organisation table"
                trailing={
                  <ThemedText type="caption" themeColor="textSecondary">
                    {overview.activeUsers30d} active in 30 days
                  </ThemedText>
                }
              />
              <Row
                widths={[3, 1, 1, 1, 2]}
                muted
                cells={[
                  <ThemedText key="a" type="caption" themeColor="textSecondary">ACCOUNT</ThemedText>,
                  <ThemedText key="t" type="caption" themeColor="textSecondary">TASKS</ThemedText>,
                  <ThemedText key="m" type="caption" themeColor="textSecondary">MSGS</ThemedText>,
                  <ThemedText key="l" type="caption" themeColor="textSecondary">LEADS</ThemedText>,
                  <ThemedText key="s" type="caption" themeColor="textSecondary">LAST SEEN</ThemedText>,
                ]}
              />
              {users.map((user: AdminUser) => (
                <Pressable
                  key={user.id}
                  accessibilityRole="button"
                  accessibilityLabel={`Open ${user.email ?? 'account'}`}
                  onPress={() => openUser(user.id)}
                  style={({ hovered }) => [hovered && { backgroundColor: theme.surfaceRaised }]}
                >
                  <Row
                    widths={[3, 1, 1, 1, 2]}
                    cells={[
                      <View key="e" style={styles.cellRow}>
                        <View style={[styles.avatar, { backgroundColor: user.isAdmin ? AccentColors.primaryLight : theme.backgroundSelected }]}>
                          <ThemedText type="caption" style={user.isAdmin ? styles.avatarAdmin : undefined}>
                            {(user.email ?? '?').slice(0, 1).toUpperCase()}
                          </ThemedText>
                        </View>
                        <View style={styles.cellText}>
                          <ThemedText type="small" numberOfLines={1}>
                            {user.email ?? 'no email'}
                          </ThemedText>
                          <ThemedText type="caption" themeColor="textSecondary" numberOfLines={1}>
                            {user.businessName ? `${user.businessName} · ` : ''}
                            joined {String(user.createdAt).slice(0, 10)}
                            {user.confirmed ? '' : ' · unconfirmed'}
                          </ThemedText>
                        </View>
                      </View>,
                      <ThemedText key="t" type="small">{user.tasks}</ThemedText>,
                      <ThemedText key="m" type="small">{user.messages}</ThemedText>,
                      <ThemedText key="l" type="small">{user.leads}</ThemedText>,
                      <ThemedText key="s" type="small" themeColor="textSecondary">
                        {ago(user.lastSignInAt)}
                      </ThemedText>,
                    ]}
                  />
                </Pressable>
              ))}
            </GlassCard>

            <View style={[styles.split, !roomy && styles.columnsStacked]}>
              <GlassCard style={[styles.panel, styles.splitHalf, !roomy && styles.unflex]}>
                <SectionHead title="Where the work happens" subtitle="Chats by department" />
                {usage.byDepartment.length === 0 ? (
                  <ThemedText type="small" themeColor="textSecondary">
                    No chats yet.
                  </ThemedText>
                ) : (
                  <View style={styles.donutRow}>
                    <DonutChart
                      segments={usage.byDepartment}
                      size={140}
                      centerLabel="chats"
                    />
                    <View style={styles.legend}>
                      {usage.byDepartment.map((entry, index) => (
                        <View key={entry.label} style={styles.legendRow}>
                          <Dot color={SERIES_COLORS[index % SERIES_COLORS.length]} />
                          <ThemedText type="small" style={styles.legendLabel} numberOfLines={1}>
                            {entry.label}
                          </ThemedText>
                          <ThemedText type="small" themeColor="textSecondary">
                            {entry.count}
                          </ThemedText>
                        </View>
                      ))}
                    </View>
                  </View>
                )}
              </GlassCard>

              <GlassCard style={[styles.panel, styles.splitHalf, !roomy && styles.unflex]}>
                <SectionHead title="Sign-ups" subtitle="New accounts per day, 30 days" />
                {usage.signups.some((day) => day.count > 0) ? (
                  <ActivityLineChart days={toChartDays(usage.signups)} height={150} unit="sign-ups" />
                ) : (
                  <View style={styles.emptyBlock}>
                    <ThemedText type="small" themeColor="textSecondary">
                      No new accounts in the last 30 days. All {overview.users} accounts were created
                      earlier.
                    </ThemedText>
                  </View>
                )}
              </GlassCard>
            </View>
          </View>

          {/* Right column ------------------------------------------------- */}
          <View style={[styles.column, styles.columnNarrow, !roomy && styles.unflex]}>
            {feedPanel}

            <GlassCard style={styles.panel}>
              <SectionHead
                title="Errors and alerts"
                subtitle="Every failure Synq has recorded"
                trailing={
                  <ThemedText type="caption" style={{ color: openAlerts > 0 ? AccentColors.error : theme.textSecondary }}>
                    {openAlerts}
                  </ThemedText>
                }
              />
              {alerts.length === 0 ? (
                <ThemedText type="small" themeColor="textSecondary">
                  Nothing has failed.
                </ThemedText>
              ) : (
                alerts.slice(0, 8).map((alert) => (
                  <Pressable
                    key={alert.id}
                    accessibilityRole={alert.userId ? 'button' : 'text'}
                    disabled={!alert.userId}
                    onPress={() => alert.userId && openUser(alert.userId)}
                    style={({ hovered }) => [
                      styles.alert,
                      { borderColor: theme.border, backgroundColor: hovered ? theme.surfaceRaised : 'transparent' },
                    ]}
                  >
                    <View style={styles.alertHead}>
                      <Dot color={severityColor(alert.severity)} />
                      <ThemedText type="caption" themeColor="textSecondary">
                        {alert.source} · {ago(alert.at)}
                      </ThemedText>
                    </View>
                    <ThemedText type="small" numberOfLines={3}>
                      {alert.summary}
                    </ThemedText>
                  </Pressable>
                ))
              )}
            </GlassCard>

            <GlassCard style={styles.panel}>
              <SectionHead title="Integration health" subtitle="Key present, and what happened last time" />
              {integrations.map((integration) => (
                <View key={integration.id} style={[styles.integration, { borderColor: theme.border }]}>
                  <View style={styles.integrationHead}>
                    <View style={styles.cellRow}>
                      <PlugIcon size={15} color={STATUS_COLOR[integration.status]} />
                      <ThemedText type="small">{integration.name}</ThemedText>
                    </View>
                    <View style={[styles.statusPill, { borderColor: STATUS_COLOR[integration.status] }]}>
                      <ThemedText type="caption" style={{ color: STATUS_COLOR[integration.status] }}>
                        {STATUS_LABEL[integration.status]}
                      </ThemedText>
                    </View>
                  </View>
                  <ThemedText type="caption" themeColor="textSecondary" numberOfLines={2}>
                    {integration.detail}
                  </ThemedText>
                  <ThemedText type="caption" themeColor="textSecondary">
                    {integration.purpose} · last used {ago(integration.lastUsedAt)}
                  </ThemedText>
                </View>
              ))}
              <ThemedText type="caption" themeColor="textSecondary" style={styles.footnote}>
                Only whether a key is set is ever read — never its value.
              </ThemedText>
            </GlassCard>

            <GlassCard style={styles.panel}>
              <SectionHead title="Security and access" subtitle="Who can see this page, and who signed in" />
              {security.admins.map((admin) => (
                <View key={admin.userId ?? admin.email} style={[styles.integration, { borderColor: theme.border }]}>
                  <View style={styles.integrationHead}>
                    <View style={styles.cellRow}>
                      <CrownIcon size={14} color={AccentColors.primaryLight} />
                      <ThemedText type="small" numberOfLines={1}>
                        {admin.email ?? admin.userId}
                      </ThemedText>
                    </View>
                    <View style={[styles.statusPill, { borderColor: AccentColors.primary }]}>
                      <ThemedText type="caption" themeColor="accentText">
                        {(admin.role ?? '').toUpperCase()}
                      </ThemedText>
                    </View>
                  </View>
                  {admin.note ? (
                    <ThemedText type="caption" themeColor="textSecondary">
                      {admin.note}
                    </ThemedText>
                  ) : null}
                </View>
              ))}
              <View style={styles.subHead}>
                <ThemedText type="caption" themeColor="textSecondary">
                  RECENT SIGN-INS
                </ThemedText>
              </View>
              {security.recentSignIns.map((entry) => (
                <View key={`${entry.email}-${entry.at}`} style={styles.signIn}>
                  <ThemedText type="small" numberOfLines={1} style={styles.signInEmail}>
                    {entry.email}
                  </ThemedText>
                  <ThemedText type="caption" themeColor="textSecondary">
                    {ago(entry.at)}
                  </ThemedText>
                </View>
              ))}
              <ThemedText type="caption" themeColor="textSecondary" style={styles.footnote}>
                {security.unconfirmedAccounts} unconfirmed account
                {security.unconfirmedAccounts === 1 ? '' : 's'} · sign-in providers in use:{' '}
                {security.authProviders.join(', ')}
              </ThemedText>
            </GlassCard>

            <GlassCard style={styles.panel}>
              <SectionHead
                title="Not measured yet"
                subtitle="Asked for, but with no data source in Synq today"
              />
              {unavailable.map((entry) => (
                <Gap key={entry.id} title={entry.title} reason={entry.reason} needed={entry.needed} />
              ))}
            </GlassCard>
          </View>
        </View>

        <ThemedText type="caption" themeColor="textSecondary" style={styles.pageFoot}>
          Signed in as {snapshot.viewer.email}. This console reports activity, never content: no
          message text, prompts, call transcripts or secret values are read. Lead phone numbers are
          masked.
        </ThemedText>
      </View>

      {/* Drill-down -------------------------------------------------------- */}
      <ModalSheet
        visible={detailOpen}
        onClose={() => setDetailOpen(false)}
        title={detail?.user.email ?? 'Account'}
        description={
          detail
            ? `Joined ${String(detail.user.createdAt).slice(0, 10)} · last seen ${ago(detail.user.lastSignInAt)} · ${detail.user.provider}`
            : 'Loading…'
        }
        align="top"
      >
        {detail ? (
          <ScrollView style={styles.detailScroll}>
            <View style={styles.detailCounts}>
              {[
                { label: 'Tasks', value: detail.tasks.length },
                { label: 'Chats', value: detail.conversations.length },
                { label: 'Leads', value: detail.leads.length },
                { label: 'Videos', value: detail.videos.length },
              ].map((entry) => (
                <View key={entry.label} style={[styles.detailCount, { borderColor: theme.border }]}>
                  <ThemedText type="sectionTitle">{entry.value}</ThemedText>
                  <ThemedText type="caption" themeColor="textSecondary">
                    {entry.label}
                  </ThemedText>
                </View>
              ))}
            </View>

            <ThemedText type="caption" themeColor="textSecondary" style={styles.subHead}>
              RECENT ACTIVITY
            </ThemedText>
            {detail.events.length === 0 ? (
              <ThemedText type="small" themeColor="textSecondary">
                Nothing recorded for this account.
              </ThemedText>
            ) : (
              detail.events.slice(0, 12).map((event) => (
                <View key={event.id} style={[styles.detailRow, { borderColor: theme.border }]}>
                  <Dot color={severityColor(event.severity)} />
                  <ThemedText type="small" style={styles.detailText} numberOfLines={2}>
                    {event.summary}
                  </ThemedText>
                  <ThemedText type="caption" themeColor="textSecondary">
                    {ago(event.created_at)}
                  </ThemedText>
                </View>
              ))
            )}

            {detail.leads.length > 0 ? (
              <>
                <ThemedText type="caption" themeColor="textSecondary" style={styles.subHead}>
                  LEADS ({detail.leads.length})
                </ThemedText>
                {detail.leads.slice(0, 8).map((lead) => (
                  <View key={lead.id} style={[styles.detailRow, { borderColor: theme.border }]}>
                    <ThemedText type="small" style={styles.detailText} numberOfLines={1}>
                      {lead.name ?? lead.company ?? 'Unnamed'}
                    </ThemedText>
                    <ThemedText type="caption" themeColor="textSecondary">
                      {lead.status} · {lead.phone ?? 'no number'}
                    </ThemedText>
                  </View>
                ))}
              </>
            ) : null}
          </ScrollView>
        ) : (
          <ActivityIndicator color={AccentColors.primary} />
        )}
      </ModalSheet>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { padding: Spacing.four, paddingBottom: Spacing.six },
  page: { width: '100%', maxWidth: CONTENT_MAX_WIDTH, alignSelf: 'center', gap: Spacing.four },
  centre: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.three, padding: Spacing.four },
  centreText: { textAlign: 'center' },

  card: { borderRadius: CARD_RADIUS, borderWidth: 1, overflow: 'hidden' },
  panel: { padding: Spacing.four, gap: Spacing.three },
  errorCard: { padding: Spacing.five, gap: Spacing.three, alignItems: 'center', maxWidth: 460 },
  retry: {
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.two,
    borderRadius: Radius.pill,
    borderWidth: 1,
  },

  hero: { padding: Spacing.four, gap: Spacing.three },
  heroRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.three },
  heroText: { flexGrow: 1, flexShrink: 1, flexBasis: 0, gap: Spacing.one },
  heroBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: Spacing.one,
    paddingHorizontal: Spacing.two,
    paddingVertical: 2,
    marginBottom: Spacing.one,
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: 'rgba(232, 197, 71, 0.35)',
    backgroundColor: 'rgba(232, 197, 71, 0.1)',
  },
  refresh: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one + 2,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Radius.pill,
    borderWidth: 1,
  },

  searchWrap: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  searchIcon: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.control,
    borderWidth: 1,
  },
  searchField: { flexGrow: 1, flexShrink: 1, flexBasis: 0 },
  hits: { borderRadius: Radius.card, borderWidth: 1, overflow: 'hidden' },
  hit: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, padding: Spacing.two + 2 },
  hitKind: {
    width: 52,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  hitBody: { flexGrow: 1, flexShrink: 1, flexBasis: 0 },

  metrics: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.three },
  metricCard: { flexGrow: 1, flexShrink: 1, flexBasis: 200, padding: Spacing.four, gap: Spacing.one },
  metricTop: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, marginBottom: Spacing.two },
  metricLabel: { letterSpacing: 1 },
  tile: { width: 34, height: 34, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },

  columns: { flexDirection: 'row', gap: Spacing.three, alignItems: 'flex-start' },
  columnsStacked: { flexDirection: 'column' },
  column: { gap: Spacing.three },
  columnWide: { flexGrow: 3, flexShrink: 1, flexBasis: 0 },
  columnNarrow: { flexGrow: 2, flexShrink: 1, flexBasis: 0, minWidth: 320 },
  // `flex: 0` collapses a stacked box to nothing on react-native-web.
  unflex: { flexGrow: 0, flexShrink: 0, flexBasis: 'auto', width: '100%', minWidth: 0 },
  split: { flexDirection: 'row', gap: Spacing.three, alignItems: 'stretch' },
  splitHalf: { flexGrow: 1, flexShrink: 1, flexBasis: 0 },

  sectionHead: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.three },
  sectionHeadText: { flexGrow: 1, flexShrink: 1, flexBasis: 0, gap: 2 },
  subHead: { marginTop: Spacing.two, letterSpacing: 1 },

  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, paddingVertical: Spacing.two + 2, borderTopWidth: 1 },
  rowMuted: { borderTopWidth: 0, paddingBottom: Spacing.one },
  cellRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  cellText: { flexGrow: 1, flexShrink: 1, flexBasis: 0 },
  avatar: { width: 26, height: 26, borderRadius: Radius.pill, alignItems: 'center', justifyContent: 'center' },
  avatarAdmin: { color: '#0d0d0d', fontWeight: '700' },

  dot: { width: 8, height: 8, borderRadius: 4 },
  live: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one + 2 },

  feed: { gap: 2 },
  feedRow: { flexDirection: 'row', gap: Spacing.two, paddingVertical: Spacing.two, paddingHorizontal: Spacing.one, borderRadius: Radius.control, borderWidth: 0 },
  feedDot: { paddingTop: 5 },
  feedBody: { flexGrow: 1, flexShrink: 1, flexBasis: 0, gap: 1 },

  alert: { gap: Spacing.one, padding: Spacing.two + 2, borderRadius: Radius.control, borderWidth: 1 },
  alertHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },

  integration: { gap: 3, paddingVertical: Spacing.two + 2, borderTopWidth: 1 },
  integrationHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.two },
  statusPill: { paddingHorizontal: Spacing.two, paddingVertical: 1, borderRadius: Radius.pill, borderWidth: 1 },

  signIn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.two, paddingVertical: Spacing.one },
  signInEmail: { flexGrow: 1, flexShrink: 1, flexBasis: 0 },

  donutRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.four, flexWrap: 'wrap' },
  legend: { flexGrow: 1, flexShrink: 1, flexBasis: 140, gap: Spacing.two },
  legendRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  legendLabel: { flexGrow: 1, flexShrink: 1, flexBasis: 0 },
  emptyBlock: { paddingVertical: Spacing.four },

  gap: { gap: 3, paddingVertical: Spacing.two + 2, borderTopWidth: 1 },
  footnote: { marginTop: Spacing.one },
  pageFoot: { textAlign: 'center', paddingTop: Spacing.two },

  detailScroll: { maxHeight: 420 },
  detailCounts: { flexDirection: 'row', gap: Spacing.two, marginBottom: Spacing.three },
  detailCount: { flexGrow: 1, flexShrink: 1, flexBasis: 0, alignItems: 'center', gap: 2, paddingVertical: Spacing.two, borderRadius: Radius.control, borderWidth: 1 },
  detailRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, paddingVertical: Spacing.two, borderTopWidth: 1 },
  detailText: { flexGrow: 1, flexShrink: 1, flexBasis: 0 },
});
