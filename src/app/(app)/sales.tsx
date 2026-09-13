import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';

import { PrimaryButton } from '@/components/primary-button';
import { ThemedText } from '@/components/themed-text';
import { AccentColors, Radius, Spacing, WideBreakpoint } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { ATTESTATION_TERMS, callingWindowNote, withinCallingWindow } from '@/lib/sales/compliance';
import {
  approveRun,
  loadLatestRun,
  loadSalesDashboard,
  startCalling,
  toSheetRows,
  type RunWithProspects,
  type SalesDashboard,
  type SheetRow,
} from '@/lib/sales/runs';
import { RUN_STATUS_LABELS, type Temperature } from '@/types/database';

// The Sales department is a dashboard and a calling panel, and nothing else.
// There is no form here and no job picker: work arrives by telling Synq what to
// do, in the sidebar chat. This screen is where the answer shows up.

const RAIL_WIDTH = 360;

/** Hot carries the accent because it is the only number worth acting on today. */
const TEMPERATURE_COLORS: Record<Temperature, string> = {
  hot: AccentColors.primary,
  warm: '#8c8c8c',
  cold: '#4a4a4a',
};

function StatTile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  const theme = useTheme();
  return (
    <View style={[styles.tile, { backgroundColor: theme.surface, borderColor: theme.border }]}>
      <ThemedText type="caption" themeColor="textSecondary">
        {label.toUpperCase()}
      </ThemedText>
      <ThemedText style={styles.tileValue}>{value}</ThemedText>
      {hint ? (
        <ThemedText type="caption" themeColor="textSecondary">
          {hint}
        </ThemedText>
      ) : null}
    </View>
  );
}

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

function SheetTable({ rows }: { rows: SheetRow[] }) {
  const theme = useTheme();

  return (
    <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
      <View style={styles.cardHead}>
        <ThemedText type="smallBold">Call sheet</ThemedText>
        <ThemedText type="caption" themeColor="textSecondary">
          {rows.length} {rows.length === 1 ? 'business' : 'businesses'}
        </ThemedText>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View>
          <View style={[styles.row, styles.headRow, { borderBottomColor: theme.border }]}>
            <ThemedText type="caption" themeColor="textSecondary" style={styles.colName}>
              BUSINESS
            </ThemedText>
            <ThemedText type="caption" themeColor="textSecondary" style={styles.colPhone}>
              PHONE
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
              <View style={styles.colName}>
                <ThemedText type="small" numberOfLines={1}>
                  {row.name}
                </ThemedText>
                {row.category ? (
                  <ThemedText type="caption" themeColor="textSecondary" numberOfLines={1}>
                    {row.category}
                  </ThemedText>
                ) : null}
              </View>

              <ThemedText type="small" themeColor="textSecondary" style={styles.colPhone}>
                {row.phone ?? 'No number'}
              </ThemedText>

              <View style={styles.colTemp}>
                <TemperatureChip value={row.temperature} />
              </View>

              <View style={styles.colNote}>
                {row.note ? (
                  <ThemedText type="small" themeColor="textSecondary">
                    {row.note}
                  </ThemedText>
                ) : (
                  <ThemedText type="caption" themeColor="textSecondary">
                    {row.eligibility === 'excluded'
                      ? (row.eligibilityReason ?? 'Excluded')
                      : row.status === 'dialing'
                        ? 'Calling now…'
                        : 'Not called yet'}
                  </ThemedText>
                )}
              </View>
            </View>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

function CallPanel({
  current,
  onChanged,
}: {
  current: RunWithProspects | null;
  onChanged: () => void;
}) {
  const theme = useTheme();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);

  const run = current?.run ?? null;
  const prospects = current?.prospects ?? [];
  const eligible = prospects.filter((p) => p.eligibility === 'eligible');
  const called = prospects.filter((p) => p.outreach_status === 'called').length;
  const inWindow = withinCallingWindow();

  async function approveAndCall() {
    if (!run) return;
    setBusy(true);
    setError(null);
    try {
      await approveRun(run.id);
      const outcome = await startCalling(run.id);
      if (outcome.queued === 0) setError('Nothing was queued. Check the numbers on the list.');
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That did not go through.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
      <View style={styles.cardHead}>
        <ThemedText type="smallBold">Cold call</ThemedText>
        {run ? (
          <ThemedText type="caption" themeColor="textSecondary">
            {RUN_STATUS_LABELS[run.status]}
          </ThemedText>
        ) : null}
      </View>

      {!run ? (
        <View style={styles.stack}>
          <ThemedText type="small" themeColor="textSecondary">
            Nothing running. Ask Synq in the chat to start something, like:
          </ThemedText>
          <View style={[styles.quote, { borderLeftColor: AccentColors.primary }]}>
            <ThemedText type="small">
              Find 20 salons in Hyderabad and call them about our website service.
            </ThemedText>
          </View>
        </View>
      ) : run.status === 'blocked' ? (
        <View style={styles.stack}>
          <ThemedText type="small">{run.blocked_reason ?? 'This run stopped.'}</ThemedText>
        </View>
      ) : run.status === 'awaiting_approval' ? (
        <View style={styles.stack}>
          <ThemedText type="small">
            {eligible.length} {eligible.length === 1 ? 'business is' : 'businesses are'} ready to
            call. Nothing has been dialled.
          </ThemedText>

          <View style={[styles.terms, { backgroundColor: theme.surfaceRaised }]}>
            {ATTESTATION_TERMS.map((term) => (
              <ThemedText key={term} type="caption" themeColor="textSecondary">
                • {term}
              </ThemedText>
            ))}
          </View>

          <Pressable
            accessibilityRole="checkbox"
            accessibilityState={{ checked: confirmed }}
            onPress={() => setConfirmed((value) => !value)}
            style={styles.checkRow}
          >
            <View
              style={[
                styles.checkbox,
                {
                  borderColor: confirmed ? AccentColors.primary : theme.borderStrong,
                  backgroundColor: confirmed ? AccentColors.primary : 'transparent',
                },
              ]}
            >
              {confirmed ? (
                <ThemedText type="caption" style={{ color: '#0d0d0d' }}>
                  ✓
                </ThemedText>
              ) : null}
            </View>
            <ThemedText type="small" style={styles.checkLabel}>
              I have a legitimate business reason to call these numbers.
            </ThemedText>
          </Pressable>

          {!inWindow ? (
            <ThemedText type="caption" themeColor="textSecondary">
              {callingWindowNote()}
            </ThemedText>
          ) : null}

          <PrimaryButton
            title={busy ? 'Starting…' : `Call ${eligible.length}`}
            onPress={approveAndCall}
            disabled={!confirmed || busy || eligible.length === 0 || !inWindow}
          />
        </View>
      ) : (
        <View style={styles.stack}>
          <ThemedText type="small">
            {called} of {run.calls_placed || eligible.length} calls finished.
          </ThemedText>
          <View style={[styles.progressTrack, { backgroundColor: theme.surfaceRaised }]}>
            <View
              style={[
                styles.progressFill,
                {
                  backgroundColor: AccentColors.primary,
                  width: `${Math.round((called / Math.max(run.calls_placed || eligible.length, 1)) * 100)}%`,
                },
              ]}
            />
          </View>
          {run.status === 'calling' ? (
            <ThemedText type="caption" themeColor="textSecondary">
              Results appear here as each call ends.
            </ThemedText>
          ) : null}
        </View>
      )}

      {error ? (
        <ThemedText type="small" style={{ color: AccentColors.error }}>
          {error}
        </ThemedText>
      ) : null}
    </View>
  );
}

export default function SalesScreen() {
  const theme = useTheme();
  const { width } = useWindowDimensions();
  const wide = width >= WideBreakpoint;

  const [dashboard, setDashboard] = useState<SalesDashboard | null>(null);
  const [current, setCurrent] = useState<RunWithProspects | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const [summary, latest] = await Promise.all([
      loadSalesDashboard().catch(() => null),
      loadLatestRun().catch(() => null),
    ]);
    setDashboard(summary);
    setCurrent(latest);
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // While calls are with the provider the results arrive by webhook, so the
  // screen has to ask. It only polls while something is actually in flight.
  useEffect(() => {
    if (current?.run.status !== 'calling') return;
    const timer = setInterval(refresh, 10_000);
    return () => clearInterval(timer);
  }, [current?.run.status, refresh]);

  const rows = toSheetRows(current?.prospects ?? []);

  const dashboardColumn = (
    <View style={styles.stackWide}>
      <View style={styles.header}>
        <ThemedText type="pageTitle">Sales</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          Tell Synq who to call. It finds them, calls them, and writes down what they said.
        </ThemedText>
      </View>

      {loading ? (
        <ActivityIndicator color={AccentColors.primary} />
      ) : (
        <>
          <View style={styles.tiles}>
            <StatTile label="Businesses found" value={String(dashboard?.businessesFound ?? 0)} />
            <StatTile label="Calls finished" value={String(dashboard?.callsCompleted ?? 0)} />
            <StatTile
              label="Hot leads"
              value={String(dashboard?.byTemperature.hot ?? 0)}
              hint="Wanted to go further"
            />
          </View>

          <View
            style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}
          >
            <ThemedText type="smallBold">How the calls went</ThemedText>
            {dashboard ? <TemperatureBar data={dashboard} /> : null}
          </View>

          {rows.length > 0 ? (
            <SheetTable rows={rows} />
          ) : (
            <View
              style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}
            >
              <ThemedText type="smallBold">No call sheet yet</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                Ask Synq to find businesses for you and the list will build itself here.
              </ThemedText>
            </View>
          )}
        </>
      )}
    </View>
  );

  if (!wide) {
    return (
      <ScrollView contentContainerStyle={styles.narrow}>
        {dashboardColumn}
        <CallPanel current={current} onChanged={refresh} />
      </ScrollView>
    );
  }

  return (
    <View style={styles.split}>
      <ScrollView contentContainerStyle={styles.mainColumn}>{dashboardColumn}</ScrollView>
      <ScrollView
        contentContainerStyle={styles.rail}
        style={[styles.railOuter, { borderLeftColor: theme.border }]}
      >
        <CallPanel current={current} onChanged={refresh} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  split: { flex: 1, flexDirection: 'row' },
  mainColumn: { padding: Spacing.five, gap: Spacing.four },
  railOuter: { width: RAIL_WIDTH, borderLeftWidth: 1 },
  rail: { padding: Spacing.four, gap: Spacing.three },
  narrow: { padding: Spacing.four, gap: Spacing.four },

  header: { gap: Spacing.one },
  stack: { gap: Spacing.three },
  stackWide: { gap: Spacing.four },

  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.three },
  tile: {
    flexGrow: 1,
    flexBasis: 160,
    gap: Spacing.one,
    padding: Spacing.three,
    borderWidth: 1,
    borderRadius: Radius.card,
  },
  tileValue: { fontSize: 30, lineHeight: 36, fontWeight: '600' },

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
  colName: { width: 180, gap: 2 },
  colPhone: { width: 140 },
  colTemp: { width: 70 },
  colNote: { width: 260 },

  chip: {
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderRadius: Radius.pill,
    paddingHorizontal: Spacing.two,
    paddingVertical: 2,
  },

  quote: { borderLeftWidth: 2, paddingLeft: Spacing.three, paddingVertical: Spacing.one },
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

  progressTrack: { height: 6, borderRadius: Radius.pill, overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: Radius.pill },
});
