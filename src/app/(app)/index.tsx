import { LinearGradient } from 'expo-linear-gradient';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import Svg, { Defs, RadialGradient, Rect, Stop } from 'react-native-svg';

import { ActivityLineChart, DonutChart, SERIES_COLORS } from '@/components/charts';
import {
  ArrowIcon,
  BoltIcon,
  ChartIcon,
  CheckCircleIcon,
  ClockIcon,
  LayersIcon,
  MegaphoneIcon,
  UsersIcon,
} from '@/components/icons';
import { ThemedText } from '@/components/themed-text';
import { AccentColors, Radius, Spacing, WideBreakpoint } from '@/constants/theme';
import { useSession } from '@/hooks/use-session';
import { useWorkspace } from '@/hooks/use-workspace';
import { useTheme } from '@/hooks/use-theme';
import { subscribeAnalytics } from '@/lib/analytics-events';
import { supabase } from '@/lib/supabase';
import {
  loadUsage,
  loadWorkspaceSummary,
  relativeTime,
  type UsageStats,
  type WorkspaceSummary,
} from '@/lib/workspace';

// The dashboard. Every number on this screen is counted from the signed-in
// user's own rows (see lib/workspace.ts) — there is no sample series, no seeded
// activity and no analytics service behind any of it. Where a feature does not
// exist yet, the card says so instead of showing a plausible-looking fake.

const CARD_RADIUS = 18;
const ANALYTICS_TABLES = ['tasks', 'sales_runs', 'prospects', 'calls', 'videos', 'messages', 'leads', 'social_posts'] as const;
const CONTENT_MAX_WIDTH = 1220;

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

/** The surface everything on this page sits on: dark, hairline-bordered, with a faint top sheen. */
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

const SHEEN = ['rgba(255, 255, 255, 0.05)', 'rgba(255, 255, 255, 0.01)', 'transparent'] as const;
const HERO_WASH = ['rgba(9, 9, 12, 0.92)', 'rgba(9, 9, 12, 0.55)', 'rgba(9, 9, 12, 0.85)'] as const;

function SectionHead({
  title,
  subtitle,
  trailing,
}: {
  title: string;
  subtitle?: string;
  trailing?: ReactNode;
}) {
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

function Chip({ label }: { label: string }) {
  const theme = useTheme();
  return (
    <View style={[styles.chip, { borderColor: theme.border, backgroundColor: theme.surfaceRaised }]}>
      <ThemedText type="caption" themeColor="textSecondary">
        {label}
      </ThemedText>
    </View>
  );
}

function Tile({ children, tint }: { children: ReactNode; tint: string }) {
  return <View style={[styles.tile, { backgroundColor: tint }]}>{children}</View>;
}

function Metric({
  label,
  value,
  note,
  icon,
  tint,
  noteColor,
  stacked,
}: {
  label: string;
  value: string;
  note: string;
  icon: ReactNode;
  tint: string;
  noteColor?: string;
  /** Stacked cards size to their content; side-by-side ones share the row. */
  stacked?: boolean;
}) {
  return (
    <GlassCard style={[styles.metricCard, stacked ? styles.unflex : null] as object}>
      <View style={styles.metricRow}>
        <Tile tint={tint}>{icon}</Tile>
        <View style={styles.metricText}>
          <ThemedText type="caption" themeColor="textSecondary" style={styles.metricLabel}>
            {label}
          </ThemedText>
          <ThemedText type="metric">{value}</ThemedText>
          <ThemedText type="caption" style={noteColor ? { color: noteColor } : undefined} themeColor={noteColor ? undefined : 'textSecondary'}>
            {note}
          </ThemedText>
        </View>
      </View>
    </GlassCard>
  );
}

function StatusIcon({ status }: { status: string }) {
  const color =
    status === 'completed'
      ? AccentColors.success
      : status === 'failed'
        ? AccentColors.error
        : AccentColors.warning;
  const tint =
    status === 'completed'
      ? 'rgba(22, 163, 74, 0.14)'
      : status === 'failed'
        ? 'rgba(229, 72, 77, 0.14)'
        : 'rgba(245, 158, 11, 0.14)';
  return (
    <View style={[styles.activityTile, { backgroundColor: tint }]}>
      {status === 'completed' ? (
        <CheckCircleIcon size={16} color={color} />
      ) : (
        <ClockIcon size={16} color={color} />
      )}
    </View>
  );
}

function Hero({ name, wide }: { name: string; wide: boolean }) {
  return (
    <View style={styles.hero}>
      {/* Drawn rather than photographed: there is no hero image in the project,
          and a gradient never crops badly on a phone. */}
      <Svg style={StyleSheet.absoluteFill} viewBox="0 0 100 100" preserveAspectRatio="none">
        <Defs>
          <RadialGradient id="heroGlow" cx="78%" cy="35%" rx="62%" ry="120%">
            <Stop offset="0" stopColor="#FFB663" stopOpacity={0.5} />
            <Stop offset="0.45" stopColor="#C2410C" stopOpacity={0.24} />
            <Stop offset="1" stopColor="#09090C" stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Rect x={0} y={0} width={100} height={100} fill="url(#heroGlow)" />
      </Svg>
      <LinearGradient
        pointerEvents="none"
        colors={HERO_WASH}
        start={{ x: 0, y: 0.5 }}
        end={{ x: 1, y: 0.5 }}
        style={StyleSheet.absoluteFill}
      />

      <View style={styles.heroBody}>
        <ThemedText type="pageTitle" style={styles.heroGreeting}>
          {greeting()},
        </ThemedText>
        <ThemedText type="pageTitle" style={styles.heroName} numberOfLines={1}>
          {name} 👋
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          Here&apos;s what&apos;s happening across your workspace.
        </ThemedText>
      </View>

      {wide ? (
        <View style={styles.heroAside} pointerEvents="none">
          <ThemedText type="caption" style={styles.heroAsideLine}>
            AUTOMATE TODAY
          </ThemedText>
          <ThemedText type="caption" style={styles.heroAsideLine}>
            A MORE EFFICIENT
          </ThemedText>
          <ThemedText type="caption" style={styles.heroAsideLine}>
            TOMORROW
          </ThemedText>
          <View style={styles.heroRule} />
        </View>
      ) : null}
    </View>
  );
}

export default function DashboardScreen() {
  const theme = useTheme();
  const { session } = useSession();
  const {identity}=useWorkspace();
  const { width } = useWindowDimensions();
  const [summary, setSummary] = useState<WorkspaceSummary | null>(null);
  const [usage, setUsage] = useState<UsageStats | null>(null);
  const [failed, setFailed] = useState(false);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // "Try again" bumps the attempt, and the effect below owns every setState —
  // so nothing is written while React is still rendering, and a reply that
  // arrives after the screen is gone is dropped instead of setting state.
  const [attempt, setAttempt] = useState(0);

  useFocusEffect(
    useCallback(() => {
      setAttempt((value) => value + 1);
    }, [])
  );

  const scheduleAnalyticsRefresh = useCallback(() => {
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
    refreshTimer.current = setTimeout(() => {
      refreshTimer.current = null;
      setAttempt((value) => value + 1);
    }, 200);
  }, []);

  useEffect(() => {
    const unsubscribe = subscribeAnalytics(scheduleAnalyticsRefresh);
    let channel = supabase.channel('dashboard-analytics');
    ANALYTICS_TABLES.forEach((table) => {
      channel = channel.on(
        'postgres_changes',
        { event: '*', schema: 'public', table },
        scheduleAnalyticsRefresh
      );
    });
    channel.subscribe();

    return () => {
      unsubscribe();
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
      void supabase.removeChannel(channel);
    };
  }, [scheduleAnalyticsRefresh]);

  useEffect(() => {
    let live = true;

    loadWorkspaceSummary()
      .then((result) => {
        if (!live) return;
        setSummary(result);
        setFailed(false);
      })
      .catch(() => {
        if (live) setFailed(true);
      });

    // A usage chart that won't load shouldn't take the whole dashboard with it.
    loadUsage()
      .then((result) => {
        if (live) setUsage(result);
      })
      .catch(() => {});

    return () => {
      live = false;
    };
  }, [attempt]);

  const name = identity?.full_name || String(session?.user?.user_metadata?.full_name||session?.user?.user_metadata?.name||'there');
  const wide = width >= WideBreakpoint;
  const roomy = width >= 1180;

  const breakdownTotal = usage?.breakdown.reduce((sum, row) => sum + row.count, 0) ?? 0;

  // A card in a stacked column must size to its content; only a card sharing a
  // row should stretch to match its neighbour.
  const panel = (base: object) => [base, !roomy ? styles.unflex : null] as object;

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <Hero name={name} wide={roomy} />

      {failed ? (
        <GlassCard>
          <ThemedText type="small">Something went wrong loading your workspace.</ThemedText>
          <Pressable
            accessibilityRole="button"
            onPress={() => setAttempt((value) => value + 1)}
            style={styles.retry}
          >
            <ThemedText type="small" style={{ color: AccentColors.primary }}>
              Try again
            </ThemedText>
          </Pressable>
        </GlassCard>
      ) : (
        <>
          <View style={[styles.row, !wide && styles.rowStacked]}>
            <Metric
              label="RUNS"
              value={summary ? String(summary.totalRuns) : '—'}
              note={summary ? `${summary.failedRuns} failed` : 'Loading'}
              noteColor={summary && summary.failedRuns > 0 ? AccentColors.error : undefined}
              icon={<LayersIcon size={20} color={AccentColors.primaryLight} />}
              tint="rgba(232, 197, 71, 0.12)"
              stacked={!wide}
            />
            <Metric
              label="COMPLETED"
              value={summary ? String(summary.completedRuns) : '—'}
              note="Handled by your agents"
              icon={<CheckCircleIcon size={20} color={AccentColors.success} />}
              tint="rgba(22, 163, 74, 0.13)"
              stacked={!wide}
            />
            <Metric
              label="LEADS"
              value={summary ? String(summary.leadCount) : '—'}
              note="In your workspace"
              icon={<UsersIcon size={20} color="#8AA4FF" />}
              tint="rgba(138, 164, 255, 0.13)"
              stacked={!wide}
            />
          </View>

          <View style={[styles.row, !roomy && styles.rowStacked]}>
            <GlassCard style={panel(styles.chartCard)}>
              <SectionHead
                title="Activity Overview"
                subtitle="Task and sales runs, videos, chats, and logged calls"
                trailing={<Chip label="Last 14 days" />}
              />

              {usage === null ? (
                <ThemedText type="caption" themeColor="textSecondary">
                  Loading…
                </ThemedText>
              ) : usage.total === 0 ? (
                <View style={styles.empty}>
                  <ThemedText type="small">Nothing recorded yet</ThemedText>
                  <ThemedText type="caption" themeColor="textSecondary">
                    Runs, chats and logged calls show up here as you work.
                  </ThemedText>
                </View>
              ) : (
                <ActivityLineChart days={usage.days} height={wide ? 220 : 190} />
              )}
            </GlassCard>

            <GlassCard style={panel(styles.donutCard)}>
              <SectionHead
                title="Department Usage"
                subtitle="Where the activity came from"
                trailing={roomy ? <Chip label="Last 14 days" /> : undefined}
              />

              {usage === null ? (
                <ThemedText type="caption" themeColor="textSecondary">
                  Loading…
                </ThemedText>
              ) : usage.breakdown.length === 0 ? (
                <View style={styles.empty}>
                  <ThemedText type="small">No department activity yet</ThemedText>
                  <ThemedText type="caption" themeColor="textSecondary">
                    This splits your activity by the agent that did the work.
                  </ThemedText>
                </View>
              ) : (
                <View style={[styles.donutRow, !wide && styles.donutRowStacked]}>
                  <DonutChart
                    segments={usage.breakdown}
                    size={148}
                    centerLabel={breakdownTotal === 1 ? 'Total action' : 'Total actions'}
                  />
                  <View style={styles.legend}>
                    {usage.breakdown.map((row, index) => (
                      <View key={row.label} style={styles.legendRow}>
                        <View
                          style={[
                            styles.legendDot,
                            { backgroundColor: SERIES_COLORS[index % SERIES_COLORS.length] },
                          ]}
                        />
                        <ThemedText type="small" style={styles.legendLabel} numberOfLines={1}>
                          {row.label}
                        </ThemedText>
                        <ThemedText type="smallBold">{row.count}</ThemedText>
                      </View>
                    ))}
                  </View>
                </View>
              )}
            </GlassCard>
          </View>

          <View style={[styles.row, !roomy && styles.rowStacked]}>
            <GlassCard style={panel(styles.chartCard)}>
              <SectionHead
                title="Recent Activity"
                subtitle="Latest actions in your workspace"
                trailing={
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => router.push('/history')}
                    style={({ hovered }) => [
                      styles.ghostButton,
                      {
                        borderColor: theme.border,
                        backgroundColor: hovered ? theme.surfaceRaised : 'transparent',
                      },
                    ]}
                  >
                    <ThemedText type="caption" themeColor="textSecondary">
                      View all
                    </ThemedText>
                    <ArrowIcon size={14} color={theme.textSecondary} />
                  </Pressable>
                }
              />

              {summary === null ? (
                <ThemedText type="caption" themeColor="textSecondary">
                  Loading…
                </ThemedText>
              ) : summary.recent.length === 0 ? (
                <View style={styles.empty}>
                  <ThemedText type="small">No runs yet</ThemedText>
                  <ThemedText type="caption" themeColor="textSecondary">
                    Ask a department to do something and it shows up here.
                  </ThemedText>
                  <Pressable accessibilityRole="button" onPress={() => router.push('/sales')}>
                    <ThemedText type="caption" style={{ color: AccentColors.primary }}>
                      Open Sales →
                    </ThemedText>
                  </Pressable>
                </View>
              ) : (
                <View style={styles.activityList}>
                  {summary.recent.map((entry) => (
                    <View
                      key={entry.id}
                      style={[styles.activityRow, { borderColor: theme.border }]}
                    >
                      <StatusIcon status={entry.status} />
                      <View style={styles.activityText}>
                        <ThemedText type="small" numberOfLines={1}>
                          {entry.label}
                        </ThemedText>
                        <ThemedText type="caption" themeColor="textSecondary">
                          {entry.status === 'completed'
                            ? 'Completed'
                            : entry.status === 'failed'
                              ? 'Failed'
                              : entry.status === 'blocked'
                                ? 'Needs attention'
                                : entry.status === 'awaiting_approval'
                                  ? 'Waiting for your approval'
                                  : entry.status === 'calling'
                                    ? 'Calling'
                                  : entry.status === 'ready'
                                    ? 'Ready for review'
                                    : ['running', 'planning', 'discovering', 'screening'].includes(entry.status)
                                      ? 'Running'
                                      : 'Queued'}
                        </ThemedText>
                      </View>
                      <ThemedText type="caption" themeColor="textSecondary">
                        {relativeTime(entry.createdAt)}
                      </ThemedText>
                    </View>
                  ))}
                </View>
              )}
            </GlassCard>

            <GlassCard style={panel(styles.donutCard)}>
              <SectionHead
                title="Active Automations"
                subtitle="Work that runs on its own"
                trailing={<Chip label="Soon" />}
              />

              {/* Synq has no scheduler and no background workers, so there is
                  nothing running. Showing invented toggles here would be a lie
                  about what the product does. */}
              <View style={styles.empty}>
                <View style={[styles.activityTile, { backgroundColor: 'rgba(232, 197, 71, 0.12)' }]}>
                  <BoltIcon size={16} color={AccentColors.primaryLight} />
                </View>
                <ThemedText type="small">No automations yet</ThemedText>
                <ThemedText type="caption" themeColor="textSecondary">
                  Email duties continue checking for replies after you approve sending. Chats and videos run because
                  you asked for it.
                </ThemedText>
              </View>
            </GlassCard>
          </View>

          <View style={[styles.row, !roomy && styles.rowStacked]}>
            <GlassCard style={panel(styles.chartCard)}>
              <SectionHead title="Departments" subtitle="Your AI team" />

              {[
                {
                  label: 'Sales',
                  hint: 'Sends reviewed emails, simplifies replies, and reports what customers say',
                  path: '/sales',
                  icon: <ChartIcon size={18} color={AccentColors.primaryLight} />,
                },
                {
                  label: 'Marketing',
                  hint: 'Brainstorms campaigns and copy, and makes short videos',
                  path: '/marketing',
                  icon: <MegaphoneIcon size={18} color={AccentColors.primaryLight} />,
                },
              ].map((department) => (
                <Pressable
                  key={department.path}
                  accessibilityRole="button"
                  onPress={() => router.push(department.path as Parameters<typeof router.push>[0])}
                  style={({ hovered }) => [
                    styles.deptRow,
                    {
                      borderColor: theme.border,
                      backgroundColor: hovered ? theme.surfaceRaised : 'transparent',
                    },
                  ]}
                >
                  <View style={[styles.activityTile, { backgroundColor: 'rgba(232, 197, 71, 0.1)' }]}>
                    {department.icon}
                  </View>
                  <View style={styles.activityText}>
                    <ThemedText type="small">{department.label}</ThemedText>
                    <ThemedText type="caption" themeColor="textSecondary" numberOfLines={1}>
                      {department.hint}
                    </ThemedText>
                  </View>
                  <View style={[styles.badge, { borderColor: 'rgba(22, 163, 74, 0.5)' }]}>
                    <ThemedText type="caption" style={{ color: AccentColors.success }}>
                      Active
                    </ThemedText>
                  </View>
                </Pressable>
              ))}
            </GlassCard>

            <GlassCard style={panel(styles.donutCard)}>
              <SectionHead title="Quick actions" />
              {[
                { label: 'Start email outreach', path: '/sales?compose=1' },
                { label: 'Review follow-ups', path: '/follow-ups' },
                { label: 'Import CRM contacts', path: '/import-leads' },
                { label: 'View sales activity', path: '/sales' },
              ].map((action) => (
                <Pressable
                  key={action.path}
                  accessibilityRole="button"
                  onPress={() => router.push(action.path as Parameters<typeof router.push>[0])}
                  style={({ hovered }) => [
                    styles.actionRow,
                    { backgroundColor: hovered ? theme.surfaceRaised : 'transparent' },
                  ]}
                >
                  <ThemedText type="small">{action.label}</ThemedText>
                  <ArrowIcon size={14} color={theme.textSecondary} />
                </Pressable>
              ))}
            </GlassCard>
          </View>
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: Spacing.three,
    padding: Spacing.four,
    width: '100%',
    maxWidth: CONTENT_MAX_WIDTH,
    alignSelf: 'center',
  },

  hero: {
    minHeight: 150,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: Spacing.four,
    borderRadius: CARD_RADIUS,
    overflow: 'hidden',
  },
  heroBody: { gap: 2, flexShrink: 1 },
  heroGreeting: { fontSize: 26, lineHeight: 32 },
  heroName: { fontSize: 30, lineHeight: 38, marginBottom: Spacing.one },
  heroAside: { alignItems: 'flex-end', gap: 2 },
  heroAsideLine: {
    color: 'rgba(255, 255, 255, 0.72)',
    letterSpacing: 2.6,
    fontSize: 11,
    lineHeight: 18,
  },
  heroRule: { width: 44, height: 1, marginTop: Spacing.two, backgroundColor: AccentColors.primary },

  row: { flexDirection: 'row', gap: Spacing.three, alignItems: 'stretch' },
  rowStacked: { flexDirection: 'column' },

  card: {
    flex: 1,
    gap: Spacing.three,
    padding: Spacing.four,
    borderRadius: CARD_RADIUS,
    borderWidth: 1,
    overflow: 'hidden',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 14 },
    shadowOpacity: 0.28,
    shadowRadius: 28,
    elevation: 6,
  },
  chartCard: { flex: 1.65 },
  donutCard: { flex: 1 },
  // Not `flex: 0`: on web that resolves to a zero basis and collapses the card
  // to its padding. This says "size to content" without touching the basis.
  unflex: { flexGrow: 0, flexShrink: 0, flexBasis: 'auto' },

  metricCard: { gap: 0, paddingVertical: Spacing.four },
  metricRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  metricText: { gap: 2, flexShrink: 1 },
  metricLabel: { letterSpacing: 1.1, fontSize: 11 },
  tile: {
    width: 44,
    height: 44,
    borderRadius: Radius.card,
    alignItems: 'center',
    justifyContent: 'center',
  },

  sectionHead: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: Spacing.two },
  sectionHeadText: { gap: 2, flexShrink: 1 },
  chip: {
    paddingHorizontal: Spacing.two + 2,
    paddingVertical: 4,
    borderRadius: Radius.pill,
    borderWidth: 1,
  },
  ghostButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one + 2,
    paddingHorizontal: Spacing.two + 2,
    paddingVertical: 5,
    borderRadius: Radius.pill,
    borderWidth: 1,
  },

  donutRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  donutRowStacked: { flexDirection: 'column', alignItems: 'flex-start' },
  legend: { flex: 1, gap: Spacing.two, minWidth: 150 },
  legendRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  legendLabel: { flex: 1 },

  activityList: { gap: 2 },
  activityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingVertical: Spacing.two,
  },
  activityTile: {
    width: 32,
    height: 32,
    borderRadius: Radius.control + 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  activityText: { flex: 1, gap: 1 },

  deptRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    padding: Spacing.two,
    borderRadius: Radius.card,
  },
  badge: {
    paddingHorizontal: Spacing.two,
    paddingVertical: 2,
    borderRadius: Radius.pill,
    borderWidth: 1,
  },

  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.two,
    borderRadius: Radius.control,
  },

  empty: { gap: Spacing.one + 2, paddingVertical: Spacing.two },
  retry: { paddingTop: Spacing.two },
});
