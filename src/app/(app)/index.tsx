import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { AccentColors, MaxContentWidth, Radius, Spacing, WideBreakpoint } from '@/constants/theme';
import { useSession } from '@/hooks/use-session';
import { useTheme } from '@/hooks/use-theme';
import {
  loadUsage,
  loadWorkspaceSummary,
  relativeTime,
  type UsageStats,
  type WorkspaceSummary,
} from '@/lib/workspace';

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

function Card({ children, style }: { children: React.ReactNode; style?: object }) {
  const theme = useTheme();
  return (
    <View
      style={[
        styles.card,
        { backgroundColor: theme.surface, borderColor: theme.border },
        style,
      ]}
    >
      {children}
    </View>
  );
}

function Metric({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <Card style={styles.metricCard}>
      <ThemedText type="caption" themeColor="textSecondary" style={styles.metricLabel}>
        {label}
      </ThemedText>
      <ThemedText type="metric">{value}</ThemedText>
      <ThemedText type="caption" themeColor="textSecondary">
        {note}
      </ThemedText>
    </Card>
  );
}

function StatusDot({ status }: { status: string }) {
  const color =
    status === 'completed'
      ? AccentColors.success
      : status === 'failed'
        ? AccentColors.error
        : AccentColors.warning;
  return <View style={[styles.dot, { backgroundColor: color }]} />;
}

export default function DashboardScreen() {
  const theme = useTheme();
  const { session } = useSession();
  const { width } = useWindowDimensions();
  const [summary, setSummary] = useState<WorkspaceSummary | null>(null);
  const [usage, setUsage] = useState<UsageStats | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(() => {
    setFailed(false);
    loadWorkspaceSummary()
      .then(setSummary)
      .catch(() => setFailed(true));
    // A usage chart that won't load shouldn't take the whole dashboard with it.
    loadUsage()
      .then(setUsage)
      .catch(() => {});
  }, []);

  useEffect(load, [load]);

  const breakdownPeak = Math.max(1, ...(usage?.breakdown.map((row) => row.count) ?? [1]));
  const rangeStart = usage?.days[0]
    ? new Date(`${usage.days[0].key}T00:00:00`).toLocaleDateString(undefined, {
        day: 'numeric',
        month: 'short',
      })
    : '';
  // The chart is decorative to a screen reader unless the numbers are spoken.
  const chartLabel = usage
    ? `Activity per day since ${rangeStart}: ${usage.days.map((d) => d.count).join(', ')}`
    : 'Activity chart';

  const name = (session?.user?.email ?? '').split('@')[0] || 'there';
  const twoColumn = width >= WideBreakpoint;

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <ThemedText type="pageTitle">
          {greeting()}, {name}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          Here&apos;s what&apos;s happening across your workspace.
        </ThemedText>
      </View>

      {failed ? (
        <Card>
          <ThemedText type="small">Something went wrong loading your workspace.</ThemedText>
          <Pressable accessibilityRole="button" onPress={load} style={styles.retry}>
            <ThemedText type="small" style={{ color: AccentColors.primary }}>
              Try again
            </ThemedText>
          </Pressable>
        </Card>
      ) : (
        <>
          <View style={[styles.metrics, !twoColumn && styles.metricsStacked]}>
            <Metric
              label="TASK RUNS"
              value={summary ? String(summary.totalRuns) : '—'}
              note={summary ? `${summary.failedRuns} failed` : 'Loading'}
            />
            <Metric
              label="COMPLETED"
              value={summary ? String(summary.completedRuns) : '—'}
              note="Handled by Sales AI"
            />
            <Metric
              label="LEADS"
              value={summary ? String(summary.leadCount) : '—'}
              note="In your workspace"
            />
          </View>

          <Card>
            <View style={styles.sectionHeader}>
              <ThemedText type="sectionTitle">Usage</ThemedText>
              <ThemedText type="caption" themeColor="textSecondary">
                {usage ? `${usage.total} actions · last 14 days` : 'Last 14 days'}
              </ThemedText>
            </View>

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
              <>
                <View style={styles.chart} accessibilityRole="image" accessibilityLabel={chartLabel}>
                  {usage.days.map((day) => {
                    const tallest = day.count === usage.peak && day.count > 0;
                    return (
                      <View key={day.key} style={styles.barSlot}>
                        {tallest ? (
                          <ThemedText type="caption" themeColor="textSecondary" style={styles.barValue}>
                            {day.count}
                          </ThemedText>
                        ) : null}
                        <View
                          style={[
                            styles.bar,
                            {
                              // Floor of 2px so an empty day still reads as a day
                              // rather than a gap in the axis.
                              height: Math.max(2, (day.count / usage.peak) * 96),
                              backgroundColor:
                                day.count > 0 ? AccentColors.primary : theme.backgroundSelected,
                            },
                          ]}
                        />
                      </View>
                    );
                  })}
                </View>
                <View style={[styles.axis, { borderColor: theme.border }]}>
                  <ThemedText type="caption" themeColor="textSecondary">
                    {rangeStart}
                  </ThemedText>
                  <ThemedText type="caption" themeColor="textSecondary">
                    Today
                  </ThemedText>
                </View>

                {usage.breakdown.length > 0 ? (
                  <View style={styles.breakdown}>
                    {usage.breakdown.map((row) => (
                      <View key={row.label} style={styles.breakdownRow}>
                        <ThemedText type="caption" style={styles.breakdownLabel} numberOfLines={1}>
                          {row.label}
                        </ThemedText>
                        <View
                          style={[
                            styles.breakdownTrack,
                            { backgroundColor: theme.backgroundSelected },
                          ]}
                        >
                          <View
                            style={[
                              styles.breakdownFill,
                              {
                                width: `${Math.round((row.count / breakdownPeak) * 100)}%`,
                                backgroundColor: AccentColors.primary,
                              },
                            ]}
                          />
                        </View>
                        <ThemedText type="caption" themeColor="textSecondary" style={styles.breakdownCount}>
                          {row.count}
                        </ThemedText>
                      </View>
                    ))}
                  </View>
                ) : null}
              </>
            )}
          </Card>

          <Card>
            <View style={styles.sectionHeader}>
              <ThemedText type="sectionTitle">Departments</ThemedText>
            </View>

            <Pressable
              accessibilityRole="button"
              onPress={() => router.push('/sales')}
              style={({ hovered }) => [
                styles.deptRow,
                { backgroundColor: hovered ? theme.surfaceRaised : 'transparent' },
              ]}
            >
              <View style={styles.deptMain}>
                <ThemedText type="small">Sales</ThemedText>
                <ThemedText type="caption" themeColor="textSecondary">
                  Qualifies leads and drafts outreach
                </ThemedText>
              </View>
              <View style={[styles.badge, { borderColor: AccentColors.success }]}>
                <ThemedText type="caption" style={{ color: AccentColors.success }}>
                  Active
                </ThemedText>
              </View>
            </Pressable>

            <Pressable
              accessibilityRole="button"
              onPress={() => router.push('/marketing')}
              style={({ hovered }) => [
                styles.deptRow,
                { backgroundColor: hovered ? theme.surfaceRaised : 'transparent' },
              ]}
            >
              <View style={styles.deptMain}>
                <ThemedText type="small">Marketing</ThemedText>
                <ThemedText type="caption" themeColor="textSecondary">
                  Brainstorm campaigns and copy
                </ThemedText>
              </View>
              <View style={[styles.badge, { borderColor: AccentColors.success }]}>
                <ThemedText type="caption" style={{ color: AccentColors.success }}>
                  Active
                </ThemedText>
              </View>
            </Pressable>
          </Card>

          <View style={[styles.lower, !twoColumn && styles.lowerStacked]}>
            <Card style={styles.lowerCard}>
              <View style={styles.sectionHeader}>
                <ThemedText type="sectionTitle">Recent activity</ThemedText>
                <Pressable accessibilityRole="button" onPress={() => router.push('/history')}>
                  <ThemedText type="caption" style={{ color: AccentColors.primary }}>
                    View all →
                  </ThemedText>
                </Pressable>
              </View>

              {summary === null ? (
                <ThemedText type="caption" themeColor="textSecondary">
                  Loading…
                </ThemedText>
              ) : summary.recent.length === 0 ? (
                <View style={styles.empty}>
                  <ThemedText type="small">No runs yet</ThemedText>
                  <ThemedText type="caption" themeColor="textSecondary">
                    Give the Sales agent some lead notes to get started.
                  </ThemedText>
                  <Pressable accessibilityRole="button" onPress={() => router.push('/sales')}>
                    <ThemedText type="caption" style={{ color: AccentColors.primary }}>
                      Open Sales →
                    </ThemedText>
                  </Pressable>
                </View>
              ) : (
                summary.recent.map((entry) => (
                  <View key={entry.id} style={styles.activityRow}>
                    <StatusDot status={entry.status} />
                    <ThemedText type="small" numberOfLines={1} style={styles.activityLabel}>
                      {entry.label}
                    </ThemedText>
                    <ThemedText type="caption" themeColor="textSecondary">
                      {relativeTime(entry.createdAt)}
                    </ThemedText>
                  </View>
                ))
              )}
            </Card>

            <Card style={styles.lowerCard}>
              <View style={styles.sectionHeader}>
                <ThemedText type="sectionTitle">Quick actions</ThemedText>
              </View>
              {[
                { label: 'Start cold calling', path: '/cold-call' },
                { label: 'Review follow-ups', path: '/follow-ups' },
                { label: 'Import CRM contacts', path: '/import-leads' },
                { label: 'Ask Sales AI', path: '/sales' },
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
                  <ThemedText type="caption" themeColor="textSecondary">
                    →
                  </ThemedText>
                </Pressable>
              ))}
            </Card>
          </View>
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: Spacing.four,
    padding: Spacing.five,
    width: '100%',
    maxWidth: 1100,
    alignSelf: 'center',
  },
  header: { gap: Spacing.one },
  // One series, one hue, no legend — the section title names what the bars are.
  chart: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 2,
    height: 116,
    paddingTop: Spacing.two,
  },
  barSlot: { flex: 1, alignItems: 'center', justifyContent: 'flex-end', gap: 2 },
  barValue: { fontSize: 10 },
  bar: { width: '100%', borderTopLeftRadius: 4, borderTopRightRadius: 4 },
  axis: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingTop: Spacing.two,
    borderTopWidth: 1,
  },
  breakdown: { gap: Spacing.two, paddingTop: Spacing.three },
  breakdownRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  breakdownLabel: { width: 132 },
  breakdownTrack: { flex: 1, height: 6, borderRadius: 3, overflow: 'hidden' },
  breakdownFill: { height: '100%', borderRadius: 3 },
  breakdownCount: { width: 24, textAlign: 'right' },
  card: {
    gap: Spacing.two,
    padding: Spacing.four,
    borderRadius: Radius.card,
    borderWidth: 1,
  },
  metrics: { flexDirection: 'row', gap: Spacing.three },
  metricsStacked: { flexDirection: 'column' },
  metricCard: { flex: 1, gap: Spacing.one },
  metricLabel: { letterSpacing: 0.8, fontSize: 11 },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: Spacing.one,
  },
  deptRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.two,
    marginHorizontal: -Spacing.two,
    borderRadius: Radius.control,
  },
  deptMain: { flex: 1, gap: 2 },
  badge: {
    paddingHorizontal: Spacing.two,
    paddingVertical: 2,
    borderRadius: Radius.pill,
    borderWidth: 1,
  },
  lower: { flexDirection: 'row', gap: Spacing.three },
  lowerStacked: { flexDirection: 'column' },
  lowerCard: { flex: 1 },
  activityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingVertical: Spacing.two - 2,
  },
  activityLabel: { flex: 1 },
  dot: { width: 6, height: 6, borderRadius: 3 },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.two,
    marginHorizontal: -Spacing.two,
    borderRadius: Radius.control,
  },
  empty: { gap: Spacing.one, paddingVertical: Spacing.three },
  retry: { paddingTop: Spacing.two },
});
