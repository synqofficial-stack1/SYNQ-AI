import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { ActivityLineChart } from '@/components/charts';
import { ThemedText } from '@/components/themed-text';
import { AccentColors, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { supabase } from '@/lib/supabase';

type Department = 'sales' | 'marketing';
type ActivityDay = { key: string; label: string; count: number };
type ActivitySummary = { days: ActivityDay[]; total: number; peak: number };

const WINDOW_DAYS = 14;
const CHART_GOLD = AccentColors.primary;

function dateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

async function loadDepartmentActivity(department: Department): Promise<ActivitySummary> {
  const since = new Date();
  since.setDate(since.getDate() - (WINDOW_DAYS - 1));
  since.setHours(0, 0, 0, 0);
  const sinceIso = since.toISOString();
  let timestamps: string[] = [];

  if (department === 'sales') {
    const [runs, calls] = await Promise.all([
      supabase.from('sales_runs').select('created_at').gte('created_at', sinceIso),
      supabase.from('calls').select('created_at').gte('created_at', sinceIso),
    ]);
    if (runs.error) throw new Error(runs.error.message);
    if (calls.error) throw new Error(calls.error.message);
    timestamps = [...(runs.data ?? []), ...(calls.data ?? [])].map((row) => row.created_at);
  } else {
    const [videos, posts, messagesResult] = await Promise.all([
      supabase.from('videos').select('created_at').gte('created_at', sinceIso),
      supabase.from('social_posts').select('created_at').gte('created_at', sinceIso),
      supabase
        .from('messages')
        .select('created_at, conversations ( kind )')
        .eq('role', 'user')
        .gte('created_at', sinceIso),
    ]);
    if (videos.error) throw new Error(videos.error.message);
    if (posts.error) throw new Error(posts.error.message);
    if (messagesResult.error) throw new Error(messagesResult.error.message);
    const messages = (messagesResult.data ?? []) as unknown as {
      created_at: string;
      conversations: { kind: string } | null;
    }[];
    timestamps = [
      ...(videos.data ?? []).map((row) => row.created_at),
      ...(posts.data ?? []).map((row) => row.created_at),
      ...messages
        .filter((row) => row.conversations?.kind === 'content' || row.conversations?.kind === 'campaign')
        .map((row) => row.created_at),
    ];
  }

  const buckets = new Map<string, number>();
  const days: ActivityDay[] = [];
  for (let offset = WINDOW_DAYS - 1; offset >= 0; offset--) {
    const date = new Date();
    date.setDate(date.getDate() - offset);
    const key = dateKey(date);
    buckets.set(key, 0);
    days.push({ key, label: String(date.getDate()), count: 0 });
  }
  timestamps.forEach((stamp) => {
    const key = dateKey(new Date(stamp));
    if (buckets.has(key)) buckets.set(key, (buckets.get(key) ?? 0) + 1);
  });
  days.forEach((day) => { day.count = buckets.get(day.key) ?? 0; });

  return {
    days,
    total: days.reduce((sum, day) => sum + day.count, 0),
    peak: Math.max(0, ...days.map((day) => day.count)),
  };
}

export function DepartmentActivityChart({ department }: { department: Department }) {
  const theme = useTheme();
  const [summary, setSummary] = useState<ActivitySummary | null>(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);
  const departmentName = department === 'sales' ? 'Sales' : 'Marketing';

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      setSummary(await loadDepartmentActivity(department));
    } catch {
      setSummary(null);
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [department]);

  useFocusEffect(useCallback(() => { refresh(); }, [refresh]));

  return (
    <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
      <View style={styles.header}>
        <View style={styles.summary}>
          <View style={styles.kpi}>
            <ThemedText type="caption" themeColor="textSecondary" style={styles.eyebrow}>14 DAY TOTAL</ThemedText>
            <ThemedText style={[styles.total, { color: theme.text }]}>{loading ? '—' : String(summary?.total ?? 0)}</ThemedText>
          </View>
          <View style={[styles.divider, { backgroundColor: theme.border }]} />
          <View style={styles.kpi}>
            <ThemedText type="caption" themeColor="textSecondary" style={styles.eyebrow}>BUSIEST DAY</ThemedText>
            <ThemedText style={[styles.total, { color: theme.text }]}>{loading ? '—' : String(summary?.peak ?? 0)}</ThemedText>
          </View>
        </View>
        <View style={[styles.periodPill, { borderColor: theme.border, backgroundColor: theme.surfaceRaised }]}>
          <ThemedText type="caption" themeColor="textSecondary" style={styles.periodText}>14 DAYS</ThemedText>
        </View>
      </View>

      {loading ? (
        <View style={styles.message}><ActivityIndicator color={CHART_GOLD} /></View>
      ) : error ? (
        <View style={styles.message}>
          <ThemedText type="small" themeColor="textSecondary">{departmentName} activity could not be loaded.</ThemedText>
        </View>
      ) : summary ? (
        <>
          <ActivityLineChart days={summary.days} height={216} unit="actions" color={CHART_GOLD} />
          <View style={styles.legend}>
            <View style={[styles.legendDot, { backgroundColor: CHART_GOLD }]} />
            <ThemedText type="caption" themeColor="textSecondary">{departmentName} activity · per day</ThemedText>
          </View>
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { gap: Spacing.three, padding: Spacing.four, borderWidth: 1, borderRadius: Radius.card },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.two },
  summary: { flexDirection: 'row', alignItems: 'center', gap: Spacing.four },
  kpi: { gap: 2 },
  eyebrow: { fontSize: 9, letterSpacing: 1.2 },
  total: { fontSize: 27, lineHeight: 31, fontWeight: '700', fontVariant: ['tabular-nums'] },
  divider: { width: 1, height: 35 },
  periodPill: { paddingHorizontal: Spacing.two, paddingVertical: Spacing.one, borderWidth: 1, borderColor: '#35434F', borderRadius: Radius.pill },
  periodText: { fontSize: 9, letterSpacing: 0.8 },
  message: { height: 216, alignItems: 'center', justifyContent: 'center' },
  legend: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one },
  legendDot: { width: 7, height: 7, borderRadius: Radius.pill },
});
