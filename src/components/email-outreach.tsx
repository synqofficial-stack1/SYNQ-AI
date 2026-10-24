import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Modal, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useLayoutWidth } from '@/components/phone-frame';
import { router, useLocalSearchParams } from 'expo-router';

import { ActivityLineChart, DonutChart, SERIES_COLORS } from '@/components/charts';
import { PlatformMark } from '@/components/brand-icons';
import { CheckCircleIcon, ClockIcon, DownloadIcon, MailIcon, PlusIcon, RefreshIcon, SendIcon, SparkIcon, TrendUpIcon, UsersIcon, XIcon } from '@/components/icons';
import { ModalSheet } from '@/components/modal-sheet';
import { TextField } from '@/components/text-field';
import { ThemedText } from '@/components/themed-text';
import {
  Button,
  ButtonRow,
  Card as KitCard,
  Checkbox,
  ChoiceGroup,
  EmptyState,
  Field,
  FilterChips,
  IconButton,
  InlineAlert,
  KpiCard,
  LoadingState,
  SearchInput,
  SectionHeader,
  StatusBadge,
  Tabs,
  transition,
  type Tone,
} from '@/components/ui';
import { DataColors, PageMaxWidth, Radius } from '@/constants/theme';
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

// Email duties: one brief, many individual Gmail conversations, and a report
// built from the replies that actually came back. Nothing sends until the
// person reviews the message and ticks the authorisation box.

function Card({ children, style, nativeID }: { children: ReactNode; style?: object; nativeID?: string }) {
  return (
    <KitCard style={style} nativeID={nativeID}>
      {children}
    </KitCard>
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
function Bars({ rows, empty }: { rows: { label: string; count: number }[]; empty: string }) {
  const theme = useTheme();
  const max = Math.max(1, ...rows.map((r) => r.count));
  if (!rows.length || !rows.some((r) => r.count)) return <Muted>{empty}</Muted>;
  return (
    <View style={{ gap: 14 }}>
      {rows.map((r, i) => (
        <View key={`${i}:${r.label}`} style={{ gap: 6 }}>
          <View style={styles.between}>
            <ThemedText type="caption" style={{ flex: 1 }}>
              {r.label}
            </ThemedText>
            <ThemedText type="caption" style={{ fontWeight: '600' }}>
              {r.count}
            </ThemedText>
          </View>
          <View style={{ height: 8, borderRadius: 4, backgroundColor: theme.surfaceRaised }}>
            <View style={{ width: `${(r.count / max) * 100}%`, height: 8, borderRadius: 4, backgroundColor: SERIES_COLORS[i % SERIES_COLORS.length] }} />
          </View>
        </View>
      ))}
    </View>
  );
}
const STATUS_TONE: Record<string, Tone> = {
  draft: 'neutral',
  active: 'info',
  paused: 'warning',
  completed: 'success',
  queued: 'neutral',
  sending: 'info',
  sent: 'info',
  replied: 'success',
  failed: 'danger',
  uncertain: 'warning',
};
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
  header,
}: {
  onCreateDeal?: (recipient: OutreachRecipient, campaign: OutreachCampaign) => void;
  /** The Sales page header and tabs, drawn at the top of this page's scroll. */
  header?: ReactNode;
} = {}) {
  const theme = useTheme();
  const width = useLayoutWidth();
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
    <Card nativeID="email-duty-form" style={styles.composer}>
      <SectionHeader
        title={['Who should receive it?', 'Your brief', 'Write & review'][composerStep]}
        subtitle={['One brief. Individual conversations.', 'Tell Synq what you want to learn or achieve.', 'Edit the draft until it sounds like you.'][composerStep]}
      />
      {composerStep === 0 && (
        <>
          <View style={[styles.connection, { borderColor: theme.border, backgroundColor: theme.surfaceRaised }]}>
            <PlatformMark platform="gmail" size={40} />
            <View style={{ flex: 1, gap: 2, minWidth: 160 }}>
              <ThemedText type="smallBold">{mailbox?.connected ? 'Gmail connected' : 'Connect your Gmail'}</ThemedText>
              <Muted>{mailbox?.email || 'Send from your account and collect replies here.'}</Muted>
              {mailbox && !mailbox.configured ? <Muted>Google connection setup is required. You can still write and save drafts.</Muted> : null}
            </View>
            {mailbox?.connected ? (
              <Button
                label="Disconnect"
                size="sm"
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
              <Button label={busy === 'connect' ? 'Connecting…' : 'Connect Gmail'} size="sm" variant="primary" disabled={!!busy} onPress={connect} />
            )}
          </View>
          <Field label="Campaign name" count={{ value: title.length, max: 120 }}>
            <TextField accessibilityLabel="Campaign name" placeholder="e.g. October customer feedback" value={title} onChangeText={setTitle} maxLength={120} />
          </Field>
          <View style={styles.between}>
            <Label>Recipient</Label>
            <Button label="Add multiple recipients" size="sm" icon={UsersIcon} onPress={() => setBulk(true)} />
          </View>
          {people.slice(0, 1).map((p, i) => (
            <View key={i} style={styles.fieldPair}>
              <View style={styles.fieldCell}>
                <TextField
                  accessibilityLabel={`Recipient ${i + 1} email`}
                  placeholder="Email address"
                  keyboardType="email-address"
                  value={p.email}
                  onChangeText={(email) => setPeople((prev) => prev.map((v, j) => (j === i ? { ...v, email } : v)))}
                />
              </View>
              <View style={styles.fieldCell}>
                <TextField
                  accessibilityLabel={`Recipient ${i + 1} name`}
                  placeholder="Name (optional)"
                  value={p.name}
                  maxLength={100}
                  onChangeText={(name) => setPeople((prev) => prev.map((v, j) => (j === i ? { ...v, name } : v)))}
                />
              </View>
            </View>
          ))}
          {people.length > 1 && <Button label={`View all ${people.length} recipients`} size="sm" onPress={() => setBulk(true)} />}
          <Muted>
            {namedCount} recipient{namedCount === 1 ? '' : 's'} · Sent individually · Up to 50 per duty
          </Muted>
        </>
      )}
      {composerStep === 1 && (
        <>
          <Field label="What do you want to learn or achieve?" count={{ value: goal.length, max: 2000 }}>
            <TextField
              accessibilityLabel="Campaign goal"
              placeholder="Your business, the purpose of this email, and what you need to learn…"
              value={goal}
              onChangeText={setGoal}
              multiline
              maxLength={2000}
              style={styles.textarea}
            />
          </Field>
          <View style={styles.between}>
            <Label>Questions to ask (optional)</Label>
            <Button
              label={busy === 'questions' ? 'Thinking…' : 'Suggest with AI · 1 credit'}
              size="sm"
              icon={SparkIcon}
              disabled={!!busy || !goal.trim()}
              onPress={() =>
                run('questions', async () => {
                  const result = await suggestEmailQuestions(goal);
                  setQuestions(result.questions.join('\n'));
                })
              }
            />
          </View>
          <Field label="Questions, one per line" helper={`${questionList.length}/12 questions`}>
            <TextField
              accessibilityLabel="Questions, one per line"
              placeholder={'What is your biggest challenge?\nWhat would make this useful for you?'}
              value={questions}
              onChangeText={setQuestions}
              multiline
              style={styles.textarea}
            />
          </Field>
          <Field label="Anything else to include?" count={{ value: instructions.length, max: 2000 }}>
            <TextField
              accessibilityLabel="Email instructions"
              placeholder="Your offer, context, details, or preferred call to action…"
              value={instructions}
              onChangeText={setInstructions}
              multiline
              maxLength={2000}
            />
          </Field>
          <Field label="Tone">
            <ChoiceGroup
              label="Tone"
              value={tone}
              onChange={setTone}
              options={['friendly', 'professional', 'concise'].map((t) => ({ value: t, label: t.charAt(0).toUpperCase() + t.slice(1) }))}
            />
          </Field>
          <Button
            label={busy === 'draft' ? 'Writing your email…' : 'Draft with AI · 1 credit'}
            variant="primary"
            icon={SparkIcon}
            size="lg"
            loading={busy === 'draft'}
            disabled={!!busy || !goal.trim()}
            onPress={() =>
              run('draft', async () => {
                const result = await draftEmail({ goal, questions: questionList, tone, instructions });
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
          <Field label="Subject" count={{ value: subject.length, max: 200 }}>
            <TextField accessibilityLabel="Email subject" placeholder="Your email subject" value={subject} onChangeText={setSubject} maxLength={200} />
          </Field>
          <Field label="Email draft" helper={'Use {{name}} for a recipient’s name; it becomes “there” if none is given.'} count={{ value: body.length, max: 12000 }}>
            <TextField
              accessibilityLabel="Email body"
              placeholder={'Hello {{name}},\n\nWrite your email here, or use Draft with AI in the previous step.'}
              value={body}
              onChangeText={setBody}
              multiline
              style={{ minHeight: 240 }}
              maxLength={12000}
            />
          </Field>
          <Button
            label="Save & review email"
            variant="primary"
            size="lg"
            loading={busy === 'save'}
            disabled={!!busy || !title.trim() || !goal.trim() || !subject.trim() || !body.trim() || !namedCount || questionList.length > 12}
            onPress={saveDraft}
          />
          <Muted>Saving sends nothing. AI suggestions, drafting, and each new reply analysis use 1 credit each. Reports and graphs use saved data.</Muted>
        </>
      )}
    </Card>
  );

  const startNew = () => {
    setTitle('');
    setGoal('');
    setQuestions('');
    setInstructions('');
    setSubject('');
    setBody('');
    setPeople([blankRecipient()]);
    openComposer();
  };

  const dashboard = (
    <View nativeID="email-outreach-dashboard" style={styles.main}>
      <View style={styles.stats}>
        {[
          { label: 'Emails sent', value: stats.sent, hint: 'Accepted by Gmail', icon: SendIcon, color: DataColors.sales },
          { label: 'People replied', value: stats.replied, hint: `${stats.received} reply messages`, icon: CheckCircleIcon, color: '#16A34A' },
          { label: 'Awaiting reply', value: stats.waiting, hint: `${stats.queued} still queued`, icon: ClockIcon, color: DataColors.marketing },
          { label: 'Response rate', value: `${stats.responseRate}%`, hint: 'Respondents ÷ sent emails', icon: TrendUpIcon, color: DataColors.company },
        ].map((s) => (
          <View key={s.label} style={[styles.statCell, { flexBasis: width >= 1280 ? '22%' : width >= 620 ? '40%' : '100%' }]}>
            <KpiCard label={s.label} value={loaded ? String(s.value) : null} note={s.hint} icon={s.icon} color={s.color} />
          </View>
        ))}
      </View>
      <Card>
        <SectionHeader
          title="Email duties"
          subtitle="Send thoughtful emails. Understand every reply."
          action={<Button label="New duty" variant="primary" icon={PlusIcon} onPress={startNew} />}
        />
        {!campaigns.length ? (
          <EmptyState
            icon={MailIcon}
            title="Ready for your first email duty?"
            description="Add recipients, write your message with AI, and review it before anything is sent. Replies, graphs and reports collect here."
            action={{ label: 'Create an email duty', icon: PlusIcon, onPress: openComposer }}
          />
        ) : (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10, paddingBottom: 4 }}>
            {campaigns.map((c) => {
              const selectedNow = c.id === selectedId;
              return (
                <Pressable
                  key={c.id}
                  accessibilityRole="button"
                  accessibilityLabel={`${c.title}, ${statusLabel[c.status]}`}
                  accessibilityState={{ selected: selectedNow }}
                  onPress={() => choose(c.id)}
                  style={({ hovered }) => [
                    styles.campaign,
                    transition,
                    {
                      backgroundColor: selectedNow ? theme.accentSoft : hovered ? theme.surfaceRaised : theme.surface,
                      borderColor: selectedNow ? theme.accentHover : theme.border,
                    },
                  ]}
                >
                  <StatusBadge label={statusLabel[c.status]} tone={STATUS_TONE[c.status] ?? 'neutral'} />
                  <ThemedText type="smallBold" numberOfLines={1}>
                    {c.title}
                  </ThemedText>
                  <Muted>{new Date(c.created_at).toLocaleDateString()}</Muted>
                </Pressable>
              );
            })}
          </ScrollView>
        )}
      </Card>
      {selected && (
        <>
          <Card>
            <SectionHeader
              title={selected.title}
              subtitle={selected.goal}
              action={<StatusBadge label={statusLabel[selected.status]} tone={STATUS_TONE[selected.status] ?? 'neutral'} />}
            />
            <Muted>
              {selected.sender_email ? `Sending from ${selected.sender_email}` : 'Not sent yet'}
              {!canManage ? ' · Shared company duty. The original sender manages Gmail sending and sync.' : ''}
            </Muted>
            <ButtonRow>
              {canManage && ['draft', 'paused'].includes(selected.status) && (
                <Button
                  label={selected.status === 'paused' ? 'Review & resume' : 'Review & send'}
                  variant="primary"
                  icon={SendIcon}
                  disabled={!!busy}
                  onPress={() => {
                    setApproved(false);
                    setReview(true);
                  }}
                />
              )}
              {canManage && selected.status === 'active' && <Button label="Pause sending & sync" disabled={!!busy} onPress={() => act('pause')} />}
              {canManage && ['active', 'completed'].includes(selected.status) && (
                <Button label={busy === 'sync' ? 'Checking Gmail…' : 'Sync replies'} icon={RefreshIcon} disabled={!!busy} onPress={() => act('sync')} />
              )}
              <Button label={busy === 'report' ? 'Generating…' : 'Generate report'} disabled={!!busy} onPress={() => act('report')} />
              <Button label="Export CSV" icon={DownloadIcon} disabled={!recipients.length} onPress={exportCsv} />
            </ButtonRow>
            <Muted>
              Last checked: {dateLabel(selected.last_synced_at)}. A report is generated when everyone replies. Sent means accepted by Gmail, not delivery or opens.
            </Muted>
            {selected.sync_error ? <InlineAlert tone="warning" message={selected.sync_error} /> : null}
            {stats.failed > 0 ? <InlineAlert tone="danger" message={`${stats.failed} email(s) failed. See the recipients below.`} /> : null}
          </Card>
          <View style={[styles.chartRow, { flexDirection: width > 900 ? 'row' : 'column' }]}>
            <Card style={{ flex: 1, minWidth: 0 }}>
              <SectionHeader title="How the duty is going" size="card" />
              <View style={[styles.wrap, { gap: 24 }]}>
                <DonutChart
                  segments={[
                    { label: 'Replied', count: stats.replied },
                    { label: 'Awaiting', count: stats.waiting },
                    { label: 'Queued', count: stats.queued },
                    { label: 'Failed', count: stats.failed },
                    { label: 'Check send', count: recipients.filter((r) => ['sending', 'uncertain'].includes(r.status)).length },
                  ]}
                  centerLabel={`${stats.replied}/${stats.total}`}
                  size={140}
                />
                <View style={{ gap: 10, flex: 1, minWidth: 160 }}>
                  {[
                    { label: 'Replied', count: stats.replied },
                    { label: 'Awaiting reply', count: stats.waiting },
                    { label: 'Queued / not sent', count: stats.queued },
                    { label: 'Failed', count: stats.failed },
                  ].map((r, i) => (
                    <View key={r.label} style={styles.between}>
                      <View style={styles.wrap}>
                        <View style={{ height: 8, width: 8, borderRadius: 4, backgroundColor: SERIES_COLORS[i] }} />
                        <Muted>{r.label}</Muted>
                      </View>
                      <ThemedText type="smallBold">{r.count}</ThemedText>
                    </View>
                  ))}
                </View>
              </View>
            </Card>
            <Card style={{ flex: 1, minWidth: 0 }}>
              <SectionHeader title="Replies over the last 7 days" size="card" />
              {messages.some((m) => !m.is_auto_reply) ? (
                <ActivityLineChart days={chartDays} height={170} unit="replies" />
              ) : (
                <EmptyState title="No replies yet" description="This graph fills with real reply activity." compact />
              )}
            </Card>
          </View>
          <View style={[styles.chartRow, { flexDirection: width > 900 ? 'row' : 'column' }]}>
            <Card style={{ flex: 1 }}>
              <SectionHeader title="Common response themes" size="card" subtitle="People mentioning each topic; one person can mention several." />
              <Bars rows={themeRows} empty="Topics appear after reply analysis." />
            </Card>
            <Card style={{ flex: 1 }}>
              <SectionHeader title="Reply sentiment" size="card" subtitle={`AI interpretation of ${analyzed.length} respondents.`} />
              <Bars rows={sentiment} empty="No replies analysed yet." />
            </Card>
          </View>
          {selected.report && (
            <Card>
              <SectionHeader title="Duty report" subtitle={dateLabel(selected.report_at)} />
              <ThemedText type="small">
                {selected.report.replied} of {selected.report.sent} contacted people replied ({selected.report.response_rate}%). {selected.report.waiting} await a reply.{' '}
                {selected.report.received} reply messages are saved.
              </ThemedText>
              <Muted>
                {selected.report.analyzed} respondents analysed. Questions without an answer stay unanswered. This report uses saved replies as of its timestamp.
              </Muted>
              <Label>Question coverage</Label>
              <Bars rows={selected.report.questions.map((q) => ({ label: q.question, count: q.answered }))} empty="No questions answered in analysed replies yet." />
              {selected.report.next_steps.length > 0 && (
                <>
                  <Label>What to do next</Label>
                  {selected.report.next_steps.map((n) => (
                    <View key={n.email} style={[styles.replyBlock, { borderColor: theme.border }]}>
                      <ThemedText type="smallBold">{n.name || n.email}</ThemedText>
                      <Muted>{n.summary}</Muted>
                      <ThemedText type="small">{n.opted_out ? 'Do not email again.' : n.next_step}</ThemedText>
                    </View>
                  ))}
                </>
              )}
            </Card>
          )}
          <Card>
            <SectionHeader title="Recipients & replies" subtitle={`${stats.total} people`} />
            <FilterChips
              label="Filter recipients"
              value={filter}
              onChange={setFilter}
              items={[
                { key: 'all', label: 'All' },
                { key: 'replied', label: 'Replied' },
                { key: 'sent', label: 'Awaiting reply' },
                { key: 'queued', label: 'Queued' },
                { key: 'failed', label: 'Failed' },
                { key: 'uncertain', label: 'Check send' },
              ]}
            />
            <SearchInput accessibilityLabel="Search recipients" placeholder="Search by email or name" value={search} onChangeText={setSearch} />
            {!filtered.length && <EmptyState title="No recipients match this view" compact />}
            {filtered.map((r) => (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Open ${r.name || r.email}, ${statusLabel[r.status]}`}
                key={r.id}
                onPress={() => setOpenedRecipient(r.id)}
                style={({ hovered }) => [styles.recipient, transition, { borderColor: theme.border }, hovered && { backgroundColor: theme.surfaceRaised }]}
              >
                <View style={styles.between}>
                  <View style={{ flex: 1, gap: 3 }}>
                    <ThemedText type="smallBold">{r.name || r.email}</ThemedText>
                    {!!r.name && <Muted>{r.email}</Muted>}
                  </View>
                  <StatusBadge label={statusLabel[r.status]} tone={STATUS_TONE[r.status] ?? 'neutral'} />
                </View>
                <Muted>
                  {r.analysis?.summary ||
                    r.error ||
                    (r.status === 'replied' ? 'Reply saved. Analysis pending.' : r.status === 'sent' ? 'Waiting for a response.' : 'No email sent yet.')}
                </Muted>
                {r.analysis_error ? (
                  <ThemedText type="caption" style={{ color: theme.danger }}>
                    {r.analysis_error}
                  </ThemedText>
                ) : null}
              </Pressable>
            ))}
          </Card>
        </>
      )}
    </View>
  );

  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={[styles.page, { padding: width < 640 ? 16 : 28 }]}>
      {header}
      {!!error && <InlineAlert tone="danger" message={error} />}
      {!!notice && <InlineAlert tone="info" message={notice} />}
      {!loaded ? <LoadingState label="Loading your email workspace…" /> : null}
      {dashboard}
      <Modal visible={composerVisible} animationType="slide" onRequestClose={closeComposer}>
        <View style={{ flex: 1, backgroundColor: theme.background }}>
          <View style={[styles.workspaceHeader, { borderBottomColor: theme.border, backgroundColor: theme.surface }]}>
            <View style={{ gap: 2, flex: 1 }}>
              <ThemedText type="sectionTitle" accessibilityRole="header">
                New email duty
              </ThemedText>
              <Muted>Plan, write and review your outreach. Nothing sends until you approve.</Muted>
            </View>
            <IconButton icon={XIcon} label="Close and go back to Sales" disabled={!!busy} onPress={closeComposer} variant="outline" />
          </View>
          <View style={styles.stepRow}>
            <Tabs
              label="Email duty steps"
              value={String(composerStep) as '0' | '1' | '2'}
              onChange={(value) => {
                if (!busy) setComposerStep(Number(value));
              }}
              items={[
                { key: '0', label: '1. People' },
                { key: '1', label: '2. Your brief' },
                { key: '2', label: '3. Write & review' },
              ]}
            />
          </View>
          <ScrollView
            key={composerStep}
            contentContainerStyle={{ padding: width < 600 ? 16 : 28, paddingTop: 8, paddingBottom: 24, gap: 12 }}
            style={{ flex: 1 }}
            keyboardShouldPersistTaps="handled"
          >
            {!!error && <InlineAlert tone="danger" message={error} style={styles.composerWidth} />}
            {!!notice && <InlineAlert tone="info" message={notice} style={styles.composerWidth} />}
            {composer}
          </ScrollView>
          <View style={[styles.workspaceFooter, { borderTopColor: theme.border, backgroundColor: theme.surface }]}>
            <Muted>
              Step {composerStep + 1} of 3 · {namedCount} recipients · Nothing sends until you approve.
            </Muted>
            <ButtonRow>
              {composerStep > 0 && <Button label="Back" disabled={!!busy} onPress={() => setComposerStep((v) => v - 1)} />}
              {composerStep < 2 && (
                <Button
                  label={composerStep === 0 ? 'Continue to brief' : 'Continue to email'}
                  variant="primary"
                  disabled={!!busy}
                  onPress={() => setComposerStep((v) => v + 1)}
                />
              )}
            </ButtonRow>
          </View>
        </View>
      </Modal>
      <ModalSheet visible={bulk} onClose={() => setBulk(false)} title="Add multiple recipients" description="Paste addresses, or add each email with an optional name." width={560}>
        <Field label="Paste addresses" helper="One per line. “Name <email>” works too.">
          <TextField
            accessibilityLabel="Bulk recipient addresses"
            placeholder={'alex@gmail.com\nSam <sam@gmail.com>'}
            value={bulkText}
            onChangeText={setBulkText}
            multiline
            style={styles.textarea}
          />
        </Field>
        <Button
          label="Add pasted addresses"
          onPress={() => {
            try {
              const added = parseBulkRecipients(bulkText);
              const merged = new Map(people.filter((p) => p.email.trim()).map((p) => [p.email.trim().toLowerCase(), p]));
              for (const p of added) if (!merged.has(p.email)) merged.set(p.email, p);
              if (merged.size > 50) throw new Error('Use at most 50 unique recipients.');
              setPeople([...merged.values()]);
              setBulkText('');
            } catch (e) {
              setError((e as Error).message);
            }
          }}
        />
        {people.map((p, i) => (
          <View key={i} style={[styles.replyBlock, { borderColor: theme.border }]}>
            <TextField
              accessibilityLabel={`Bulk recipient ${i + 1} email`}
              placeholder="Email address"
              value={p.email}
              keyboardType="email-address"
              onChangeText={(email) => setPeople((rows) => rows.map((v, j) => (i === j ? { ...v, email } : v)))}
            />
            <TextField
              accessibilityLabel={`Bulk recipient ${i + 1} optional name`}
              placeholder="Name (optional)"
              value={p.name}
              maxLength={100}
              onChangeText={(name) => setPeople((rows) => rows.map((v, j) => (i === j ? { ...v, name } : v)))}
            />
            <Button label="Remove" size="sm" variant="dangerOutline" onPress={() => setPeople((rows) => rows.filter((_, j) => j !== i))} />
          </View>
        ))}
        <Button label="Add another person" icon={PlusIcon} disabled={people.length >= 50} onPress={() => setPeople((rows) => [...rows, blankRecipient()])} />
        <Button label={`Done · ${namedCount} recipients`} variant="primary" fullWidth onPress={() => setBulk(false)} />
      </ModalSheet>
      <ModalSheet
        visible={review && !!selected}
        onClose={() => setReview(false)}
        title="Review before sending"
        description={`${recipients.length} separate emails · ${mailbox?.email || 'Connect Gmail first'}`}
        width={560}
      >
        <View style={[styles.replyBlock, { borderColor: theme.border }]}>
          <Label>{selected?.subject || ''}</Label>
          <ThemedText type="small" selectable>
            {selected?.body.replace(/\{\{name\}\}/g, recipients[0]?.name || 'there')}
          </ThemedText>
        </View>
        <Muted>Recipients: {recipients.map((r) => r.email).join(', ')}</Muted>
        <Muted>Each person receives their own email. No CC/BCC and no automatic follow-up emails. Pausing cannot recall messages already sent.</Muted>
        <Checkbox
          checked={approved}
          onChange={setApproved}
          label="I reviewed the recipients and message and authorise sending from my connected Gmail."
        />
        {!mailbox?.connected ? <InlineAlert tone="warning" message="Connect Gmail in the email duty form before sending." /> : null}
        <Button
          label={selected?.status === 'paused' ? 'Resume this duty' : `Send to ${recipients.length} people`}
          variant="primary"
          size="lg"
          fullWidth
          icon={SendIcon}
          disabled={!approved || !mailbox?.connected || !!busy}
          loading={busy === 'send'}
          onPress={() => act('send')}
        />
      </ModalSheet>
      <ModalSheet
        visible={!!expanded}
        onClose={() => setOpenedRecipient(null)}
        title={expanded?.name || expanded?.email || 'Reply'}
        description={expanded?.name ? expanded.email : 'Original replies and AI summary'}
        width={600}
      >
        {expanded?.analysis && (
          <>
            <Label>In simple words</Label>
            <ThemedText type="small" selectable>
              {expanded.analysis.summary}
            </ThemedText>
            <Muted>
              {expanded.analysis.sentiment} · {expanded.analysis.intent.replace(/_/g, ' ')}
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
            <ThemedText type="small">{expanded.analysis.opted_out ? 'Do not email again.' : expanded.analysis.next_step}</ThemedText>
          </>
        )}
        {onCreateDeal && expanded && selected && !expanded.analysis?.opted_out && (
          <Button
            label="Create Sales opportunity"
            variant="primary"
            icon={PlusIcon}
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
            <View key={m.id} style={[styles.replyBlock, { borderColor: theme.border }]}>
              <Muted>
                {dateLabel(m.received_at)}
                {m.is_auto_reply ? ' · Automatic reply (excluded from response stats)' : ''}
              </Muted>
              <ThemedText type="small" selectable>
                {m.body || '(No readable text body)'}
              </ThemedText>
            </View>
          ))}
        {!messages.some((m) => m.recipient_id === openedRecipient) && <Muted>No reply has been received yet.</Muted>}
        <Muted>AI summaries can miss nuance. The original email stays saved above.</Muted>
      </ModalSheet>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { gap: 20, width: '100%', maxWidth: PageMaxWidth, alignSelf: 'center', paddingBottom: 80 },
  workspaceHeader: { paddingHorizontal: 24, paddingVertical: 18, borderBottomWidth: 1, flexDirection: 'row', alignItems: 'center', gap: 16 },
  stepRow: { paddingHorizontal: 24, paddingVertical: 14, alignItems: 'center' },
  workspaceFooter: {
    paddingHorizontal: 24,
    paddingVertical: 14,
    borderTopWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    flexWrap: 'wrap',
  },
  main: { gap: 20, minWidth: 0, width: '100%' },
  composer: { width: '100%', maxWidth: 880, alignSelf: 'center' },
  composerWidth: { width: '100%', maxWidth: 880, alignSelf: 'center' },
  stats: { flexDirection: 'row', flexWrap: 'wrap', gap: 16 },
  statCell: { flexGrow: 1, minWidth: 0 },
  between: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' },
  wrap: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8 },
  connection: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 12, padding: 14, borderWidth: 1, borderRadius: Radius.control + 2 },
  fieldPair: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  fieldCell: { flexGrow: 1, flexBasis: 220 },
  textarea: { minHeight: 110 },
  campaign: { width: 220, gap: 8, padding: 14, borderWidth: 1, borderRadius: Radius.control + 2 },
  chartRow: { gap: 16 },
  recipient: { paddingVertical: 14, paddingHorizontal: 8, marginHorizontal: -8, gap: 6, borderTopWidth: 1, borderRadius: 8 },
  replyBlock: { padding: 14, borderWidth: 1, borderRadius: Radius.control, gap: 10 },
});
