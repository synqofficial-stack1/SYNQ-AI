import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { SalesTabs } from '@/components/sales-tabs';
import { ThemedText } from '@/components/themed-text';
import { AccentColors, MaxContentWidth, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { listFollowUps, type FollowUp } from '@/lib/calls';
import { CALL_OUTCOME_LABELS } from '@/types/database';

function describeDate(iso: string): string {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(`${iso}T00:00:00`);
  const days = Math.round((target.getTime() - today.getTime()) / 86_400_000);

  if (days < 0) return `Overdue by ${Math.abs(days)} day${Math.abs(days) === 1 ? '' : 's'}`;
  if (days === 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  return `In ${days} days`;
}

export default function FollowUpsScreen() {
  const theme = useTheme();
  const [items, setItems] = useState<FollowUp[] | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(() => {
    setFailed(false);
    listFollowUps()
      .then(setItems)
      .catch(() => setFailed(true));
  }, []);

  useEffect(load, [load]);

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <ThemedText type="pageTitle">Follow-ups</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          Callbacks you scheduled while working through your calling list.
        </ThemedText>
      </View>

      <SalesTabs />

      <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
        {failed ? (
          <>
            <ThemedText type="small">Something went wrong loading your follow-ups.</ThemedText>
            <Pressable accessibilityRole="button" onPress={load}>
              <ThemedText type="small" style={{ color: AccentColors.primary }}>
                Try again
              </ThemedText>
            </Pressable>
          </>
        ) : items === null ? (
          <ThemedText type="small" themeColor="textSecondary">
            Loading…
          </ThemedText>
        ) : items.length === 0 ? (
          <>
            <ThemedText type="sectionTitle">No follow-ups scheduled</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              Set a follow-up date while logging a call and it will show up here.
            </ThemedText>
            <Pressable accessibilityRole="button" onPress={() => router.push('/cold-call')}>
              <ThemedText type="small" style={{ color: AccentColors.primary }}>
                Start calling →
              </ThemedText>
            </Pressable>
          </>
        ) : (
          items.map((item) => {
            const overdue = describeDate(item.followUpOn).startsWith('Overdue');
            return (
              <View key={item.id} style={[styles.row, { borderColor: theme.border }]}>
                <View style={styles.rowMain}>
                  <ThemedText type="small">
                    {item.leadName}
                    {item.company ? ` — ${item.company}` : ''}
                  </ThemedText>
                  <ThemedText type="caption" themeColor="textSecondary">
                    {CALL_OUTCOME_LABELS[item.outcome]}
                    {item.phone ? ` · ${item.phone}` : ''}
                  </ThemedText>
                  {item.notes ? (
                    <ThemedText type="caption" themeColor="textSecondary" numberOfLines={2}>
                      {item.notes}
                    </ThemedText>
                  ) : null}
                </View>
                <ThemedText
                  type="caption"
                  style={overdue ? { color: AccentColors.error } : undefined}
                  themeColor={overdue ? undefined : 'textSecondary'}
                >
                  {describeDate(item.followUpOn)}
                </ThemedText>
              </View>
            );
          })
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: Spacing.four,
    padding: Spacing.five,
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
  },
  header: { gap: Spacing.one },
  card: {
    gap: Spacing.two,
    padding: Spacing.four,
    borderRadius: Radius.card,
    borderWidth: 1,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.three,
    paddingVertical: Spacing.three,
    borderTopWidth: 1,
  },
  rowMain: { flex: 1, gap: 2 },
});
