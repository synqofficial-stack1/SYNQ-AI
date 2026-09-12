import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';

import { ChatPanel } from '@/components/chat-panel';
import { ThemedText } from '@/components/themed-text';
import { AccentColors, MaxContentWidth, Radius, Spacing, WideBreakpoint } from '@/constants/theme';
import { useSession } from '@/hooks/use-session';
import { useTheme } from '@/hooks/use-theme';
import { loadWorkspaceSummary, relativeTime, type WorkspaceSummary } from '@/lib/workspace';

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
  const [failed, setFailed] = useState(false);

  const load = useCallback(() => {
    setFailed(false);
    loadWorkspaceSummary()
      .then(setSummary)
      .catch(() => setFailed(true));
  }, []);

  useEffect(load, [load]);

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

          <View style={styles.assistant}>
            <ThemedText type="sectionTitle">Ask Synq</ThemedText>
            <ChatPanel
              kind="assistant"
              placeholder="Ask about your workspace, or tell it what to do…"
              emptyHint="Ask anything about your workspace — it reads your real contacts, calls, campaigns and content, and can take you to any page. It can create drafts, but never publishes or changes anything on its own."
              suggestions={[
                'What needs my attention?',
                'How many contacts have I not called yet?',
                'Take me to Cold Call',
              ]}
              height={320}
            />
          </View>

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
                  Plans campaigns and writes content
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
  assistant: { gap: Spacing.two },
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
