import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { ChatPanel } from '@/components/chat-panel';
import { PrimaryButton } from '@/components/primary-button';
import { SalesTabs } from '@/components/sales-tabs';
import { TextField } from '@/components/text-field';
import { ThemedText } from '@/components/themed-text';
import { AccentColors, MaxContentWidth, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { listLeads } from '@/lib/leads';
import type { Lead } from '@/types/database';

const JOBS = [
  { key: 'qualify', label: 'Qualify this lead', ask: 'Qualify this lead.' },
  { key: 'email', label: 'Draft an email', ask: 'Write the outreach email.' },
  { key: 'script', label: 'Write a call script', ask: 'Write the phone call script.' },
] as const;

type JobKey = (typeof JOBS)[number]['key'];

function describeLead(lead: Lead): string {
  return (
    [
      lead.name ? `Name: ${lead.name}` : '',
      lead.company ? `Company: ${lead.company}` : '',
      lead.email ? `Email: ${lead.email}` : '',
      lead.phone ? `Phone: ${lead.phone}` : '',
    ]
      .filter(Boolean)
      .join('\n') + `\nNotes:\n${lead.notes ?? '(no notes recorded)'}`
  );
}

export default function SalesAiScreen() {
  const theme = useTheme();
  const [job, setJob] = useState<JobKey>('qualify');
  const [leads, setLeads] = useState<Lead[]>([]);
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null);
  const [notes, setNotes] = useState('');
  const [seed, setSeed] = useState<string | undefined>();

  // Leads are a convenience, not a requirement — if the table isn't reachable
  // the notes box still works, so a failure here is deliberately silent.
  useEffect(() => {
    listLeads()
      .then(setLeads)
      .catch(() => {});
  }, []);

  const selectedLead = leads.find((lead) => lead.id === selectedLeadId) ?? null;
  const canStart = selectedLead !== null || notes.trim().length > 0;

  function start() {
    const ask = JOBS.find((entry) => entry.key === job)!.ask;
    const material = selectedLead ? describeLead(selectedLead) : `Notes:\n${notes.trim()}`;
    setSeed(`${ask}\n\nLEAD\n${material}`);
  }

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <ThemedText type="pageTitle">Sales AI</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          Qualify leads and draft outreach, then keep talking until it reads right.
        </ThemedText>
      </View>

      <SalesTabs />

      {seed ? (
        <ChatPanel
          kind="sales_ai"
          placeholder="Refine it — shorter, warmer, different angle…"
          seedMessage={seed}
          height={440}
          resume={false}
        />
      ) : (
        <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          <ThemedText type="caption" themeColor="textSecondary">
            WHAT SHOULD IT DO
          </ThemedText>
          <View style={styles.chipRow}>
            {JOBS.map((entry) => {
              const active = entry.key === job;
              return (
                <Pressable
                  key={entry.key}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  onPress={() => setJob(entry.key)}
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
                  <ThemedText type="caption" style={{ color: active ? '#0d0d0d' : theme.text }}>
                    {entry.label}
                  </ThemedText>
                </Pressable>
              );
            })}
          </View>

          {leads.length > 0 ? (
            <>
              <ThemedText type="caption" themeColor="textSecondary">
                PICK A LEAD
              </ThemedText>
              <View style={styles.chipRow}>
                {leads.slice(0, 12).map((lead) => {
                  const active = lead.id === selectedLeadId;
                  return (
                    <Pressable
                      key={lead.id}
                      accessibilityRole="button"
                      accessibilityState={{ selected: active }}
                      onPress={() => setSelectedLeadId(active ? null : lead.id)}
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
                      <ThemedText type="caption" style={{ color: active ? '#0d0d0d' : theme.text }}>
                        {lead.name ?? lead.company ?? 'Unnamed lead'}
                      </ThemedText>
                    </Pressable>
                  );
                })}
              </View>
            </>
          ) : null}

          {selectedLead ? (
            <View style={[styles.panel, { backgroundColor: theme.surfaceRaised }]}>
              <ThemedText type="smallBold">
                {selectedLead.name ?? 'Unnamed lead'}
                {selectedLead.company ? ` — ${selectedLead.company}` : ''}
              </ThemedText>
              <ThemedText type="caption" themeColor="textSecondary">
                {selectedLead.notes ?? 'No notes recorded for this lead.'}
              </ThemedText>
            </View>
          ) : (
            <>
              <ThemedText type="caption" themeColor="textSecondary">
                {leads.length > 0 ? 'OR PASTE NOTES ABOUT A LEAD' : 'PASTE NOTES ABOUT A LEAD'}
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

          <PrimaryButton title="Start" onPress={start} disabled={!canStart} />
        </View>
      )}

      {seed ? (
        <Pressable accessibilityRole="button" onPress={() => setSeed(undefined)} style={styles.reset}>
          <ThemedText type="caption" themeColor="textSecondary">
            Start over with a different lead
          </ThemedText>
        </Pressable>
      ) : null}
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
  card: { gap: Spacing.two, padding: Spacing.four, borderRadius: Radius.card, borderWidth: 1 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two, marginBottom: Spacing.two },
  chip: {
    borderWidth: 1,
    borderRadius: Radius.pill,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one + 2,
  },
  panel: { gap: Spacing.one, padding: Spacing.three, borderRadius: Radius.control },
  notesInput: { minHeight: 110, textAlignVertical: 'top' },
  reset: { alignSelf: 'center' },
});
