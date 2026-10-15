import { useCallback, useEffect, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';

import { PrimaryButton } from '@/components/primary-button';
import { ModalSheet } from '@/components/modal-sheet';
import { SalesCallReport } from '@/components/sales-call-report';
import { TextField } from '@/components/text-field';
import { ThemedText } from '@/components/themed-text';
import { AccentColors, MaxContentWidth, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { subscribeAnalytics } from '@/lib/analytics-events';
import { callingWindowNote, withinCallingWindow } from '@/lib/sales/compliance';
import {
  callNumber,
  checkCall,
  loadLastPitch,
  loadRecentCalls,
  loadSalesDashboard,
  toSheetRows,
  type CallStatus,
  type SalesDashboard,
  type SheetRow,
} from '@/lib/sales/runs';
import type { Temperature } from '@/types/database';

// The Sales department, for now, is one job: type a number and Synq's sales
// agent calls it and holds the conversation. The dashboard on the left shows
// how the calls went; the rail on the right is where a call starts.
//
// Google Maps discovery and list calling still exist in lib/sales/runs.ts and
// the place-calls function. They are off this screen while single-number
// calling is the focus.

/** How often a live call is checked on. */
const CALL_POLL_MS = 4000;

/** Hot carries the accent because it is the only number worth acting on today. */
const TEMPERATURE_COLORS: Record<Temperature, string> = {
  hot: AccentColors.primary,
  warm: '#8c8c8c',
  cold: '#4a4a4a',
};

const CALL_STATE_LABELS: Record<CallStatus['state'], string> = {
  ringing: 'Ringing…',
  talking: 'On the call…',
  wrapping_up: 'Call ended. Writing the notes…',
  done: 'Call finished',
  failed: 'The call did not go through',
};

/** What the user agrees to before a call. Shown above the checkbox, verbatim. */
const CALL_TERMS = [
  'The agent says it is an AI at the start of the call.',
  'If they ask not to be called again, Synq never calls that number again.',
  'Calls only go out between 9am and 9pm.',
];

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

function ConfirmCheck({
  checked,
  onToggle,
  label,
}: {
  checked: boolean;
  onToggle: () => void;
  label: string;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      onPress={onToggle}
      style={styles.checkRow}
    >
      <View
        style={[
          styles.checkbox,
          {
            borderColor: checked ? AccentColors.primary : theme.borderStrong,
            backgroundColor: checked ? AccentColors.primary : 'transparent',
          },
        ]}
      >
        {checked ? (
          <ThemedText type="caption" style={{ color: '#0d0d0d' }}>
            ✓
          </ThemedText>
        ) : null}
      </View>
      <ThemedText type="small" style={styles.checkLabel}>
        {label}
      </ThemedText>
    </Pressable>
  );
}

function CallProgress({ call }: { call: CallStatus }) {
  const theme = useTheme();
  const finished = call.state === 'done' || call.state === 'failed';

  return (
    <View style={[styles.progress, { borderTopColor: theme.border }]}>
      <View style={styles.progressHead}>
        {finished ? null : <ActivityIndicator size="small" color={AccentColors.primary} />}
        <ThemedText type="smallBold">{CALL_STATE_LABELS[call.state]}</ThemedText>
        {call.state === 'done' ? <TemperatureChip value={call.temperature} /> : null}
      </View>

      {call.note ? <ThemedText type="small">{call.note}</ThemedText> : null}
      {call.summary && call.summary !== call.note ? (
        <ThemedText type="caption" themeColor="textSecondary">
          {call.summary}
        </ThemedText>
      ) : null}

      {call.transcript.length > 0 ? (
        <View style={[styles.transcript, { backgroundColor: theme.surfaceRaised }]}>
          {call.transcript.slice(-12).map((line, index) => (
            <ThemedText key={index} type="caption" themeColor="textSecondary">
              {line.speaker === 'agent' ? 'Synq: ' : 'Them: '}
              {line.text}
            </ThemedText>
          ))}
        </View>
      ) : null}
    </View>
  );
}

function CallNumberCard({
  lastPitch,
  onChanged,
}: {
  lastPitch: string;
  onChanged: () => void;
}) {
  const theme = useTheme();
  const [phone, setPhone] = useState('');
  const [pitch, setPitch] = useState(lastPitch);
  const [questions, setQuestions] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [prospectId, setProspectId] = useState<string | null>(null);
  const [call, setCall] = useState<CallStatus | null>(null);

  // The last pitch loads after the first render. Fill it in, unless the user
  // has already started typing their own.
  const pitchTouched = useRef(false);
  useEffect(() => {
    if (!pitchTouched.current) setPitch(lastPitch);
  }, [lastPitch]);

  const number = phone.replace(/[\s()-]/g, '');
  const validNumber = /^\+\d{8,15}$/.test(number);
  const questionList = questions.split('\n').map(q => q.trim()).filter(Boolean);
  const validQuestions = questionList.length <= 12 && questionList.every(q => q.length <= 300);
  const inWindow = withinCallingWindow();
  const live = prospectId !== null && call?.state !== 'done' && call?.state !== 'failed';

  // ElevenLabs does not tell Synq when the call moves on, so the card asks.
  const checking = useRef(false);
  useEffect(() => {
    if (!prospectId || !live) return;

    const tick = async () => {
      if (checking.current) return;
      checking.current = true;
      try {
        const next = await checkCall(prospectId);
        setCall(next);
        setError(null);
        if (next.state === 'done' || next.state === 'failed') onChanged();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not check on the call.');
      } finally {
        checking.current = false;
      }
    };

    const timer = setInterval(tick, CALL_POLL_MS);
    tick();
    return () => clearInterval(timer);
  }, [prospectId, live, onChanged]);

  async function start() {
    setBusy(true);
    setError(null);
    setCall(null);
    setProspectId(null);
    try {
      const started = await callNumber({ phone: number, pitch: pitch.trim(), questions: questionList, confirmed });
      setCall({ state: 'ringing', note: null, temperature: null, summary: null, error: null, transcript: [] });
      setProspectId(started.prospect_id);
      setConfirmed(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That did not go through.');
    } finally {
      setBusy(false);
      onChanged();
    }
  }

  return (
    <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
      <View style={styles.header}>
        <ThemedText type="smallBold">AI customer call</ThemedText>
        <ThemedText type="caption" themeColor="textSecondary">
          Your agent asks questions, records the conversation, and creates a call report.
        </ThemedText>
      </View>

      <View style={styles.field}>
        <ThemedText type="caption" themeColor="textSecondary">
          PHONE NUMBER
        </ThemedText>
        <TextField
          value={phone}
          onChangeText={setPhone}
          keyboardType="phone-pad"
          placeholder="+919876543210"
          editable={!live}
        />
        {phone.trim() && !validNumber ? (
          <ThemedText type="caption" themeColor="textSecondary">
            Start with + and the country code, like +91.
          </ThemedText>
        ) : null}
      </View>

      <View style={styles.field}>
        <ThemedText type="caption" themeColor="textSecondary">
          WHAT IT IS SELLING
        </ThemedText>
        <TextField
          value={pitch}
          onChangeText={(text) => {
            pitchTouched.current = true;
            setPitch(text);
          }}
          multiline
          autoCapitalize="sentences"
          autoCorrect
          editable={!live}
          placeholder="What you sell, who it is for, and the next step you want. E.g. We build websites for salons and want to book a 15-minute demo."
          style={styles.pitchInput}
        />
      </View>

      <View style={styles.field}>
        <ThemedText type="caption" themeColor="textSecondary">QUESTIONS TO ASK</ThemedText>
        <TextField value={questions} onChangeText={setQuestions} multiline editable={!live && !busy}
          placeholder={'One question per line, for example:\nWhat problem are you trying to solve?\nWhat is your budget?\nWhen would you like to get started?'}
          style={styles.pitchInput} />
        <ThemedText type="caption" themeColor="textSecondary">{questionList.length}/12 questions · Leave blank for a general sales conversation.</ThemedText>
        {!validQuestions ? <ThemedText type="caption" style={{ color: AccentColors.error }}>Use up to 12 questions, each under 300 characters.</ThemedText> : null}
      </View>
      <View style={[styles.terms, { backgroundColor: theme.surfaceRaised }]}>
        <ThemedText type="caption" themeColor="textSecondary">The agent discloses recording at the start of the call.</ThemedText>
        {CALL_TERMS.map((term) => (
          <ThemedText key={term} type="caption" themeColor="textSecondary">
            • {term}
          </ThemedText>
        ))}
      </View>

      <ConfirmCheck
        checked={confirmed}
        onToggle={() => setConfirmed((value) => !value)}
        label="I have permission to make and record this AI call."
      />

      {inWindow ? null : (
        <ThemedText type="caption" themeColor="textSecondary">
          {callingWindowNote()}
        </ThemedText>
      )}

      <PrimaryButton
        title={busy ? 'Starting…' : live ? 'Call in progress' : 'Call now'}
        onPress={start}
        disabled={busy || live || !validNumber || !pitch.trim() || !validQuestions || !confirmed || !inWindow}
      />

      {call ? <CallProgress call={call} /> : null}
      {prospectId && (call?.state === 'done' || call?.state === 'failed') ? <SalesCallReport key={prospectId} prospectId={prospectId} /> : null}
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
  const [callSheetOpen, setCallSheetOpen] = useState(false);
  const [reportId, setReportId] = useState<string | null>(null);

  const [dashboard, setDashboard] = useState<SalesDashboard | null>(null);
  const [rows, setRows] = useState<SheetRow[]>([]);
  const [lastPitch, setLastPitch] = useState('');
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const [summary, recent, pitch] = await Promise.all([
      loadSalesDashboard().catch(() => null),
      loadRecentCalls().catch(() => []),
      loadLastPitch().catch(() => null),
    ]);
    setDashboard(summary);
    setRows(toSheetRows(recent));
    setLastPitch(pitch ?? '');
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
        onPress={() => setCallSheetOpen(true)}
        style={({ hovered, pressed }) => [
          styles.callAction,
          {
            borderColor: hovered || pressed ? AccentColors.primary : theme.border,
            backgroundColor: hovered || pressed ? theme.surfaceRaised : theme.surface,
          },
        ]}
      >
        <ThemedText type="smallBold">Start AI customer call</ThemedText>
        <ThemedText type="caption" themeColor="textSecondary">
          Ask questions → Record the call → Get an AI report
        </ThemedText>
      </Pressable>

      {loading ? (
        <ActivityIndicator color={AccentColors.primary} />
      ) : (
        <>
          <View style={styles.tiles}>
            <StatTile label="Calls started" value={String(dashboard?.businessesFound ?? 0)} />
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
            <CallSheet rows={rows} onReport={setReportId} />
          ) : (
            <View
              style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}
            >
              <ThemedText type="smallBold">No calls yet</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                Use Call a number above to start an AI call; the result will show up here.
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
      <ModalSheet
        visible={callSheetOpen}
        onClose={() => setCallSheetOpen(false)}
        title="AI customer call"
        description="Set the offer and questions for your sales agent."
      >
        <ScrollView style={{ maxHeight: 560 }}>
        <CallNumberCard
          lastPitch={lastPitch}
          onChanged={() => {
            refresh();
            setCallSheetOpen(false);
          }}
        />
        </ScrollView>
      </ModalSheet>
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
    alignSelf: 'flex-start',
    minWidth: 210,
    gap: Spacing.one,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderWidth: 1,
    borderRadius: Radius.control,
  },
  field: { gap: Spacing.one + 2 },

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
