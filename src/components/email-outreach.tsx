import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  useWindowDimensions,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import {
  DonutChart,
  ActivityLineChart,
  SERIES_COLORS,
} from '@/components/charts';
import { ModalSheet } from '@/components/modal-sheet';
import { PrimaryButton } from '@/components/primary-button';
import { TextField } from '@/components/text-field';
import { ThemedText } from '@/components/themed-text';
import { AccentColors } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useSession } from '@/hooks/use-session';
import {
  campaignAction,
  campaignDetail,
  connectGmail,
  createCampaign,
  disconnectGmail,
  draftEmail,
  exportCampaignCsv,
  gmailStatus,
  listCampaigns,
  outreachStats,
  parseBulkRecipients,
  suggestEmailQuestions,
  type GmailStatus,
  type OutreachCampaign,
  type OutreachMessage,
  type OutreachRecipient,
  type RecipientInput,
} from '@/lib/outreach';

function Action({
  label,
  onPress,
  disabled = false,
  active = false,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  active?: boolean;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled, selected: active }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.action,
        {
          borderColor: active ? AccentColors.primary : theme.border,
          backgroundColor: active
            ? 'rgba(232,197,71,0.09)'
            : theme.surfaceRaised,
          opacity: disabled ? 0.4 : pressed ? 0.7 : 1,
        },
      ]}
    >
      <ThemedText
        type="caption"
        style={{ color: active ? AccentColors.primary : theme.text }}
      >
        {label}
      </ThemedText>
    </Pressable>
  );
}
function Card({
  children,
  style,
  nativeID,
}: {
  children: ReactNode;
  style?: object;
  nativeID?: string;
}) {
  const theme = useTheme();
  return (
    <View
      nativeID={nativeID}
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
function Label({ children }: { children: string }) {
  return <ThemedText type="smallBold">{children}</ThemedText>;
}
function Muted({ children }: { children: ReactNode }) {
  return (
    <ThemedText type="caption" themeColor="textSecondary">
      {children}
    </ThemedText>
  );
}
function Bars({
  rows,
  empty,
}: {
  rows: { label: string; count: number }[];
  empty: string;
}) {
  const theme = useTheme();
  const max = Math.max(1, ...rows.map((r) => r.count));
  if (!rows.length || !rows.some((r) => r.count)) return <Muted>{empty}</Muted>;
  return (
    <View style={{ gap: 14 }}>
      {rows.map((r, i) => (
        <View key={`${i}:${r.label}`} style={{ gap: 6 }}>
          <View style={styles.between}>
            <ThemedText type="caption">{r.label}</ThemedText>
            <ThemedText type="caption">{r.count}</ThemedText>
          </View>
          <View
            style={{
              height: 7,
              borderRadius: 8,
              backgroundColor: theme.backgroundElement,
            }}
          >
            <View
              style={{
                width: `${(r.count / max) * 100}%`,
                height: 7,
                borderRadius: 8,
                backgroundColor: SERIES_COLORS[i % SERIES_COLORS.length],
              }}
            />
          </View>
        </View>
      ))}
    </View>
  );
}
const dateLabel = (value: string | null) =>
  value ? new Date(value).toLocaleString() : 'Not yet';
const statusLabel: Record<string, string> = {
  draft: 'Draft',
  active: 'In progress',
  paused: 'Paused',
  completed: 'Everyone replied',
  queued: 'Queued',
  sending: 'Confirming send',
  sent: 'Awaiting reply',
  replied: 'Replied',
  failed: 'Failed',
  uncertain: 'Check Gmail Sent',
};
const blankRecipient = (): RecipientInput => ({ email: '', name: '' });

export function EmailOutreach({
  onCreateDeal,
}: {
  onCreateDeal?: (
    recipient: OutreachRecipient,
    campaign: OutreachCampaign,
  ) => void;
} = {}) {
  const theme = useTheme();
  const { width } = useWindowDimensions();
  const params = useLocalSearchParams<{ gmail?: string; compose?: string }>();
  const [composerStep, setComposerStep] = useState(0);
  const composerVisible = params.compose === '1';
  const openComposer = () => {
    setComposerStep(0);
    router.setParams({ compose: '1', ai: '0' });
  };
  const closeComposer = () => router.setParams({ compose: '0', view: 'email' });
  const [campaigns, setCampaigns] = useState<OutreachCampaign[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [recipients, setRecipients] = useState<OutreachRecipient[]>([]);
  const [messages, setMessages] = useState<OutreachMessage[]>([]);
  const [mailbox, setMailbox] = useState<GmailStatus | null>(null);
  const [error, setError] = useState(
    params.gmail === 'failed'
      ? 'Gmail was not connected. Confirm read and send permissions and try again.'
      : '',
  );
  const [notice, setNotice] = useState(
    params.gmail === 'connected'
      ? 'Gmail connected. Review a draft before sending.'
      : '',
  );
  const [busy, setBusy] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [openedRecipient, setOpenedRecipient] = useState<string | null>(null);
  const [review, setReview] = useState(false);
  const [approved, setApproved] = useState(false);
  const [bulk, setBulk] = useState(false);
  const [bulkText, setBulkText] = useState('');
  const [people, setPeople] = useState<RecipientInput[]>([blankRecipient()]);
  const [title, setTitle] = useState('');
  const [goal, setGoal] = useState('');
  const [questions, setQuestions] = useState('');
  const [instructions, setInstructions] = useState('');
  const [tone, setTone] = useState('friendly');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const selectedRef = useRef<string | null>(null);
  const selectionVersion = useRef(0);
  const selected = campaigns.find((c) => c.id === selectedId) || null;
  const { session } = useSession();
  const canManage = selected?.user_id === session?.user.id;
  const stats = outreachStats(recipients, messages);
  const questionList = questions
    .split('\n')
    .map((q) => q.trim())
    .filter(Boolean);
  const refresh = useCallback(async () => {
    const rows = await listCampaigns();
    setCampaigns(rows);
    const id = selectedRef.current || rows[0]?.id || null;
    if (!selectedRef.current && id) {
      selectedRef.current = id;
      setSelectedId(id);
    }
    if (id) {
      const version = selectionVersion.current;
      const detail = await campaignDetail(id);
      if (selectedRef.current === id && version === selectionVersion.current) {
        setRecipients(detail.recipients);
        setMessages(detail.messages);
      }
    }
    setLoaded(true);
  }, []);
  useEffect(() => {
    let live = true;
    Promise.all([
      Promise.resolve().then(refresh),
      gmailStatus().then((v) => {
        if (live) setMailbox(v);
      }),
    ]).catch((e) => {
      if (live) {
        setError(e.message);
        setLoaded(true);
      }
    });
    const timer = setInterval(() => refresh().catch(() => {}), 15000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [refresh]);
  async function choose(id: string) {
    selectionVersion.current++;
    selectedRef.current = id;
    setSelectedId(id);
    setRecipients([]);
    setMessages([]);
    setOpenedRecipient(null);
    setFilter('all');
    setError('');
    const version = selectionVersion.current;
    try {
      const detail = await campaignDetail(id);
      if (version === selectionVersion.current) {
        setRecipients(detail.recipients);
        setMessages(detail.messages);
      }
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function run(key: string, work: () => Promise<void>) {
    if (busy) return;
    setBusy(key);
    setError('');
    setNotice('');
    try {
      await work();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy('');
    }
  }
  async function connect() {
    if (Platform.OS !== 'web') {
      setError('Connect Gmail from the web app first.');
      return;
    }
    await run('connect', async () => {
      const { url } = await connectGmail(window.location.origin);
      window.location.assign(url);
    });
  }
  async function saveDraft() {
    await run('save', async () => {
      const entries = people.filter((p) => p.email.trim());
      if (!entries.length) throw new Error('Add at least one recipient.');
      const { id } = await createCampaign({
        title,
        goal,
        questions: questionList,
        subject,
        body,
        recipients: entries,
      });
      selectedRef.current = id;
      setSelectedId(id);
      selectionVersion.current++;
      await refresh();
      setApproved(false);
      closeComposer();
      setReview(true);
    });
  }
  async function act(action: 'send' | 'pause' | 'sync' | 'report') {
    if (!selected || (action !== 'report' && !canManage)) return;
    const id = selected.id;
    await run(action, async () => {
      await campaignAction(id, action);
      if (action === 'send') {
        setReview(false);
        setApproved(false);
        setNotice('Sending approved. Each person receives a separate email.');
        await campaignAction(id, 'sync');
      }
      if (action === 'report')
        setNotice(
          'Report generated from saved replies, including people still awaiting a response.',
        );
      if (action === 'pause')
        setNotice(
          'Campaign paused. An email already being sent may still finish.',
        );
      await refresh();
    });
  }
  function exportCsv() {
    if (!selected) return;
    if (Platform.OS !== 'web') {
      setError('CSV download is available in the web app.');
      return;
    }
    const url = URL.createObjectURL(
      new Blob(['\uFEFF' + exportCampaignCsv(selected, recipients)], {
        type: 'text/csv;charset=utf-8',
      }),
    );
    const link = document.createElement('a');
    link.href = url;
    link.download = `${selected.title.replace(/[^a-z0-9-]/gi, '_')}-responses.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const namedCount = people.filter((p) => p.email.trim()).length;
  const analyzed = recipients.filter((r) => r.analysis);
  const sentiment = ['positive', 'neutral', 'negative', 'mixed'].map(
    (label) => ({
      label: label.charAt(0).toUpperCase() + label.slice(1),
      count: analyzed.filter((r) => r.analysis?.sentiment === label).length,
    }),
  );
  const themeCounts = new Map<string, number>();
  for (const r of analyzed)
    for (const t of r.analysis?.themes || [])
      themeCounts.set(t, (themeCounts.get(t) || 0) + 1);
  const themeRows = [...themeCounts]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 6);
  const chartDays = Array.from({ length: 7 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - 6 + i);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    return {
      key,
      label: d.toLocaleDateString(undefined, { weekday: 'short' }),
      count: messages.filter(
        (m) =>
          !m.is_auto_reply &&
          new Date(m.received_at).toLocaleDateString() ===
            d.toLocaleDateString(),
      ).length,
    };
  });
  const filtered = recipients.filter(
    (r) =>
      (filter === 'all' || r.status === filter) &&
      (r.email + ' ' + r.name).toLowerCase().includes(search.toLowerCase()),
  );
  const expanded = recipients.find((r) => r.id === openedRecipient);

  const composer = (
    <Card
      nativeID="email-duty-form"
      style={[
        styles.composer,
        { width: '100%', maxWidth: 1040, alignSelf: 'center' },
      ]}
    >
      <View style={styles.between}>
        <View style={{ gap: 4 }}>
          <ThemedText type="sectionTitle">Start an email duty</ThemedText>
          <Muted>One brief. Individual conversations.</Muted>
        </View>
        <ThemedText style={{ fontSize: 25, color: AccentColors.primary }}>
          ✉
        </ThemedText>
      </View>
      {composerStep === 0 && (
        <>
          <View
            style={[
              styles.connection,
              {
                borderColor: theme.border,
                backgroundColor: theme.backgroundElement,
              },
            ]}
          >
            <ThemedText type="smallBold">
              {mailbox?.connected ? 'Gmail connected' : 'Connect your Gmail'}
            </ThemedText>
            <Muted>
              {mailbox?.email ||
                'Send from your account and collect replies here.'}
            </Muted>
            {mailbox?.connected ? (
              <Action
                label="Disconnect Gmail"
                disabled={!!busy}
                onPress={() =>
                  run('disconnect', async () => {
                    await disconnectGmail();
                    setMailbox(await gmailStatus());
                    await refresh();
                  })
                }
              />
            ) : (
              <Action
                label={busy === 'connect' ? 'Connecting…' : 'Connect Gmail →'}
                disabled={!!busy}
                onPress={connect}
              />
            )}
            {mailbox && !mailbox.configured && (
              <Muted>
                Google connection setup is required. You can still write and
                save drafts.
              </Muted>
            )}
          </View>
          <Label>Campaign name</Label>
          <TextField
            accessibilityLabel="Campaign name"
            placeholder="e.g. October customer feedback"
            value={title}
            onChangeText={setTitle}
            maxLength={120}
          />
          <View style={styles.between}>
            <Label>Who should receive it?</Label>
            <Action
              label="Add multiple recipients"
              onPress={() => setBulk(true)}
            />
          </View>
          {people.slice(0, 1).map((p, i) => (
            <View key={i} style={{ gap: 8 }}>
              <TextField
                accessibilityLabel={`Recipient ${i + 1} email`}
                placeholder="Email address"
                keyboardType="email-address"
                value={p.email}
                onChangeText={(email) =>
                  setPeople((prev) =>
                    prev.map((v, j) => (j === i ? { ...v, email } : v)),
                  )
                }
              />
              <TextField
                accessibilityLabel={`Recipient ${i + 1} name`}
                placeholder="Name (optional)"
                value={p.name}
                maxLength={100}
                onChangeText={(name) =>
                  setPeople((prev) =>
                    prev.map((v, j) => (j === i ? { ...v, name } : v)),
                  )
                }
              />
            </View>
          ))}
          {people.length > 1 && (
            <Action
              label={`View all ${people.length} recipients`}
              onPress={() => setBulk(true)}
            />
          )}
          <Muted>
            {namedCount} recipient{namedCount === 1 ? '' : 's'} · Sent
            individually · Up to 50 per duty
          </Muted>
        </>
      )}
      {composerStep === 1 && (
        <>
          <Label>What do you want to learn or achieve?</Label>
          <TextField
            accessibilityLabel="Campaign goal"
            placeholder="Your business, the purpose of this email, and what you need to learn…"
            value={goal}
            onChangeText={setGoal}
            multiline
            maxLength={2000}
            style={styles.textarea}
          />
          <View style={styles.between}>
            <Label>Questions to ask (optional)</Label>
            <Action
              label={
                busy === 'questions'
                  ? 'Thinking…'
                  : 'Suggest with AI · 1 credit'
              }
              disabled={!!busy || !goal.trim()}
              onPress={() =>
                run('questions', async () => {
                  const result = await suggestEmailQuestions(goal);
                  setQuestions(result.questions.join('\n'));
                })
              }
            />
          </View>
          <TextField
            accessibilityLabel="Questions, one per line"
            placeholder={
              'What is your biggest challenge?\nWhat would make this useful for you?'
            }
            value={questions}
            onChangeText={setQuestions}
            multiline
            style={styles.textarea}
          />
          <Muted>One per line · {questionList.length}/12 questions</Muted>
          <Label>Anything else to include?</Label>
          <TextField
            accessibilityLabel="Email instructions"
            placeholder="Your offer, context, details, or preferred call to action…"
            value={instructions}
            onChangeText={setInstructions}
            multiline
            maxLength={2000}
          />
          <View style={styles.wrap}>
            {['friendly', 'professional', 'concise'].map((t) => (
              <Action
                key={t}
                label={t.charAt(0).toUpperCase() + t.slice(1)}
                active={tone === t}
                onPress={() => setTone(t)}
              />
            ))}
          </View>
          <PrimaryButton
            title={
              busy === 'draft'
                ? 'Writing your email…'
                : '✦ Draft with AI · 1 credit'
            }
            disabled={!!busy || !goal.trim()}
            onPress={() =>
              run('draft', async () => {
                const result = await draftEmail({
                  goal,
                  questions: questionList,
                  tone,
                  instructions,
                });
                setSubject(result.subject);
                setBody(result.body);
                setNotice('AI draft ready. Edit it before saving.');
                setComposerStep(2);
              })
            }
          />
          <Muted>AI writes an editable draft. You choose when to send.</Muted>
        </>
      )}
      {composerStep === 2 && (
        <>
          <Label>Subject</Label>
          <TextField
            accessibilityLabel="Email subject"
            placeholder="Your email subject"
            value={subject}
            onChangeText={setSubject}
            maxLength={200}
          />
          <Label>Email draft</Label>
          <TextField
            accessibilityLabel="Email body"
            placeholder={
              'Hello {{name}},\n\nWrite your email here, or use Draft with AI above.'
            }
            value={body}
            onChangeText={setBody}
            multiline
            style={{ minHeight: 220, textAlignVertical: 'top' }}
            maxLength={12000}
          />
          <Muted>
            {
              'Use {{name}} for a recipient’s name; it becomes “there” if none is given.'
            }
          </Muted>
          <PrimaryButton
            title="Save & review email"
            loading={busy === 'save'}
            disabled={
              !!busy ||
              !title.trim() ||
              !goal.trim() ||
              !subject.trim() ||
              !body.trim() ||
              !namedCount ||
              questionList.length > 12
            }
            onPress={saveDraft}
          />
          <Muted>
            Saving sends nothing. AI suggestions, drafting, and each new reply
            analysis use 1 credit each. Reports and graphs use saved data.
          </Muted>
        </>
      )}
    </Card>
  );

  const dashboard = (
    <View nativeID="email-outreach-dashboard" style={styles.main}>
      <View style={styles.stats}>
        {[
          {
            label: 'EMAILS SENT',
            value: stats.sent,
            hint: 'Accepted by Gmail',
          },
          {
            label: 'PEOPLE REPLIED',
            value: stats.replied,
            hint: `${stats.received} reply messages`,
          },
          {
            label: 'AWAITING REPLY',
            value: stats.waiting,
            hint: `${stats.queued} still queued`,
          },
          {
            label: 'RESPONSE RATE',
            value: `${stats.responseRate}%`,
            hint: 'Respondents ÷ sent emails',
          },
        ].map((s) => (
          <Card key={s.label} style={styles.stat}>
            <Muted>{s.label}</Muted>
            <ThemedText type="metric" style={{ fontSize: 32 }}>
              {s.value}
            </ThemedText>
            <Muted>{s.hint}</Muted>
          </Card>
        ))}
      </View>
      <View style={styles.between}>
        <View style={{ gap: 4 }}>
          <ThemedText type="sectionTitle">Previous duties</ThemedText>
          <Muted>Campaign history, saved conversations, and results.</Muted>
        </View>
        <Action
          label="+ New duty"
          onPress={() => {
            setTitle('');
            setGoal('');
            setQuestions('');
            setInstructions('');
            setSubject('');
            setBody('');
            setPeople([blankRecipient()]);
            openComposer();
          }}
        />
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: 10, paddingBottom: 4 }}
      >
        {campaigns.map((c) => (
          <Pressable
            key={c.id}
            accessibilityRole="button"
            accessibilityState={{ selected: c.id === selectedId }}
            onPress={() => choose(c.id)}
            style={[
              styles.campaign,
              {
                backgroundColor: theme.surface,
                borderColor:
                  c.id === selectedId ? AccentColors.primary : theme.border,
              },
            ]}
          >
            <Muted>{statusLabel[c.status]}</Muted>
            <ThemedText type="smallBold" numberOfLines={1}>
              {c.title}
            </ThemedText>
            <Muted>{new Date(c.created_at).toLocaleDateString()}</Muted>
          </Pressable>
        ))}
      </ScrollView>
      {!campaigns.length && (
        <Card>
          <ThemedText type="sectionTitle">
            Ready for your first email duty?
          </ThemedText>
          <Muted>
            Open Email duty beside AI mode to add recipients and write your
            message. This page keeps previous duties, replies, graphs, and
            reports together once there is activity.
          </Muted>
          <View style={styles.wrap}>
            <Action
              label="+ Create an email duty"
              active
              onPress={openComposer}
            />
          </View>
        </Card>
      )}
      {selected && (
        <>
          <Card>
            <ThemedText type="sectionTitle">{selected.title}</ThemedText>
            <Muted>{selected.goal}</Muted>
            <Muted>
              {statusLabel[selected.status]} ·{' '}
              {selected.sender_email || 'Not sent yet'}
            </Muted>
            {!canManage && (
              <Muted>
                Shared company duty. The original sender manages Gmail sending
                and sync.
              </Muted>
            )}
            <View style={styles.wrap}>
              {canManage && ['draft', 'paused'].includes(selected.status) && (
                <Action
                  label={
                    selected.status === 'paused'
                      ? 'Review & resume'
                      : 'Review & send'
                  }
                  disabled={!!busy}
                  active
                  onPress={() => {
                    setApproved(false);
                    setReview(true);
                  }}
                />
              )}
              {canManage && selected.status === 'active' && (
                <Action
                  label="Pause sending & sync"
                  disabled={!!busy}
                  onPress={() => act('pause')}
                />
              )}
              {canManage &&
                ['active', 'completed'].includes(selected.status) && (
                  <Action
                    label={busy === 'sync' ? 'Checking Gmail…' : 'Sync replies'}
                    disabled={!!busy}
                    onPress={() => act('sync')}
                  />
                )}
              <Action
                label={busy === 'report' ? 'Generating…' : 'Generate report'}
                disabled={!!busy}
                active
                onPress={() => act('report')}
              />
              <Action
                label="Export CSV"
                disabled={!recipients.length}
                onPress={exportCsv}
              />
            </View>
            <Muted>
              Last checked: {dateLabel(selected.last_synced_at)}. A report is
              generated when everyone replies. Sent means accepted by Gmail, not
              delivery or opens.
            </Muted>
            {selected.sync_error && (
              <ThemedText type="caption" style={{ color: '#ef9d91' }}>
                {selected.sync_error}
              </ThemedText>
            )}
            {stats.failed > 0 && (
              <Muted>
                {stats.failed} email(s) failed. See the recipients below.
              </Muted>
            )}
          </Card>
          <View
            style={[
              styles.chartRow,
              { flexDirection: width > 900 ? 'row' : 'column' },
            ]}
          >
            <Card style={{ flex: 1, minWidth: 0 }}>
              <Label>How the duty is going</Label>
              <View style={[styles.wrap, { gap: 24 }]}>
                <DonutChart
                  segments={[
                    { label: 'Replied', count: stats.replied },
                    { label: 'Awaiting', count: stats.waiting },
                    { label: 'Queued', count: stats.queued },
                    { label: 'Failed', count: stats.failed },
                    {
                      label: 'Check send',
                      count: recipients.filter((r) =>
                        ['sending', 'uncertain'].includes(r.status),
                      ).length,
                    },
                  ]}
                  centerLabel={`${stats.replied}/${stats.total}`}
                  size={140}
                />
                <View style={{ gap: 10, flex: 1 }}>
                  {[
                    { label: 'Replied', count: stats.replied },
                    { label: 'Awaiting reply', count: stats.waiting },
                    { label: 'Queued / not sent', count: stats.queued },
                    { label: 'Failed', count: stats.failed },
                  ].map((r, i) => (
                    <View key={r.label} style={styles.between}>
                      <View style={styles.wrap}>
                        <View
                          style={{
                            height: 8,
                            width: 8,
                            borderRadius: 4,
                            backgroundColor: SERIES_COLORS[i],
                          }}
                        />
                        <Muted>{r.label}</Muted>
                      </View>
                      <ThemedText type="smallBold">{r.count}</ThemedText>
                    </View>
                  ))}
                </View>
              </View>
            </Card>
            <Card style={{ flex: 1, minWidth: 0 }}>
              <Label>Replies over the last 7 days</Label>
              {messages.some((m) => !m.is_auto_reply) ? (
                <ActivityLineChart
                  days={chartDays}
                  height={170}
                  unit="replies"
                />
              ) : (
                <View style={{ minHeight: 160, justifyContent: 'center' }}>
                  <Muted>
                    No replies yet. This graph fills with real reply activity.
                  </Muted>
                </View>
              )}
            </Card>
          </View>
          <View
            style={[
              styles.chartRow,
              { flexDirection: width > 900 ? 'row' : 'column' },
            ]}
          >
            <Card style={{ flex: 1 }}>
              <Label>Common response themes</Label>
              <Muted>
                People mentioning each topic; one person can mention several.
              </Muted>
              <Bars
                rows={themeRows}
                empty="Topics appear after reply analysis."
              />
            </Card>
            <Card style={{ flex: 1 }}>
              <Label>Reply sentiment</Label>
              <Muted>AI interpretation of {analyzed.length} respondents.</Muted>
              <Bars rows={sentiment} empty="No replies analyzed yet." />
            </Card>
          </View>
          {selected.report && (
            <Card>
              <View style={styles.between}>
                <ThemedText type="sectionTitle">Duty report</ThemedText>
                <Muted>{dateLabel(selected.report_at)}</Muted>
              </View>
              <ThemedText type="small">
                {selected.report.replied} of {selected.report.sent} contacted
                people replied ({selected.report.response_rate}%).{' '}
                {selected.report.waiting} await a reply.{' '}
                {selected.report.received} reply messages are saved.
              </ThemedText>
              <Muted>
                {selected.report.analyzed} respondents analyzed. Questions
                without an answer stay unanswered. This report uses saved
                replies as of its timestamp.
              </Muted>
              <Label>Question coverage</Label>
              <Bars
                rows={selected.report.questions.map((q) => ({
                  label: q.question,
                  count: q.answered,
                }))}
                empty="No questions answered in analyzed replies yet."
              />
              {selected.report.next_steps.length > 0 && (
                <>
                  <Label>What to do next</Label>
                  {selected.report.next_steps.map((n) => (
                    <View
                      key={n.email}
                      style={[styles.replyBlock, { borderColor: theme.border }]}
                    >
                      <ThemedText type="smallBold">
                        {n.name || n.email}
                      </ThemedText>
                      <Muted>{n.summary}</Muted>
                      <ThemedText type="small">
                        {n.opted_out ? 'Do not email again.' : n.next_step}
                      </ThemedText>
                    </View>
                  ))}
                </>
              )}
            </Card>
          )}
          <Card>
            <View style={styles.between}>
              <ThemedText type="sectionTitle">Recipients & replies</ThemedText>
              <Muted>{stats.total} people</Muted>
            </View>
            <View style={styles.wrap}>
              {[
                { key: 'all', label: 'All' },
                { key: 'replied', label: 'Replied' },
                { key: 'sent', label: 'Awaiting reply' },
                { key: 'queued', label: 'Queued' },
                { key: 'failed', label: 'Failed' },
                { key: 'uncertain', label: 'Check send' },
              ].map((f) => (
                <Action
                  key={f.key}
                  label={f.label}
                  active={filter === f.key}
                  onPress={() => setFilter(f.key)}
                />
              ))}
            </View>
            <TextField
              accessibilityLabel="Search recipients"
              placeholder="Search by email or name"
              value={search}
              onChangeText={setSearch}
            />
            {!filtered.length && <Muted>No recipients match this view.</Muted>}
            {filtered.map((r) => (
              <Pressable
                accessibilityRole="button"
                key={r.id}
                onPress={() => setOpenedRecipient(r.id)}
                style={[styles.recipient, { borderColor: theme.border }]}
              >
                <View style={styles.between}>
                  <View style={{ flex: 1, gap: 3 }}>
                    <ThemedText type="smallBold">
                      {r.name || r.email}
                    </ThemedText>
                    {!!r.name && <Muted>{r.email}</Muted>}
                  </View>
                  <ThemedText
                    type="caption"
                    style={{
                      color:
                        r.status === 'replied'
                          ? AccentColors.primary
                          : theme.textSecondary,
                    }}
                  >
                    {statusLabel[r.status]}
                  </ThemedText>
                </View>
                <Muted>
                  {r.analysis?.summary ||
                    r.error ||
                    (r.status === 'replied'
                      ? 'Reply saved. Analysis pending.'
                      : r.status === 'sent'
                        ? 'Waiting for a response.'
                        : 'No email sent yet.')}
                </Muted>
                {r.analysis_error && (
                  <ThemedText type="caption" style={{ color: '#ef9d91' }}>
                    {r.analysis_error}
                  </ThemedText>
                )}
              </Pressable>
            ))}
          </Card>
        </>
      )}
    </View>
  );

  return (
    <ScrollView contentContainerStyle={styles.page}>
      <View style={{ gap: 8 }}>
        <ThemedText type="pageTitle">Email duties</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          Send thoughtful emails. Understand every reply.
        </ThemedText>
      </View>
      {!!error && (
        <View
          accessibilityRole="alert"
          style={[
            styles.banner,
            { borderColor: '#a55447', backgroundColor: 'rgba(170,70,60,0.09)' },
          ]}
        >
          <ThemedText type="small">{error}</ThemedText>
        </View>
      )}
      {!!notice && (
        <View
          accessibilityLiveRegion="polite"
          style={[styles.banner, { borderColor: theme.border }]}
        >
          <ThemedText type="small">{notice}</ThemedText>
        </View>
      )}
      {!loaded && <Muted>Loading your email workspace…</Muted>}
      {dashboard}
      <Modal
        visible={composerVisible}
        animationType="slide"
        onRequestClose={closeComposer}
      >
        <View style={{ flex: 1, backgroundColor: theme.background }}>
          <View
            style={[
              styles.workspaceHeader,
              { borderBottomColor: theme.border },
            ]}
          >
            <View style={{ gap: 5, flex: 1 }}>
              <ThemedText type="pageTitle">Email duty</ThemedText>
              <Muted>
                A dedicated space to plan, write, and review your outreach.
              </Muted>
            </View>
            <Action
              label="Close · Back to Sales"
              disabled={!!busy}
              onPress={closeComposer}
            />
          </View>
          <View style={styles.stepRow}>
            {['People', 'Your brief', 'Write & review'].map((label, index) => (
              <Action
                key={label}
                label={index + 1 + '. ' + label}
                active={composerStep === index}
                disabled={!!busy}
                onPress={() => setComposerStep(index)}
              />
            ))}
          </View>
          <ScrollView
            key={composerStep}
            contentContainerStyle={{
              padding: width < 600 ? 16 : 28,
              paddingTop: 8,
              paddingBottom: 24,
            }}
            style={{ flex: 1 }}
            keyboardShouldPersistTaps="handled"
          >
            {!!error && (
              <View
                accessibilityRole="alert"
                style={[
                  styles.banner,
                  {
                    borderColor: '#a55447',
                    maxWidth: 1040,
                    alignSelf: 'center',
                    width: '100%',
                    marginBottom: 12,
                  },
                ]}
              >
                <ThemedText type="small">{error}</ThemedText>
              </View>
            )}
            {!!notice && (
              <View
                accessibilityLiveRegion="polite"
                style={{
                  maxWidth: 1040,
                  alignSelf: 'center',
                  width: '100%',
                  marginBottom: 12,
                }}
              >
                <Muted>{notice}</Muted>
              </View>
            )}
            {composer}
          </ScrollView>
          <View
            style={[styles.workspaceFooter, { borderTopColor: theme.border }]}
          >
            <Muted>
              Step {composerStep + 1} of 3 · {namedCount} recipients · Nothing
              sends until you approve.
            </Muted>
            <View style={styles.wrap}>
              {composerStep > 0 && (
                <Action
                  label="← Back"
                  disabled={!!busy}
                  onPress={() => setComposerStep((v) => v - 1)}
                />
              )}
              {composerStep < 2 && (
                <Action
                  label={
                    composerStep === 0
                      ? 'Continue to brief →'
                      : 'Continue to email →'
                  }
                  disabled={!!busy}
                  active
                  onPress={() => setComposerStep((v) => v + 1)}
                />
              )}
            </View>
          </View>
        </View>
      </Modal>
      <ModalSheet
        visible={bulk}
        onClose={() => setBulk(false)}
        title="Add multiple recipients"
        description="Paste addresses, or add each email with an optional name."
      >
        <ScrollView
          style={{ maxHeight: 480 }}
          contentContainerStyle={{ gap: 12 }}
        >
          <TextField
            accessibilityLabel="Bulk recipient addresses"
            placeholder={'alex@gmail.com\nSam <sam@gmail.com>'}
            value={bulkText}
            onChangeText={setBulkText}
            multiline
            style={styles.textarea}
          />
          <Action
            label="Add pasted addresses"
            onPress={() => {
              try {
                const added = parseBulkRecipients(bulkText);
                const merged = new Map(
                  people
                    .filter((p) => p.email.trim())
                    .map((p) => [p.email.trim().toLowerCase(), p]),
                );
                for (const p of added)
                  if (!merged.has(p.email)) merged.set(p.email, p);
                if (merged.size > 50)
                  throw new Error('Use at most 50 unique recipients.');
                setPeople([...merged.values()]);
                setBulkText('');
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          />
          {people.map((p, i) => (
            <View
              key={i}
              style={[styles.replyBlock, { borderColor: theme.border }]}
            >
              <TextField
                accessibilityLabel={`Bulk recipient ${i + 1} email`}
                placeholder="Email address"
                value={p.email}
                keyboardType="email-address"
                onChangeText={(email) =>
                  setPeople((rows) =>
                    rows.map((v, j) => (i === j ? { ...v, email } : v)),
                  )
                }
              />
              <TextField
                accessibilityLabel={`Bulk recipient ${i + 1} optional name`}
                placeholder="Name (optional)"
                value={p.name}
                maxLength={100}
                onChangeText={(name) =>
                  setPeople((rows) =>
                    rows.map((v, j) => (i === j ? { ...v, name } : v)),
                  )
                }
              />
              <Action
                label="Remove"
                onPress={() =>
                  setPeople((rows) => rows.filter((_, j) => j !== i))
                }
              />
            </View>
          ))}
          <Action
            label="+ Add another person"
            disabled={people.length >= 50}
            onPress={() => setPeople((rows) => [...rows, blankRecipient()])}
          />
        </ScrollView>
        <PrimaryButton
          title={`Done · ${namedCount} recipients`}
          onPress={() => setBulk(false)}
        />
      </ModalSheet>
      <ModalSheet
        visible={review && !!selected}
        onClose={() => setReview(false)}
        title="Review before sending"
        description={`${recipients.length} separate emails · ${mailbox?.email || 'Connect Gmail first'}`}
      >
        <ScrollView
          style={{ maxHeight: 360 }}
          contentContainerStyle={{ gap: 14 }}
        >
          <Label>{selected?.subject || ''}</Label>
          <ThemedText type="small" selectable>
            {selected?.body.replace(
              /\{\{name\}\}/g,
              recipients[0]?.name || 'there',
            )}
          </ThemedText>
          <Muted>Recipients: {recipients.map((r) => r.email).join(', ')}</Muted>
          <Muted>
            Each person receives their own email. No CC/BCC and no automatic
            follow-up emails. Pausing cannot recall messages already sent.
          </Muted>
        </ScrollView>
        <Pressable
          accessibilityRole="checkbox"
          accessibilityState={{ checked: approved }}
          onPress={() => setApproved((v) => !v)}
          style={styles.wrap}
        >
          <ThemedText style={{ color: AccentColors.primary, fontSize: 20 }}>
            {approved ? '☑' : '☐'}
          </ThemedText>
          <ThemedText type="caption" style={{ flex: 1 }}>
            I reviewed the recipients and message and authorize sending from my
            connected Gmail.
          </ThemedText>
        </Pressable>
        <PrimaryButton
          title={
            selected?.status === 'paused'
              ? 'Resume this duty'
              : `Send to ${recipients.length} people`
          }
          disabled={!approved || !mailbox?.connected || !!busy}
          loading={busy === 'send'}
          onPress={() => act('send')}
        />
      </ModalSheet>
      <ModalSheet
        visible={!!expanded}
        onClose={() => setOpenedRecipient(null)}
        title={expanded?.name || expanded?.email || 'Reply'}
        description={
          expanded?.name ? expanded.email : 'Original replies and AI summary'
        }
      >
        <ScrollView
          style={{ maxHeight: 520 }}
          contentContainerStyle={{ gap: 16 }}
        >
          {expanded?.analysis && (
            <>
              <Label>In simple words</Label>
              <ThemedText type="small" selectable>
                {expanded.analysis.summary}
              </ThemedText>
              <Muted>
                {expanded.analysis.sentiment} ·{' '}
                {expanded.analysis.intent.replace(/_/g, ' ')}
              </Muted>
              <Label>Answers to your questions</Label>
              {expanded.analysis.answers.map((a, i) => (
                <View key={i} style={{ gap: 5 }}>
                  <ThemedText type="smallBold">{a.question}</ThemedText>
                  <ThemedText type="small" selectable>
                    {a.answer || 'Not answered'}
                  </ThemedText>
                </View>
              ))}
              <Label>Suggested next step</Label>
              <ThemedText type="small">
                {expanded.analysis.opted_out
                  ? 'Do not email again.'
                  : expanded.analysis.next_step}
              </ThemedText>
            </>
          )}
          {onCreateDeal &&
            expanded &&
            selected &&
            !expanded.analysis?.opted_out && (
              <Action
                label="Create Sales opportunity"
                onPress={() => {
                  setOpenedRecipient(null);
                  onCreateDeal(expanded, selected);
                }}
              />
            )}
          <Label>Original emails</Label>
          {messages
            .filter((m) => m.recipient_id === openedRecipient)
            .map((m) => (
              <View
                key={m.id}
                style={[styles.replyBlock, { borderColor: theme.border }]}
              >
                <Muted>
                  {dateLabel(m.received_at)}
                  {m.is_auto_reply
                    ? ' · Automatic reply (excluded from response stats)'
                    : ''}
                </Muted>
                <ThemedText type="small" selectable>
                  {m.body || '(No readable text body)'}
                </ThemedText>
              </View>
            ))}
          {!messages.some((m) => m.recipient_id === openedRecipient) && (
            <Muted>No reply has been received yet.</Muted>
          )}
          <Muted>
            AI summaries can miss nuance. The original email stays saved above.
          </Muted>
        </ScrollView>
      </ModalSheet>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: {
    padding: 28,
    gap: 24,
    width: '100%',
    maxWidth: 1660,
    alignSelf: 'center',
    paddingBottom: 80,
  },
  workspaceHeader: {
    padding: 24,
    paddingTop: 32,
    borderBottomWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    flexWrap: 'wrap',
  },
  stepRow: {
    flexDirection: 'row',
    gap: 10,
    padding: 20,
    justifyContent: 'center',
    flexWrap: 'wrap',
  },
  workspaceFooter: {
    padding: 18,
    borderTopWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    flexWrap: 'wrap',
  },
  main: { flex: 1, gap: 22, minWidth: 0, width: '100%' },
  composer: { gap: 14, flexShrink: 0 },
  card: { borderWidth: 1, borderRadius: 18, padding: 22, gap: 16 },
  stats: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  stat: { flex: 1, minWidth: 145, gap: 10, padding: 18 },
  between: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    flexWrap: 'wrap',
  },
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
  },
  action: {
    borderWidth: 1,
    borderRadius: 9,
    paddingVertical: 9,
    paddingHorizontal: 12,
  },
  connection: { gap: 10, padding: 16, borderWidth: 1, borderRadius: 12 },
  textarea: { minHeight: 110, textAlignVertical: 'top' },
  campaign: {
    width: 205,
    gap: 8,
    padding: 16,
    borderWidth: 1,
    borderRadius: 12,
  },
  chartRow: { gap: 16 },
  recipient: { paddingVertical: 16, gap: 8, borderTopWidth: 1 },
  replyBlock: { padding: 14, borderWidth: 1, borderRadius: 10, gap: 10 },
  banner: { padding: 16, borderRadius: 12, borderWidth: 1 },
});
