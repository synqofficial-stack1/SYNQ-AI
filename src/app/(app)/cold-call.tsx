import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { FileDrop } from '@/components/file-drop';
import { PrimaryButton } from '@/components/primary-button';
import { SalesTabs } from '@/components/sales-tabs';
import { TextField } from '@/components/text-field';
import { ThemedText } from '@/components/themed-text';
import { AccentColors, MaxContentWidth, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { loadCallQueue, recordCall, type CallQueue } from '@/lib/calls';
import { importLeadsFromCsv } from '@/lib/leads';
import { dial, telephonyStatus } from '@/lib/telephony';
import { CALL_OUTCOMES, CALL_OUTCOME_LABELS, type CallOutcome } from '@/types/database';

/** Callbacks are almost always "soon", so offer the three common answers. */
const QUICK_DATES: { label: string; days: number }[] = [
  { label: 'Tomorrow', days: 1 },
  { label: 'In 3 days', days: 3 },
  { label: 'Next week', days: 7 },
];

function isoDateIn(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

export default function ColdCallScreen() {
  const theme = useTheme();
  const telephony = telephonyStatus();

  const [data, setData] = useState<CallQueue | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [started, setStarted] = useState(false);
  const [index, setIndex] = useState(0);

  const [outcome, setOutcome] = useState<CallOutcome | null>(null);
  const [notes, setNotes] = useState('');
  const [followUp, setFollowUp] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dialNote, setDialNote] = useState<string | null>(null);

  const [importing, setImporting] = useState(false);
  const [importNote, setImportNote] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(() => {
    setLoadError(false);
    loadCallQueue()
      .then(setData)
      .catch(() => setLoadError(true));
  }, []);

  useEffect(load, [load]);

  async function handleDroppedFile(text: string, filename: string) {
    setImporting(true);
    setImportNote(null);
    try {
      const { inserted } = await importLeadsFromCsv(text);
      setImportNote({
        ok: inserted > 0,
        text:
          inserted > 0
            ? `Imported ${inserted} contact${inserted === 1 ? '' : 's'} from ${filename}.`
            : `Nothing in ${filename} could be read as a contact.`,
      });
      load();
    } catch (e) {
      setImportNote({
        ok: false,
        text: e instanceof Error ? e.message : 'That file could not be imported.',
      });
    } finally {
      setImporting(false);
    }
  }

  const current = data && started ? (data.queue[index] ?? null) : null;

  const resetForm = () => {
    setOutcome(null);
    setNotes('');
    setFollowUp('');
    setDialNote(null);
    setError(null);
  };

  async function handleCall() {
    if (!current) return;
    const result = await dial(current.phone);
    setDialNote(result.ok ? null : result.message);
  }

  async function handleSaveAndNext() {
    if (!current || !outcome) return;
    setSaving(true);
    setError(null);
    try {
      await recordCall({
        leadId: current.id,
        outcome,
        notes,
        followUpOn: followUp.trim() || null,
      });
      // Updated in place rather than refetched: a salesperson working through
      // hundreds of contacts shouldn't wait on a round trip between each one.
      setData((previous) =>
        previous
          ? {
              ...previous,
              completed: previous.completed + 1,
              counts: { ...previous.counts, [outcome]: previous.counts[outcome] + 1 },
            }
          : previous
      );
      resetForm();
      setIndex((i) => i + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save that call.');
    } finally {
      setSaving(false);
    }
  }

  if (loadError) {
    return (
      <ScrollView contentContainerStyle={styles.content}>
        <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          <ThemedText type="small">Something went wrong loading your contacts.</ThemedText>
          <Pressable accessibilityRole="button" onPress={load}>
            <ThemedText type="small" style={{ color: AccentColors.primary }}>
              Try again
            </ThemedText>
          </Pressable>
        </View>
      </ScrollView>
    );
  }

  if (!data) {
    return (
      <ScrollView contentContainerStyle={styles.content}>
        <ThemedText type="small" themeColor="textSecondary">
          Loading contacts…
        </ThemedText>
      </ScrollView>
    );
  }

  const remaining = data.queue.length - index;
  const progress = data.total === 0 ? 0 : data.completed / data.total;

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <ThemedText type="pageTitle">Cold Call</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          Work through your CRM contacts one at a time and log what happened.
        </ThemedText>
      </View>

      <SalesTabs />

      {data.total === 0 ? (
        <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          <ThemedText type="sectionTitle">No contacts with phone numbers</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            Drop a CRM export with a phone column to build your calling list.
          </ThemedText>

          <FileDrop onText={handleDroppedFile} disabled={importing} />

          {importNote ? (
            <ThemedText
              type="caption"
              style={{ color: importNote.ok ? AccentColors.success : AccentColors.error }}
            >
              {importNote.text}
            </ThemedText>
          ) : null}

          <Pressable accessibilityRole="button" onPress={() => router.push('/import-leads')}>
            <ThemedText type="small" style={{ color: AccentColors.primary }}>
              Or paste a CSV on the CRM page →
            </ThemedText>
          </Pressable>
        </View>
      ) : (
        <>
          <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
            <View style={styles.progressHead}>
              <ThemedText type="caption" themeColor="textSecondary">
                CALLING PROGRESS
              </ThemedText>
              <ThemedText type="caption" themeColor="textSecondary">
                {data.completed} / {data.total} contacts
              </ThemedText>
            </View>
            <View
              style={[styles.progressTrack, { backgroundColor: theme.backgroundSelected }]}
              accessibilityRole="progressbar"
              accessibilityValue={{ min: 0, max: data.total, now: data.completed }}
            >
              <View
                style={[
                  styles.progressFill,
                  { width: `${Math.round(progress * 100)}%`, backgroundColor: AccentColors.primary },
                ]}
              />
            </View>
            <View style={styles.countRow}>
              {CALL_OUTCOMES.filter((key) => data.counts[key] > 0).map((key) => (
                <ThemedText key={key} type="caption" themeColor="textSecondary">
                  {CALL_OUTCOME_LABELS[key]}: {data.counts[key]}
                </ThemedText>
              ))}
            </View>
          </View>

          {!started ? (
            <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
              <ThemedText type="sectionTitle">
                {data.queue.length} contacts ready to call
              </ThemedText>
              {data.completed > 0 ? (
                <ThemedText type="small" themeColor="textSecondary">
                  You&apos;ve already logged {data.completed}. Starting picks up where you left off.
                </ThemedText>
              ) : null}
              <ThemedText type="caption" themeColor="textSecondary">
                {telephony.available ? telephony.description : telephony.reason}
              </ThemedText>
              {data.queue.length > 0 ? (
                <PrimaryButton title="Start calling" onPress={() => setStarted(true)} />
              ) : (
                <ThemedText type="small">Every contact has been called.</ThemedText>
              )}
            </View>
          ) : current ? (
            <>
              <View
                style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}
              >
                <ThemedText type="caption" themeColor="textSecondary">
                  CALLING · {remaining} LEFT
                </ThemedText>
                <ThemedText type="pageTitle">{current.name ?? 'Unnamed contact'}</ThemedText>
                {current.company ? (
                  <ThemedText type="small" themeColor="textSecondary">
                    {current.company}
                  </ThemedText>
                ) : null}
                <ThemedText type="sectionTitle">{current.phone}</ThemedText>

                {current.notes ? (
                  <View style={[styles.notePanel, { backgroundColor: theme.surfaceRaised }]}>
                    <ThemedText type="caption" themeColor="textSecondary">
                      FROM YOUR CRM
                    </ThemedText>
                    <ThemedText type="caption">{current.notes}</ThemedText>
                  </View>
                ) : null}

                <View style={styles.callRow}>
                  <View style={styles.callButton}>
                    <PrimaryButton title="Call" onPress={handleCall} />
                  </View>
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => {
                      resetForm();
                      setIndex((i) => i + 1);
                    }}
                    style={({ hovered }) => [
                      styles.skip,
                      {
                        borderColor: theme.border,
                        backgroundColor: hovered ? theme.surfaceRaised : 'transparent',
                      },
                    ]}
                  >
                    <ThemedText type="small" themeColor="textSecondary">
                      Skip
                    </ThemedText>
                  </Pressable>
                </View>

                {dialNote ? (
                  <ThemedText type="caption" style={{ color: AccentColors.warning }}>
                    {dialNote}
                  </ThemedText>
                ) : null}
              </View>

              <View
                style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}
              >
                <ThemedText type="caption" themeColor="textSecondary">
                  CALL OUTCOME
                </ThemedText>
                <View style={styles.chipRow}>
                  {CALL_OUTCOMES.map((key) => {
                    const active = outcome === key;
                    return (
                      <Pressable
                        key={key}
                        accessibilityRole="button"
                        accessibilityState={{ selected: active }}
                        onPress={() => setOutcome(key)}
                        style={({ hovered }) => [
                          styles.chip,
                          {
                            backgroundColor: active
                              ? AccentColors.primary
                              : hovered
                                ? theme.surfaceRaised
                                : 'transparent',
                            borderColor: active ? AccentColors.primary : theme.border,
                          },
                        ]}
                      >
                        <ThemedText
                          type="caption"
                          style={{ color: active ? '#0d0d0d' : theme.text }}
                        >
                          {CALL_OUTCOME_LABELS[key]}
                        </ThemedText>
                      </Pressable>
                    );
                  })}
                </View>

                <ThemedText type="caption" themeColor="textSecondary">
                  NOTES (OPTIONAL)
                </ThemedText>
                <TextField
                  placeholder="What was said?"
                  value={notes}
                  onChangeText={setNotes}
                  multiline
                  style={styles.notesInput}
                />

                <ThemedText type="caption" themeColor="textSecondary">
                  NEXT FOLLOW-UP (OPTIONAL)
                </ThemedText>
                <View style={styles.chipRow}>
                  {QUICK_DATES.map((quick) => {
                    const value = isoDateIn(quick.days);
                    const active = followUp === value;
                    return (
                      <Pressable
                        key={quick.label}
                        accessibilityRole="button"
                        accessibilityState={{ selected: active }}
                        onPress={() => setFollowUp(active ? '' : value)}
                        style={({ hovered }) => [
                          styles.chip,
                          {
                            backgroundColor: active
                              ? AccentColors.primary
                              : hovered
                                ? theme.surfaceRaised
                                : 'transparent',
                            borderColor: active ? AccentColors.primary : theme.border,
                          },
                        ]}
                      >
                        <ThemedText
                          type="caption"
                          style={{ color: active ? '#0d0d0d' : theme.text }}
                        >
                          {quick.label}
                        </ThemedText>
                      </Pressable>
                    );
                  })}
                </View>
                <TextField
                  placeholder="YYYY-MM-DD"
                  value={followUp}
                  onChangeText={setFollowUp}
                  autoCapitalize="none"
                />

                {error ? (
                  <ThemedText type="small" style={{ color: AccentColors.error }}>
                    {error}
                  </ThemedText>
                ) : null}

                <PrimaryButton
                  title={saving ? 'Saving…' : 'Save & next'}
                  onPress={handleSaveAndNext}
                  loading={saving}
                  disabled={!outcome}
                />
                <Pressable
                  accessibilityRole="button"
                  onPress={() => {
                    setStarted(false);
                    resetForm();
                  }}
                  style={styles.pause}
                >
                  <ThemedText type="caption" themeColor="textSecondary">
                    Pause calling
                  </ThemedText>
                </Pressable>
              </View>
            </>
          ) : (
            <View
              style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}
            >
              <ThemedText type="sectionTitle">Calling session complete</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {data.completed} of {data.total} contacts logged.
              </ThemedText>
              {CALL_OUTCOMES.map((key) => (
                <View key={key} style={styles.summaryRow}>
                  <ThemedText type="small">{CALL_OUTCOME_LABELS[key]}</ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">
                    {data.counts[key]}
                  </ThemedText>
                </View>
              ))}
              <PrimaryButton
                title="Back to start"
                onPress={() => {
                  setStarted(false);
                  setIndex(0);
                  load();
                }}
              />
            </View>
          )}
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
  progressHead: { flexDirection: 'row', justifyContent: 'space-between' },
  progressTrack: { height: 6, borderRadius: 3, overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: 3 },
  countRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.three },
  notePanel: { gap: Spacing.one, padding: Spacing.three, borderRadius: Radius.control },
  callRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, marginTop: Spacing.two },
  callButton: { flex: 1 },
  skip: {
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.three,
    borderRadius: Radius.control,
    borderWidth: 1,
  },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two, marginBottom: Spacing.two },
  chip: {
    borderWidth: 1,
    borderRadius: Radius.pill,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one + 2,
  },
  notesInput: { minHeight: 80, textAlignVertical: 'top' },
  pause: { alignSelf: 'center', paddingTop: Spacing.two },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 2 },
});
