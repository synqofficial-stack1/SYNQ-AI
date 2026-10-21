import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import {
  ActivityIndicator,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  useWindowDimensions,
} from 'react-native';
import { EmailOutreach } from '@/components/email-outreach';
import { DepartmentActivityChart } from '@/components/department-activity-chart';
import { ModalSheet } from '@/components/modal-sheet';
import { PrimaryButton } from '@/components/primary-button';
import { TextField } from '@/components/text-field';
import { ThemedText } from '@/components/themed-text';
import { AccentColors } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useWorkspace } from '@/hooks/use-workspace';
import { listLeads } from '@/lib/leads';
import type { Lead } from '@/types/database';
import {
  STAGES,
  STAGE_LABELS,
  blankDeal,
  dealsCsv,
  loadSales,
  loadTarget,
  localDate,
  money,
  quoteDraft,
  salesSummary,
  saveDeal,
  saveTarget,
  opportunityFromEmail,
  type Deal,
  type DealInput,
  type SalesTarget,
} from '@/lib/sales-workspace';

const TABS = [
  'Pipeline',
  'Next actions',
  'Meetings',
  'Quotations',
  'Targets',
  'Email duties',
] as const;
type Tab = (typeof TABS)[number];
const VIEWS: Record<Tab, string> = {
  Pipeline: 'pipeline',
  'Next actions': 'actions',
  Meetings: 'meetings',
  Quotations: 'quotes',
  Targets: 'targets',
  'Email duties': 'email',
};
function Small({ children }: { children: ReactNode }) {
  return (
    <ThemedText type="caption" themeColor="textSecondary">
      {children}
    </ThemedText>
  );
}
function Box({
  children,
  compact = false,
}: {
  children: ReactNode;
  compact?: boolean;
}) {
  const theme = useTheme();
  return (
    <View
      style={[
        styles.box,
        {
          backgroundColor: theme.surface,
          borderColor: theme.border,
          ...(compact ? { padding: 12 } : {}),
        },
      ]}
    >
      {children}
    </View>
  );
}
function Action({
  label,
  onPress,
  active = false,
  disabled = false,
}: {
  label: string;
  onPress: () => void;
  active?: boolean;
  disabled?: boolean;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled, selected: active }}
      disabled={disabled}
      onPress={onPress}
      style={[
        styles.action,
        {
          borderColor: active ? AccentColors.primary : theme.border,
          backgroundColor: active ? 'rgba(212,175,55,0.10)' : theme.surface,
          opacity: disabled ? 0.45 : 1,
        },
      ]}
    >
      <ThemedText
        type="smallBold"
        style={active ? { color: AccentColors.primary } : undefined}
      >
        {label}
      </ThemedText>
    </Pressable>
  );
}
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View style={{ gap: 7, flexGrow: 1, minWidth: 220, maxWidth: '100%' }}>
      <ThemedText type="smallBold">{label}</ThemedText>
      {children}
    </View>
  );
}
function download(text: string, name: string, type = 'text/plain') {
  if (Platform.OS !== 'web')
    throw new Error('Downloads are available in the web app.');
  const url = URL.createObjectURL(new Blob(['\uFEFF' + text], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function draftOf(d: Deal): DealInput {
  const {
    id,
    user_id,
    organization_id,
    closed_at,
    created_at,
    updated_at,
    ...input
  } = d;
  return input;
}
export function SalesWorkspace() {
  const theme = useTheme();
  const { width } = useWindowDimensions();
  const { identity } = useWorkspace();
  const params = useLocalSearchParams<{ compose?: string; view?: string }>();
  const emailVisible = params.compose === '1' || params.view === 'email';
  const current: Tab = emailVisible
    ? 'Email duties'
    : TABS.find((t) => VIEWS[t] === params.view) || 'Pipeline';
  const [rows, setRows] = useState<Deal[]>([]),
    [target, setTarget] = useState<SalesTarget | null>(null),
    [loaded, setLoaded] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const [search, setSearch] = useState(''),
    [archived, setArchived] = useState(false),
    [busy, setBusy] = useState(false);
  const [editor, setEditor] = useState(false),
    [editing, setEditing] = useState<Deal>(),
    [draft, setDraft] = useState<DealInput>(blankDeal),
    [baseline, setBaseline] = useState(''),
    [section, setSection] = useState('Deal'),
    [formError, setFormError] = useState(''),
    [discard, setDiscard] = useState(false);
  const [amountText, setAmountText] = useState('');
  const [crm, setCrm] = useState<Lead[] | null>(null),
    [crmSearch, setCrmSearch] = useState('');
  const today = localDate(),
    month = today.slice(0, 7) + '-01';
  const owner = identity?.membership?.role === 'owner';
  const [goalRevenue, setGoalRevenue] = useState(''),
    [goalDeals, setGoalDeals] = useState(''),
    [targetOpen, setTargetOpen] = useState(false),
    [targetError, setTargetError] = useState('');
  const refresh = useCallback(async () => {
    try {
      const [deals, goal] = await Promise.all([loadSales(), loadTarget(month)]);
      setRows(deals);
      setTarget(goal);
      setError('');
      setLoaded(true);
    } catch (e) {
      setError((e as Error).message);
      setLoaded(true);
    }
  }, [month]);
  useEffect(() => {
    let live = true;
    const load = async () => {
      try {
        const [deals, goal] = await Promise.all([
          loadSales(),
          loadTarget(month),
        ]);
        if (live) {
          setRows(deals);
          setTarget(goal);
          setError('');
          setLoaded(true);
        }
      } catch (e) {
        if (live) {
          setError((e as Error).message);
          setLoaded(true);
        }
      }
    };
    Promise.resolve().then(load);
    const timer = setInterval(load, 30000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [month]);
  const stats = salesSummary(rows, today);
  const filtered = rows.filter(
    (d) =>
      d.archived === archived &&
      (d.title + ' ' + d.contact_name + ' ' + d.company + ' ' + d.contact_email)
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  const field = <K extends keyof DealInput>(key: K, value: DealInput[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));
  function open(deal?: Deal, part = 'Deal') {
    const input = deal ? draftOf(deal) : blankDeal();
    setEditing(deal);
    setDraft(input);
    setAmountText(input.amount === null ? '' : String(input.amount));
    setBaseline(JSON.stringify(input));
    setSection(part);
    setFormError('');
    setCrm(null);
    setEditor(true);
  }
  function close() {
    if (busy) return;
    if (JSON.stringify(draft) !== baseline) setDiscard(true);
    else setEditor(false);
  }
  async function save() {
    setBusy(true);
    setFormError('');
    try {
      await saveDeal(draft, editing);
      setEditor(false);
      setNotice(
        editing ? 'Deal updated.' : 'Deal added to your company pipeline.',
      );
      await refresh();
    } catch (e) {
      setFormError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function selectTab(value: Tab) {
    setNotice('');
    router.setParams({ view: VIEWS[value], compose: '0' });
  }
  async function chooseCrm() {
    setBusy(true);
    setFormError('');
    try {
      setCrm(await listLeads());
      setCrmSearch('');
    } catch (e) {
      setFormError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function dealCard(deal: Deal) {
    return (
      <Pressable
        key={deal.id}
        accessibilityRole="button"
        accessibilityLabel={`Edit ${deal.title}`}
        onPress={() => open(deal)}
        style={[
          styles.deal,
          { borderColor: theme.border, backgroundColor: theme.surfaceRaised },
        ]}
      >
        <ThemedText type="smallBold">{deal.title}</ThemedText>
        <Small>
          {deal.contact_name || deal.company || 'Add a contact'}
          {deal.contact_name && deal.company ? ' · ' + deal.company : ''}
        </Small>
        <ThemedText type="small" style={{ color: AccentColors.primaryLight }}>
          {deal.amount === null ? 'Value not set' : money(Number(deal.amount))}
        </ThemedText>
        {deal.next_action ? (
          <Small>
            {deal.next_action}
            {deal.next_action_on ? ' · ' + deal.next_action_on : ''}
          </Small>
        ) : (
          <Small>Add the next step →</Small>
        )}
        {deal.next_action_on &&
          deal.next_action_on < today &&
          !['won', 'lost'].includes(deal.stage) && (
            <ThemedText type="caption" style={{ color: AccentColors.error }}>
              Action overdue
            </ThemedText>
          )}
        {deal.stage === 'lost' && <Small>Lost: {deal.lost_reason}</Small>}
      </Pressable>
    );
  }
  const reasons = new Map<string, number>();
  for (const deal of rows.filter((d) => d.stage === 'lost')) {
    const reason = deal.lost_reason.trim().toLowerCase();
    reasons.set(reason, (reasons.get(reason) || 0) + 1);
  }
  const compactMoney = (value: number) =>
    value >= 10000000
      ? `₹${+(value / 10000000).toFixed(1)}Cr`
      : value >= 100000
        ? `₹${+(value / 100000).toFixed(1)}L`
        : value >= 1000
          ? `₹${+(value / 1000).toFixed(1)}k`
          : money(value);
  const progress =
    target && Number(target.revenue_goal) > 0
      ? (stats.wonValue / Number(target.revenue_goal)) * 100
      : null;
  return (
    <View style={{ flex: 1, minHeight: 0 }}>
      <View
        style={[styles.header, { paddingHorizontal: width < 600 ? 16 : 28 }]}
      >
        <View style={{ gap: 5, flexShrink: 1, minWidth: 0, maxWidth: '100%' }}>
          <ThemedText type="pageTitle">Sales</ThemedText>
          <Small>
            Turn conversations into opportunities—and opportunities into
            customers.
          </Small>
        </View>
        <View style={styles.wrap}>
          <Action label="Refresh" onPress={refresh} />
          <Action label="+ Add deal" active onPress={() => open()} />
        </View>
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={{ flexGrow: 0, flexShrink: 0, height: 60 }}
        contentContainerStyle={styles.tabs}
      >
        {TABS.map((t) => (
          <Action
            key={t}
            label={t}
            active={current === t}
            onPress={() => selectTab(t)}
          />
        ))}
      </ScrollView>
      <View
        style={{
          flex: 1,
          minHeight: 0,
          display: emailVisible ? 'flex' : 'none',
        }}
      >
        <EmailOutreach
          onCreateDeal={(recipient, campaign) => {
            try {
              const input = opportunityFromEmail(recipient, campaign);
              open();
              setDraft(input);
              setBaseline(JSON.stringify(input));
              router.setParams({ view: 'pipeline', compose: '0' });
            } catch (e) {
              setError((e as Error).message);
            }
          }}
        />
      </View>
      {!emailVisible && (
        <ScrollView
          contentContainerStyle={[
            styles.page,
            { padding: width < 600 ? 16 : 28 },
          ]}
        >
          {!!error && (
            <Box>
              <ThemedText
                accessibilityRole="alert"
                style={{ color: AccentColors.error }}
              >
                {error}
              </ThemedText>
              <Action label="Try again" onPress={refresh} />
            </Box>
          )}
          {!!notice && (
            <ThemedText
              accessibilityLiveRegion="polite"
              type="small"
              style={{ color: AccentColors.success }}
            >
              {notice}
            </ThemedText>
          )}
          {!loaded ? (
            <ActivityIndicator color={AccentColors.primary} />
          ) : (
            !error && (
              <>
                <View style={styles.metrics}>
                  {[
                    {
                      label: 'OPEN PIPELINE',
                      value:
                        width < 600
                          ? compactMoney(stats.pipeline)
                          : money(stats.pipeline),
                      detail: `${stats.open.length} open deals${stats.unknownValue ? ' · ' + stats.unknownValue + ' without a value' : ''}`,
                    },
                    {
                      label: 'WON THIS MONTH',
                      value:
                        width < 600
                          ? compactMoney(stats.wonValue)
                          : money(stats.wonValue),
                      detail: `${stats.won.length} deals · recorded deal value`,
                    },
                    {
                      label: 'DUE NOW',
                      value: String(stats.due.length),
                      detail: 'Next actions due today or overdue',
                    },
                  ].map((m) => (
                    <View
                      key={m.label}
                      style={{ flex: 1, minWidth: width < 600 ? 90 : 200 }}
                    >
                      <Box>
                        <Small>{m.label}</Small>
                        <ThemedText
                          type="metric"
                          style={{ fontSize: width < 600 ? 20 : 28 }}
                        >
                          {m.value}
                        </ThemedText>
                        <Small>
                          {width < 600
                            ? m.label === 'OPEN PIPELINE'
                              ? stats.open.length + ' deals'
                              : m.label === 'WON THIS MONTH'
                                ? stats.won.length + ' won'
                                : 'Due / overdue'
                            : m.detail}
                        </Small>
                      </Box>
                    </View>
                  ))}
                </View>
                {current === 'Pipeline' && (
                  <>
                    <View style={styles.between}>
                      <View style={{ flex: 1, minWidth: 200 }}>
                        <TextField
                          accessibilityLabel="Search deals"
                          placeholder="Search deals, contacts, or companies"
                          value={search}
                          onChangeText={setSearch}
                        />
                      </View>
                      <Action
                        label={archived ? 'Show active deals' : 'View archived'}
                        active={archived}
                        onPress={() => setArchived((v) => !v)}
                      />
                      <Action
                        label="Export CSV"
                        disabled={!filtered.length}
                        onPress={() => {
                          try {
                            download(
                              dealsCsv(filtered),
                              `synq-deals-${today}.csv`,
                              'text/csv',
                            );
                          } catch (e) {
                            setError((e as Error).message);
                          }
                        }}
                      />
                    </View>
                    {!filtered.length ? (
                      <Box>
                        <ThemedText type="sectionTitle">
                          {search
                            ? 'No matching deals'
                            : archived
                              ? 'No archived deals'
                              : 'Your next customer starts here'}
                        </ThemedText>
                        <Small>
                          {search
                            ? 'Try a different name or email address.'
                            : archived
                              ? 'Archived deals remain saved and can be restored.'
                              : 'Add an opportunity, its value, and the next step. You can bring a contact from your CRM into a deal.'}
                        </Small>
                        {!search && !archived && (
                          <Action
                            label="Create your first deal"
                            active
                            onPress={() => open()}
                          />
                        )}
                      </Box>
                    ) : (
                      <ScrollView
                        horizontal
                        showsHorizontalScrollIndicator
                        contentContainerStyle={{ gap: 14, paddingBottom: 14 }}
                      >
                        {STAGES.map((stage) => {
                          const deals = filtered.filter(
                            (d) => d.stage === stage,
                          );
                          return (
                            <View
                              key={stage}
                              style={[
                                styles.column,
                                {
                                  backgroundColor: theme.backgroundElement,
                                  borderColor: theme.border,
                                },
                              ]}
                            >
                              <View style={styles.between}>
                                <ThemedText type="smallBold">
                                  {STAGE_LABELS[stage]}
                                </ThemedText>
                                <Small>{deals.length}</Small>
                              </View>
                              <Small>
                                {money(
                                  deals.reduce(
                                    (s, d) => s + Number(d.amount || 0),
                                    0,
                                  ),
                                )}{' '}
                                · known values
                              </Small>
                              {deals.map(dealCard)}
                              {!deals.length && (
                                <Small>No deals in this stage.</Small>
                              )}
                            </View>
                          );
                        })}
                      </ScrollView>
                    )}
                  </>
                )}
                {current === 'Next actions' && (
                  <Box>
                    <ThemedText type="sectionTitle">
                      Keep every opportunity moving
                    </ThemedText>
                    <Small>
                      Dates use your local calendar. Tasks are reminders here;
                      no email is sent.
                    </Small>
                    {stats.open
                      .filter((d) => d.next_action)
                      .sort((a, b) =>
                        (a.next_action_on || '9999').localeCompare(
                          b.next_action_on || '9999',
                        ),
                      )
                      .map((d) => (
                        <Pressable
                          key={d.id}
                          accessibilityRole="button"
                          onPress={() => open(d, 'Next steps')}
                          style={[
                            styles.listRow,
                            { borderColor: theme.border },
                          ]}
                        >
                          <ThemedText type="smallBold">
                            {d.next_action}
                          </ThemedText>
                          <Small>
                            {d.title} · {d.next_action_on || 'No due date'}
                            {d.next_action_on && d.next_action_on < today
                              ? ' · Overdue'
                              : ''}
                          </Small>
                        </Pressable>
                      ))}
                    {!stats.open.some((d) => d.next_action) && (
                      <Small>
                        Add a next action inside a deal to build your follow-up
                        list.
                      </Small>
                    )}
                    <Action
                      label="Plan an action"
                      onPress={() => open(undefined, 'Next steps')}
                    />
                  </Box>
                )}
                {current === 'Meetings' && (
                  <Box>
                    <ThemedText type="sectionTitle">
                      Meetings & demos
                    </ThemedText>
                    <Small>
                      Track appointments and outcomes. These entries do not send
                      calendar invitations.
                    </Small>
                    {stats.active
                      .filter((d) => d.meeting_on)
                      .sort((a, b) =>
                        (a.meeting_on! + a.meeting_time).localeCompare(
                          b.meeting_on! + b.meeting_time,
                        ),
                      )
                      .map((d) => (
                        <Pressable
                          key={d.id}
                          accessibilityRole="button"
                          onPress={() => open(d, 'Next steps')}
                          style={[
                            styles.listRow,
                            { borderColor: theme.border },
                          ]}
                        >
                          <ThemedText type="smallBold">{d.title}</ThemedText>
                          <Small>
                            {d.meeting_on} {d.meeting_time} ·{' '}
                            {d.meeting_status.replace('_', ' ')}
                            {d.meeting_on! < today &&
                            d.meeting_status === 'planned'
                              ? ' · Update outcome'
                              : ''}
                          </Small>
                          {!!d.meeting_notes && (
                            <Small>{d.meeting_notes}</Small>
                          )}
                        </Pressable>
                      ))}
                    {!stats.active.some((d) => d.meeting_on) && (
                      <Small>
                        No meetings recorded yet. Schedule one against a deal.
                      </Small>
                    )}
                    <Action
                      label="Add meeting to a new deal"
                      onPress={() => open(undefined, 'Next steps')}
                    />
                  </Box>
                )}
                {current === 'Quotations' && (
                  <Box>
                    <ThemedText type="sectionTitle">
                      Quotations, ready for your review
                    </ThemedText>
                    <Small>
                      Save an editable quotation against each deal. Copy or
                      download the draft when it is ready.
                    </Small>
                    {stats.active
                      .filter((d) => d.quote_text)
                      .map((d) => (
                        <View
                          key={d.id}
                          style={[
                            styles.listRow,
                            { borderColor: theme.border },
                          ]}
                        >
                          <ThemedText type="smallBold">{d.title}</ThemedText>
                          <Small>
                            {d.contact_name ||
                              d.company ||
                              'Customer details not set'}{' '}
                            ·{' '}
                            {d.amount === null
                              ? 'Value not set'
                              : money(Number(d.amount))}
                          </Small>
                          <View style={styles.wrap}>
                            <Action
                              label="Review quotation"
                              onPress={() => open(d, 'Quotation')}
                            />
                            <Action
                              label="Download .txt"
                              onPress={() => {
                                try {
                                  download(
                                    d.quote_text,
                                    'synq-quotation-' +
                                      d.id.slice(0, 8) +
                                      '.txt',
                                  );
                                } catch (e) {
                                  setError((e as Error).message);
                                }
                              }}
                            />
                          </View>
                        </View>
                      ))}
                    {!stats.active.some((d) => d.quote_text) && (
                      <Small>
                        Open a deal and choose Quotation to prepare your first
                        draft.
                      </Small>
                    )}
                    <Action
                      label="Prepare a new quotation"
                      onPress={() => open(undefined, 'Quotation')}
                    />
                  </Box>
                )}
                {current === 'Targets' && (
                  <>
                    {rows.length > 0 && (
                      <DepartmentActivityChart department="sales" />
                    )}
                    <Box>
                      <View style={styles.between}>
                        <ThemedText type="sectionTitle">
                          {new Date(month + 'T12:00:00').toLocaleDateString(
                            undefined,
                            { month: 'long', year: 'numeric' },
                          )}{' '}
                          targets
                        </ThemedText>
                        {owner && (
                          <Action
                            label={target ? 'Edit target' : 'Set target'}
                            active
                            onPress={() => {
                              setGoalRevenue(
                                String(target?.revenue_goal ?? ''),
                              );
                              setGoalDeals(String(target?.deals_goal ?? ''));
                              setTargetError('');
                              setTargetOpen(true);
                            }}
                          />
                        )}
                      </View>
                      {target ? (
                        <>
                          <ThemedText type="smallBold">
                            {money(stats.wonValue)} /{' '}
                            {money(Number(target.revenue_goal))}
                          </ThemedText>
                          {progress !== null && (
                            <>
                              <View
                                style={{
                                  height: 10,
                                  borderRadius: 5,
                                  backgroundColor: theme.border,
                                  overflow: 'hidden',
                                }}
                              >
                                <View
                                  style={{
                                    height: '100%',
                                    width: `${Math.min(progress, 100)}%`,
                                    backgroundColor: AccentColors.primary,
                                  }}
                                />
                              </View>
                              <Small>
                                {Math.round(progress)}% of revenue goal
                              </Small>
                            </>
                          )}
                          <Small>
                            {stats.won.length} / {target.deals_goal} deals won
                            this month
                          </Small>
                        </>
                      ) : (
                        <Small>
                          {owner
                            ? 'Set a monthly company goal to track progress.'
                            : 'Your company owner can set a monthly target.'}
                        </Small>
                      )}
                      <Small>
                        Based on recorded deals marked Won this month, including
                        archived wins. This is deal value, not a payment or
                        accounting report. All values are INR.
                      </Small>
                    </Box>
                    <Box>
                      <ThemedText type="sectionTitle">
                        Why deals were lost
                      </ThemedText>
                      <Small>
                        All recorded losses, including archived deals. Use these
                        reasons to improve the next conversation.
                      </Small>
                      {[...reasons]
                        .sort((a, b) => b[1] - a[1])
                        .map(([reason, count]) => (
                          <View key={reason} style={styles.between}>
                            <ThemedText type="small" style={{ flex: 1 }}>
                              {reason}
                            </ThemedText>
                            <ThemedText type="smallBold">{count}</ThemedText>
                          </View>
                        ))}
                      {!reasons.size && (
                        <Small>No lost-deal reasons recorded yet.</Small>
                      )}
                    </Box>
                  </>
                )}
              </>
            )
          )}
        </ScrollView>
      )}
      <Modal visible={editor} animationType="slide" onRequestClose={close}>
        <View style={{ flex: 1, backgroundColor: theme.background }}>
          <View style={styles.editorHeader}>
            <ThemedText type="sectionTitle">
              {editing ? 'Edit opportunity' : 'New opportunity'}
            </ThemedText>
            <Action label="Close" disabled={busy} onPress={close} />
          </View>
          <View
            style={[styles.wrap, { justifyContent: 'center', padding: 16 }]}
          >
            {['Deal', 'Next steps', 'Quotation'].map((part) => (
              <Action
                key={part}
                label={part}
                active={section === part}
                disabled={busy}
                onPress={() => {
                  setSection(part);
                  setCrm(null);
                }}
              />
            ))}
          </View>
          <ScrollView
            contentContainerStyle={{
              padding: width < 600 ? 16 : 28,
              gap: 18,
              width: '100%',
              maxWidth: 1000,
              alignSelf: 'center',
            }}
            keyboardShouldPersistTaps="handled"
          >
            {!!formError && (
              <ThemedText
                accessibilityRole="alert"
                style={{ color: AccentColors.error }}
              >
                {formError}
              </ThemedText>
            )}
            {section === 'Deal' && (
              <>
                <Field label="Deal name *">
                  <TextField
                    accessibilityLabel="Deal name"
                    placeholder="e.g. Website package for Acme"
                    value={draft.title}
                    maxLength={160}
                    onChangeText={(v) => field('title', v)}
                  />
                </Field>
                <ThemedText type="smallBold">Stage</ThemedText>
                <View style={styles.wrap}>
                  {STAGES.map((stage) => (
                    <Action
                      key={stage}
                      label={STAGE_LABELS[stage]}
                      active={draft.stage === stage}
                      onPress={() => field('stage', stage)}
                    />
                  ))}
                </View>
                {draft.stage === 'lost' && (
                  <Field label="Why was the deal lost? *">
                    <TextField
                      accessibilityLabel="Lost deal reason"
                      value={draft.lost_reason}
                      maxLength={500}
                      placeholder="Price, timing, competitor, no response…"
                      onChangeText={(v) => field('lost_reason', v)}
                    />
                  </Field>
                )}
                <View style={styles.wrap}>
                  <Field label="Value (INR) · optional">
                    <TextField
                      accessibilityLabel="Deal value in INR"
                      keyboardType="decimal-pad"
                      placeholder="Leave blank if unknown"
                      value={amountText}
                      onChangeText={(v) => {
                        setAmountText(v);
                        field('amount', v.trim() === '' ? null : Number(v));
                      }}
                    />
                  </Field>
                  <Field label="Expected close · YYYY-MM-DD">
                    <TextField
                      accessibilityLabel="Expected closing date"
                      placeholder="YYYY-MM-DD"
                      value={draft.expected_close || ''}
                      maxLength={10}
                      onChangeText={(v) => field('expected_close', v || null)}
                    />
                  </Field>
                </View>
                <View style={styles.between}>
                  <ThemedText type="sectionTitle">Contact</ThemedText>
                  <Action
                    label="Choose from CRM"
                    disabled={busy}
                    onPress={chooseCrm}
                  />
                </View>
                {crm && (
                  <Box>
                    <TextField
                      accessibilityLabel="Search CRM contacts"
                      placeholder="Search CRM contacts"
                      value={crmSearch}
                      onChangeText={setCrmSearch}
                    />
                    <ScrollView style={{ maxHeight: 240 }}>
                      {crm
                        .filter((l) =>
                          (l.name + ' ' + l.company + ' ' + l.email)
                            .toLowerCase()
                            .includes(crmSearch.toLowerCase()),
                        )
                        .slice(0, 50)
                        .map((l) => (
                          <Pressable
                            accessibilityRole="button"
                            key={l.id}
                            onPress={() => {
                              setDraft((d) => ({
                                ...d,
                                contact_name: l.name || '',
                                contact_email: l.email || '',
                                company: l.company || '',
                              }));
                              setCrm(null);
                            }}
                            style={[
                              styles.listRow,
                              { borderColor: theme.border },
                            ]}
                          >
                            <ThemedText type="smallBold">
                              {l.name || l.company || 'Unnamed contact'}
                            </ThemedText>
                            <Small>{l.email || 'No email saved'}</Small>
                          </Pressable>
                        ))}
                    </ScrollView>
                    <Small>
                      Showing up to 50 matches. Type to narrow the list.
                    </Small>
                    <Action
                      label="Close contact picker"
                      onPress={() => setCrm(null)}
                    />
                  </Box>
                )}
                <View style={styles.wrap}>
                  <Field label="Contact name">
                    <TextField
                      accessibilityLabel="Contact name"
                      value={draft.contact_name}
                      maxLength={120}
                      onChangeText={(v) => field('contact_name', v)}
                    />
                  </Field>
                  <Field label="Company">
                    <TextField
                      accessibilityLabel="Contact company"
                      value={draft.company}
                      maxLength={120}
                      onChangeText={(v) => field('company', v)}
                    />
                  </Field>
                </View>
                <Field label="Contact email">
                  <TextField
                    accessibilityLabel="Contact email"
                    keyboardType="email-address"
                    value={draft.contact_email}
                    maxLength={254}
                    onChangeText={(v) => field('contact_email', v)}
                  />
                </Field>
                <Field label="Deal notes">
                  <TextField
                    accessibilityLabel="Deal notes"
                    multiline
                    style={{ minHeight: 120 }}
                    value={draft.notes}
                    maxLength={5000}
                    onChangeText={(v) => field('notes', v)}
                  />
                </Field>
                {editing && (
                  <Action
                    label={
                      draft.archived
                        ? 'Restore to active pipeline'
                        : 'Archive this deal (keeps its history)'
                    }
                    onPress={() => field('archived', !draft.archived)}
                  />
                )}{' '}
                {draft.archived && (
                  <Small>
                    This deal will be archived when you save. You can restore it
                    later.
                  </Small>
                )}
              </>
            )}
            {section === 'Next steps' && (
              <>
                <ThemedText type="sectionTitle">Next action</ThemedText>
                <Field label="What needs to happen next?">
                  <TextField
                    accessibilityLabel="Next action"
                    placeholder="e.g. Send the revised proposal"
                    value={draft.next_action}
                    maxLength={500}
                    onChangeText={(v) => field('next_action', v)}
                  />
                </Field>
                <Field label="Due date · YYYY-MM-DD">
                  <TextField
                    accessibilityLabel="Next action due date"
                    placeholder="YYYY-MM-DD"
                    value={draft.next_action_on || ''}
                    maxLength={10}
                    onChangeText={(v) => field('next_action_on', v || null)}
                  />
                </Field>
                <Action
                  label="Clear completed action"
                  onPress={() =>
                    setDraft((d) => ({
                      ...d,
                      next_action: '',
                      next_action_on: null,
                    }))
                  }
                />
                <ThemedText type="sectionTitle">Meeting / demo</ThemedText>
                <View style={styles.wrap}>
                  <Field label="Meeting date · YYYY-MM-DD">
                    <TextField
                      accessibilityLabel="Meeting date"
                      placeholder="YYYY-MM-DD"
                      value={draft.meeting_on || ''}
                      maxLength={10}
                      onChangeText={(v) =>
                        setDraft((d) => ({
                          ...d,
                          meeting_on: v || null,
                          meeting_time: v ? d.meeting_time : '',
                        }))
                      }
                    />
                  </Field>
                  <Field label="Local time · HH:mm (24h)">
                    <TextField
                      accessibilityLabel="Meeting time"
                      placeholder="14:30"
                      value={draft.meeting_time}
                      maxLength={5}
                      onChangeText={(v) => field('meeting_time', v)}
                    />
                  </Field>
                </View>
                <Small>
                  Meeting times are entered as local wall-clock time; this does
                  not create a calendar event.
                </Small>
                <View style={styles.wrap}>
                  {(['planned', 'held', 'no_show', 'cancelled'] as const).map(
                    (s) => (
                      <Action
                        key={s}
                        label={s.replace('_', ' ')}
                        active={draft.meeting_status === s}
                        onPress={() => field('meeting_status', s)}
                      />
                    ),
                  )}
                </View>
                <Field label="Meeting notes / outcome">
                  <TextField
                    accessibilityLabel="Meeting notes"
                    multiline
                    style={{ minHeight: 120 }}
                    value={draft.meeting_notes}
                    maxLength={3000}
                    onChangeText={(v) => field('meeting_notes', v)}
                  />
                </Field>
              </>
            )}
            {section === 'Quotation' && (
              <>
                <ThemedText type="sectionTitle">Prepare a quotation</ThemedText>
                <Small>
                  Use the deal details to start a draft, then add scope, taxes,
                  validity, and payment terms yourself. Existing text is
                  preserved unless you explicitly replace it.
                </Small>
                {!draft.quote_text ? (
                  <Action
                    label="Create quotation template"
                    active
                    onPress={() => field('quote_text', quoteDraft(draft))}
                  />
                ) : (
                  <Small>
                    Edit your saved draft below. Nothing is sent automatically.
                  </Small>
                )}
                <TextField
                  accessibilityLabel="Quotation draft"
                  multiline
                  placeholder="Write or generate your quotation template here…"
                  value={draft.quote_text}
                  maxLength={12000}
                  style={{ minHeight: 360, textAlignVertical: 'top' }}
                  onChangeText={(v) => field('quote_text', v)}
                />
                <View style={styles.wrap}>
                  <Action
                    label="Copy draft"
                    disabled={!draft.quote_text || Platform.OS !== 'web'}
                    onPress={() => {
                      navigator.clipboard
                        .writeText(draft.quote_text)
                        .then(() => setFormError('Draft copied.'))
                        .catch(() =>
                          setFormError(
                            'Could not copy. Select the text or download it instead.',
                          ),
                        );
                    }}
                  />
                  <Action
                    label="Download .txt"
                    disabled={!draft.quote_text}
                    onPress={() => {
                      try {
                        download(draft.quote_text, 'synq-quotation-draft.txt');
                      } catch (e) {
                        setFormError((e as Error).message);
                      }
                    }}
                  />
                </View>
                <Small>
                  Save the deal to keep this quotation in your company
                  workspace.
                </Small>
              </>
            )}
          </ScrollView>
          <View style={[styles.footer, { borderTopColor: theme.border }]}>
            <Small>Company members share this deal. Values are INR.</Small>
            <View style={{ minWidth: 180 }}>
              <PrimaryButton
                title={editing ? 'Save changes' : 'Create deal'}
                loading={busy}
                onPress={save}
              />
            </View>
          </View>
        </View>
      </Modal>
      <ModalSheet
        visible={discard}
        onClose={() => setDiscard(false)}
        title="Discard unsaved changes?"
        description="Your saved deal stays unchanged."
      >
        <PrimaryButton title="Keep editing" onPress={() => setDiscard(false)} />
        <Action
          label="Discard changes"
          onPress={() => {
            setDiscard(false);
            setEditor(false);
          }}
        />
      </ModalSheet>
      <ModalSheet
        visible={targetOpen}
        onClose={() => {
          if (!busy) setTargetOpen(false);
        }}
        title="Monthly company target"
        description={`${month.slice(0, 7)} · INR · Only the company owner can change this.`}
      >
        <Field label="Revenue target (INR)">
          <TextField
            accessibilityLabel="Monthly revenue target"
            keyboardType="decimal-pad"
            value={goalRevenue}
            onChangeText={setGoalRevenue}
          />
        </Field>
        <Field label="Deals to win">
          <TextField
            accessibilityLabel="Monthly deals target"
            keyboardType="number-pad"
            value={goalDeals}
            onChangeText={setGoalDeals}
          />
        </Field>
        {!!targetError && (
          <ThemedText
            accessibilityRole="alert"
            style={{ color: AccentColors.error }}
          >
            {targetError}
          </ThemedText>
        )}
        <PrimaryButton
          title="Save target"
          loading={busy}
          disabled={!goalRevenue.trim() || !goalDeals.trim()}
          onPress={async () => {
            setBusy(true);
            setTargetError('');
            try {
              await saveTarget(
                identity!.membership!.organization_id,
                month,
                Number(goalRevenue),
                Number(goalDeals),
                target,
              );
              setTargetOpen(false);
              await refresh();
            } catch (e) {
              setTargetError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        />
      </ModalSheet>
    </View>
  );
}
const styles = StyleSheet.create({
  header: {
    paddingVertical: 20,
    gap: 14,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    flexWrap: 'wrap',
  },
  tabs: { gap: 8, paddingHorizontal: 20, paddingBottom: 14 },
  page: {
    gap: 22,
    paddingBottom: 70,
    width: '100%',
    maxWidth: 1700,
    alignSelf: 'center',
  },
  box: { borderWidth: 1, borderRadius: 16, padding: 20, gap: 14 },
  wrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    alignItems: 'center',
  },
  between: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  metrics: { flexDirection: 'row', flexWrap: 'wrap', gap: 14 },
  action: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  column: {
    width: 245,
    borderWidth: 1,
    borderRadius: 16,
    padding: 14,
    gap: 14,
    alignSelf: 'flex-start',
  },
  deal: { borderWidth: 1, borderRadius: 12, padding: 15, gap: 9 },
  listRow: { borderTopWidth: 1, paddingVertical: 15, gap: 7 },
  editorHeader: {
    padding: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  footer: {
    borderTopWidth: 1,
    padding: 18,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 12,
  },
});
