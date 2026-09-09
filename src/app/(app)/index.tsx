import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PrimaryButton } from '@/components/primary-button';
import { TextField } from '@/components/text-field';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { AccentColors, MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { listLeads } from '@/lib/leads';
import { supabase } from '@/lib/supabase';
import { RunTaskError, runTask, TASK_LABELS, TASK_TYPES, type SalesTaskType } from '@/lib/tasks';
import type { Lead } from '@/types/database';

export default function SalesAgentScreen() {
  const theme = useTheme();
  const [taskType, setTaskType] = useState<SalesTaskType>('qualify_lead');
  const [leads, setLeads] = useState<Lead[]>([]);
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null);
  const [notes, setNotes] = useState('');
  const [extra, setExtra] = useState('');
  const [output, setOutput] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Leads are a convenience, not a requirement — if the table isn't reachable
  // the notes box still works, so a failure here is deliberately silent.
  useEffect(() => {
    listLeads()
      .then(setLeads)
      .catch(() => {});
  }, []);

  const selectedLead = leads.find((lead) => lead.id === selectedLeadId) ?? null;

  async function handleRun() {
    setError(null);
    setOutput(null);
    setLoading(true);
    try {
      const result = await runTask({
        taskType,
        leadId: selectedLeadId ?? undefined,
        notes: selectedLeadId ? undefined : notes,
        extraInstructions: extra,
      });
      setOutput(result.output);
    } catch (e) {
      setError(
        e instanceof RunTaskError
          ? e.message
          : 'Could not reach the server. Check your connection and try again.'
      );
    } finally {
      setLoading(false);
    }
  }

  const canRun = selectedLeadId !== null || notes.trim().length > 0;

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ScrollView contentContainerStyle={styles.content}>
          <ThemedText type="subtitle">Sales AI</ThemedText>

          <ThemedText type="smallBold">What should it do?</ThemedText>
          <View style={styles.row}>
            {TASK_TYPES.map((type) => {
              const active = type === taskType;
              return (
                <Pressable
                  key={type}
                  onPress={() => setTaskType(type)}
                  style={[
                    styles.chip,
                    {
                      backgroundColor: active ? AccentColors.primary : theme.backgroundElement,
                      borderColor: active ? AccentColors.primary : theme.backgroundSelected,
                    },
                  ]}
                >
                  <ThemedText
                    type="small"
                    style={{ color: active ? theme.background : theme.text }}
                  >
                    {TASK_LABELS[type]}
                  </ThemedText>
                </Pressable>
              );
            })}
          </View>

          {leads.length > 0 ? (
            <>
              <ThemedText type="smallBold">Pick a lead</ThemedText>
              <View style={styles.row}>
                {leads.slice(0, 12).map((lead) => {
                  const active = lead.id === selectedLeadId;
                  return (
                    <Pressable
                      key={lead.id}
                      onPress={() => setSelectedLeadId(active ? null : lead.id)}
                      style={[
                        styles.chip,
                        {
                          backgroundColor: active
                            ? AccentColors.primary
                            : theme.backgroundElement,
                          borderColor: active ? AccentColors.primary : theme.backgroundSelected,
                        },
                      ]}
                    >
                      <ThemedText
                        type="small"
                        style={{ color: active ? theme.background : theme.text }}
                      >
                        {lead.name ?? lead.company ?? 'Unnamed lead'}
                      </ThemedText>
                    </Pressable>
                  );
                })}
              </View>
            </>
          ) : null}

          {selectedLead ? (
            <View style={[styles.panel, { backgroundColor: theme.backgroundElement }]}>
              <ThemedText type="smallBold">
                {selectedLead.name ?? 'Unnamed lead'}
                {selectedLead.company ? ` — ${selectedLead.company}` : ''}
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {selectedLead.notes ?? 'No notes recorded for this lead.'}
              </ThemedText>
            </View>
          ) : (
            <>
              <ThemedText type="smallBold">
                {leads.length > 0 ? 'Or paste notes about a lead' : 'Paste notes about a lead'}
              </ThemedText>
              <TextField
                placeholder="Spoke to Ada at Acme. They have budget signed off and want a demo before end of quarter."
                value={notes}
                onChangeText={setNotes}
                multiline
                style={styles.notesInput}
              />
            </>
          )}

          <ThemedText type="smallBold">Anything to add? (optional)</ThemedText>
          <TextField
            placeholder="Keep it under 100 words"
            value={extra}
            onChangeText={setExtra}
          />

          {error ? <ThemedText style={styles.error}>{error}</ThemedText> : null}

          <PrimaryButton
            title={loading ? 'Working…' : 'Run'}
            onPress={handleRun}
            loading={loading}
            disabled={!canRun}
          />

          {output ? (
            <View style={[styles.panel, { backgroundColor: theme.backgroundElement }]}>
              <ThemedText type="smallBold">Result</ThemedText>
              <ThemedText type="default" selectable style={styles.output}>
                {output}
              </ThemedText>
            </View>
          ) : null}

          <View style={styles.footer}>
            <PrimaryButton
              title="History"
              onPress={() => router.push('/(app)/history')}
            />
            <PrimaryButton
              title="Import Leads"
              onPress={() => router.push('/(app)/import-leads')}
            />
            <PrimaryButton title="Log Out" onPress={() => supabase.auth.signOut()} />
          </View>
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safeArea: { flex: 1 },
  content: {
    gap: Spacing.two,
    padding: Spacing.four,
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
  },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  chip: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  panel: { gap: Spacing.two, padding: Spacing.three, borderRadius: 12 },
  notesInput: { minHeight: 120, textAlignVertical: 'top' },
  output: { lineHeight: 22 },
  error: { color: '#e5484d' },
  footer: { gap: Spacing.two, marginTop: Spacing.four },
});
