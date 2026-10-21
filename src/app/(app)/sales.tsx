import { useCallback, useEffect, useState } from 'react';
import { router, useFocusEffect } from 'expo-router';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';

import { DepartmentActivityChart } from '@/components/department-activity-chart';
import { ModalSheet } from '@/components/modal-sheet';
import { SalesCallReport } from '@/components/sales-call-report';
import { ThemedText } from '@/components/themed-text';
import { AccentColors, MaxContentWidth, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { subscribeAnalytics } from '@/lib/analytics-events';
import {
  checkCall,
  loadRecentCalls,
  loadSalesDashboard,
  toSheetRows,
  type SalesDashboard,
  type SheetRow,
} from '@/lib/sales/runs';
import type { Temperature } from '@/types/database';

// Department dashboard for the user's real sales runs and call outcomes.

/** How often a live call is checked on. */
const CALL_POLL_MS = 4000;

/** Hot carries the accent because it is the only number worth acting on today. */
const TEMPERATURE_COLORS: Record<Temperature, string> = {
  hot: AccentColors.primary,
  warm: '#8c8c8c',
  cold: '#4a4a4a',
};

function TemperatureBar({ data }: { data: SalesDashboard }) {
  const theme = useTheme();
  const { hot, warm, cold } = data.byTemperature;
  const total = hot + warm + cold + data.noAnswer;

  if (total === 0) {
    return (
      <ThemedText type="small" themeColor="textSecondary">
        No calls have finished yet.
      </ThemedText>
    );
  }

  const segments = [
    { key: 'hot', label: 'Hot', count: hot, color: TEMPERATURE_COLORS.hot },
    { key: 'warm', label: 'Warm', count: warm, color: TEMPERATURE_COLORS.warm },
    { key: 'cold', label: 'Cold', count: cold, color: TEMPERATURE_COLORS.cold },
    { key: 'noAnswer', label: 'No answer', count: data.noAnswer, color: theme.border },
  ].filter((segment) => segment.count > 0);

  return (
    <View style={styles.barBlock}>
      <View style={styles.bar}>
        {segments.map((segment) => (
          <View
            key={segment.key}
            style={{
              flex: segment.count,
              backgroundColor: segment.color,
              // A hairline of page colour between fills, so two dark segments
              // never read as one.
              borderRightWidth: 2,
              borderRightColor: theme.background,
            }}
          />
        ))}
      </View>
      <View style={styles.legend}>
        {segments.map((segment) => (
          <View key={segment.key} style={styles.legendItem}>
            <View style={[styles.swatch, { backgroundColor: segment.color }]} />
            <ThemedText type="caption" themeColor="textSecondary">
              {segment.label} {segment.count}
            </ThemedText>
          </View>
        ))}
      </View>
    </View>
  );
}

function TemperatureChip({ value }: { value: Temperature | null }) {
  const theme = useTheme();
  if (!value) {
    return (
      <ThemedText type="caption" themeColor="textSecondary">
        —
      </ThemedText>
    );
  }
  const isHot = value === 'hot';
  return (
    <View
      style={[
        styles.chip,
        {
          backgroundColor: isHot ? AccentColors.primary : 'transparent',
          borderColor: isHot ? AccentColors.primary : theme.borderStrong,
        },
      ]}
    >
      <ThemedText type="caption" style={{ color: isHot ? '#0d0d0d' : theme.text }}>
        {value === 'hot' ? 'Hot' : value === 'warm' ? 'Warm' : 'Cold'}
      </ThemedText>
    </View>
  );
}

function CallSheet({ rows, onReport }: { rows: SheetRow[]; onReport: (id: string) => void }) {
  const theme = useTheme();

  return (
    <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
      <View style={styles.cardHead}>
        <ThemedText type="smallBold">Recent calls</ThemedText>
        <ThemedText type="caption" themeColor="textSecondary">
          {rows.length} {rows.length === 1 ? 'call' : 'calls'}
        </ThemedText>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View>
          <View style={[styles.row, styles.headRow, { borderBottomColor: theme.border }]}>
            <ThemedText type="caption" themeColor="textSecondary" style={styles.colPhone}>
              NUMBER
            </ThemedText>
            <ThemedText type="caption" themeColor="textSecondary" style={styles.colTemp}>
              READ
            </ThemedText>
            <ThemedText type="caption" themeColor="textSecondary" style={styles.colNote}>
              NOTE
            </ThemedText>
          </View>

          {rows.map((row) => (
            <View key={row.id} style={[styles.row, { borderBottomColor: theme.border }]}>
              <View style={styles.colPhone}>
                <ThemedText type="small" numberOfLines={1}>
                  {row.phone ?? row.name}
                </ThemedText>
                {row.name !== row.phone ? (
                  <ThemedText type="caption" themeColor="textSecondary" numberOfLines={1}>
                    {row.name}
                  </ThemedText>
                ) : null}
              </View>

              <View style={styles.colTemp}>
                <TemperatureChip value={row.temperature} />
              </View>

              <View style={styles.colNote}>
                <ThemedText
                  type={row.note ? 'small' : 'caption'}
                  themeColor="textSecondary"
                >
                  {row.status === 'dialing'
                    ? 'Calling now…'
                    : (row.note ?? row.callError ?? 'No notes.')}
                </ThemedText>
                <Pressable accessibilityRole="button" onPress={() => onReport(row.id)}>
                  <ThemedText type="caption" style={{ color: AccentColors.primary }}>
                    {row.status === 'dialing' ? 'View call' : 'View report & recording'}
                  </ThemedText>
                </Pressable>
              </View>
            </View>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

export default function SalesScreen() {
  const theme = useTheme();
  const [reportId, setReportId] = useState<string | null>(null);

  const [dashboard, setDashboard] = useState<SalesDashboard | null>(null);
  const [rows, setRows] = useState<SheetRow[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const [summary, recent] = await Promise.all([
      loadSalesDashboard().catch(() => null),
      loadRecentCalls().catch(() => []),
    ]);
    setDashboard(summary);
    setRows(toSheetRows(recent));
    setLoading(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh])
  );

  useEffect(() => subscribeAnalytics(() => refresh()), [refresh]);

  useEffect(() => {
    let checking = false;
    const timer = setInterval(async () => {
      if (checking) return;
      checking = true;
      try {
        const recent = await loadRecentCalls();
        const live = recent.filter(p => p.outreach_status === 'dialing');
        if (live.length) {
          await Promise.all(live.map(p => checkCall(p.id)));
          await refresh();
        }
      } catch { /* The call card and report expose retryable errors. */ }
      finally { checking = false; }
    }, CALL_POLL_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  const dashboardColumn = (
    <View style={styles.stackWide}>
      <View style={styles.header}>
        <ThemedText type="pageTitle">Sales</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          Track your AI calls, results, and follow-up opportunities.
        </ThemedText>
      </View>

      <Pressable
        accessibilityRole="button"
        onPress={() => router.push('/sales?ai=1' as Parameters<typeof router.push>[0])}
        style={({ hovered, pressed }) => [styles.callAction, { opacity: hovered || pressed ? 0.82 : 1 }]}
      >
        <ThemedText type="smallBold" style={{ color: AccentColors.primary }}>✦ Sales chat</ThemedText>
      </Pressable>

      {loading ? (
        <ActivityIndicator color={AccentColors.primary} />
      ) : (
        <>
          <DepartmentActivityChart department="sales" />

          <View
            style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}
          >
            <ThemedText type="smallBold">How the calls went</ThemedText>
            {dashboard ? <TemperatureBar data={dashboard} /> : null}
          </View>

          {rows.length > 0 ? (
            <CallSheet rows={rows} onReport={setReportId} />
          ) : (
            <View
              style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}
            >
              <ThemedText type="smallBold">No calls yet</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                Completed calls and their reports will appear here.
              </ThemedText>
            </View>
          )}
        </>
      )}
    </View>
  );

  return (
    <>
      <ScrollView contentContainerStyle={styles.narrow}>{dashboardColumn}</ScrollView>
      <ModalSheet visible={reportId !== null} onClose={() => setReportId(null)} title="Call report & recording">
        <ScrollView style={{ maxHeight: 560 }}>
          {reportId ? <SalesCallReport key={reportId} prospectId={reportId} /> : null}
        </ScrollView>
      </ModalSheet>
    </>
  );
}

const styles = StyleSheet.create({
  narrow: {
    padding: Spacing.five,
    gap: Spacing.four,
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
  },

  header: { gap: Spacing.one },
  stackWide: { gap: Spacing.four },
  callAction: {
    alignSelf: 'flex-end',
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderWidth: 1,
    borderRadius: Radius.control,
    borderColor: AccentColors.primary,
    backgroundColor: 'rgba(232, 197, 71, 0.07)',
  },
  field: { gap: Spacing.one + 2 },

  card: {
    gap: Spacing.three,
    padding: Spacing.four,
    borderWidth: 1,
    borderRadius: Radius.card,
  },
  cardHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },

  barBlock: { gap: Spacing.two },
  bar: { flexDirection: 'row', height: 10, borderRadius: Radius.pill, overflow: 'hidden' },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.three },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one + 2 },
  swatch: { width: 8, height: 8, borderRadius: 2 },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingVertical: Spacing.two + 2,
    borderBottomWidth: 1,
  },
  headRow: { paddingTop: 0 },
  colPhone: { width: 160, gap: 2 },
  colTemp: { width: 70 },
  colNote: { width: 320 },

  chip: {
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderRadius: Radius.pill,
    paddingHorizontal: Spacing.two,
    paddingVertical: 2,
  },

  pitchInput: { minHeight: 96, textAlignVertical: 'top' },
  terms: { gap: Spacing.one + 2, padding: Spacing.three, borderRadius: Radius.control },

  checkRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.two },
  checkbox: {
    width: 20,
    height: 20,
    borderWidth: 1,
    borderRadius: Radius.control - 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkLabel: { flex: 1 },

  progress: { gap: Spacing.two, paddingTop: Spacing.three, borderTopWidth: 1 },
  progressHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  transcript: { gap: Spacing.one, padding: Spacing.three, borderRadius: Radius.control },
});
