import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';

import { MarketingTabs } from '@/components/marketing-tabs';
import { ThemedText } from '@/components/themed-text';
import { AccentColors, Radius, Spacing, WideBreakpoint } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { loadMarketingSummary, type MarketingSummary } from '@/lib/marketing';

function Metric({ label, value, note }: { label: string; value: string; note: string }) {
  const theme = useTheme();
  return (
    <View
      style={[
        styles.card,
        styles.metricCard,
        { backgroundColor: theme.surface, borderColor: theme.border },
      ]}
    >
      <ThemedText type="caption" themeColor="textSecondary" style={styles.metricLabel}>
        {label}
      </ThemedText>
      <ThemedText type="metric">{value}</ThemedText>
      <ThemedText type="caption" themeColor="textSecondary">
        {note}
      </ThemedText>
    </View>
  );
}

export default function MarketingOverviewScreen() {
  const theme = useTheme();
  const { width } = useWindowDimensions();
  const [summary, setSummary] = useState<MarketingSummary | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(() => {
    setFailed(false);
    loadMarketingSummary()
      .then(setSummary)
      .catch(() => setFailed(true));
  }, []);

  useEffect(load, [load]);

  const wide = width >= WideBreakpoint;

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <ThemedText type="pageTitle">Marketing</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          Your marketing command center.
        </ThemedText>
      </View>

      <MarketingTabs />

      {failed ? (
        <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          <ThemedText type="small">Something went wrong loading Marketing.</ThemedText>
          <Pressable accessibilityRole="button" onPress={load}>
            <ThemedText type="small" style={{ color: AccentColors.primary }}>
              Try again
            </ThemedText>
          </Pressable>
        </View>
      ) : (
        <>
          <View style={[styles.metrics, !wide && styles.metricsStacked]}>
            <Metric
              label="CAMPAIGNS"
              value={summary ? String(summary.campaignCount) : '—'}
              note={summary ? `${summary.activeCampaigns} active` : 'Loading'}
            />
            <Metric
              label="CONTENT"
              value={summary ? String(summary.contentCount) : '—'}
              note={summary ? `${summary.scheduledContent} scheduled` : 'Loading'}
            />
            <Metric
              label="LEADS GENERATED"
              value={summary ? String(summary.leadsFromCampaigns) : '—'}
              note="Passed to Sales"
            />
          </View>

          <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
            <ThemedText type="sectionTitle">Marketing brief</ThemedText>
            {summary === null ? (
              <ThemedText type="small" themeColor="textSecondary">
                Loading…
              </ThemedText>
            ) : (
              summary.brief.map((line) => (
                <ThemedText key={line} type="small" themeColor="textSecondary">
                  {line}
                </ThemedText>
              ))
            )}
            <ThemedText type="caption" themeColor="textSecondary" style={styles.footnote}>
              Counted from your own campaigns, content and leads. Reach, engagement and
              cost-per-lead need a channel integration before they can be reported.
            </ThemedText>
          </View>

          {summary && summary.recommendations.length > 0 ? (
            <View
              style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}
            >
              <ThemedText type="sectionTitle">Recommended actions</ThemedText>
              {summary.recommendations.map((rec) => (
                <View key={rec.title} style={[styles.recRow, { borderColor: theme.border }]}>
                  <View style={styles.recMain}>
                    <ThemedText type="small">{rec.title}</ThemedText>
                    <ThemedText type="caption" themeColor="textSecondary">
                      {rec.reason}
                    </ThemedText>
                  </View>
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => router.push(rec.path as Parameters<typeof router.push>[0])}
                    style={({ hovered }) => [
                      styles.recAction,
                      {
                        borderColor: theme.border,
                        backgroundColor: hovered ? theme.surfaceRaised : 'transparent',
                      },
                    ]}
                  >
                    <ThemedText type="caption" style={{ color: AccentColors.primary }}>
                      Open
                    </ThemedText>
                  </Pressable>
                </View>
              ))}
            </View>
          ) : null}

          <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
            <ThemedText type="sectionTitle">Marketing feeds Sales</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              Leads generated by a campaign are written straight into the same CRM that Cold Call
              works through, tagged with the campaign that produced them. There is no separate
              marketing lead list to reconcile.
            </ThemedText>
            <Pressable accessibilityRole="button" onPress={() => router.push('/cold-call')}>
              <ThemedText type="small" style={{ color: AccentColors.primary }}>
                Open Cold Call →
              </ThemedText>
            </Pressable>
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
  footnote: { paddingTop: Spacing.two },
  recRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingVertical: Spacing.three,
    borderTopWidth: 1,
  },
  recMain: { flex: 1, gap: 2 },
  recAction: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two - 2,
    borderRadius: Radius.control,
    borderWidth: 1,
  },
});
