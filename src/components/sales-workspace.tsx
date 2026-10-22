import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { DepartmentActivityChart } from '@/components/department-activity-chart';
import { EmailOutreach } from '@/components/email-outreach';
import {
  ArrowIcon,
  CalendarIcon,
  ChartIcon,
  ClockIcon,
  DownloadIcon,
  FileTextIcon,
  HandshakeIcon,
  MailIcon,
  PlusIcon,
  SparkIcon,
  TargetIcon,
  TrendUpIcon,
  UploadIcon,
  UserIcon,
  UsersIcon,
  XIcon,
} from '@/components/icons';
import { ModalSheet } from '@/components/modal-sheet';
import { SalesMeetings } from '@/components/sales-meetings';
import { TextField } from '@/components/text-field';
import { ThemedText } from '@/components/themed-text';
import {
  Button,
  ButtonRow,
  Card,
  ChoiceGroup,
  DataTable,
  EmptyState,
  ErrorState,
  Field,
  FilterChips,
  IconButton,
  IconTile,
  InlineAlert,
  KpiCard,
  LinkButton,
  ListRow,
  LoadingState,
  PageHeader,
  ProgressBar,
  SearchInput,
  SectionHeader,
  Split,
  StatusBadge,
  Tabs,
  alpha,
  showToast,
  transition,
  useBreakpoint,
  type Tone,
} from '@/components/ui';
import { DataColors, PageMaxWidth, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useWorkspace } from '@/hooks/use-workspace';
import { listLeads } from '@/lib/leads';
import { loadSalesMeetings } from '@/lib/organization';
import { listCampaigns, type OutreachCampaign } from '@/lib/outreach';
import { parseDealsTarget } from '@/lib/sales-target-validation';
import {
  STAGES,
  STAGE_LABELS,
  blankDeal,
  dealsCsv,
  loadSales,
  loadTarget,
  localDate,
  money,
  opportunityFromEmail,
  quoteDraft,
  salesSummary,
  saveDeal,
  saveTarget,
  type Deal,
  type DealInput,
  type SalesTarget,
} from '@/lib/sales-workspace';
import { meetingTime, relativeTime } from '@/lib/workspace';
import type { Lead } from '@/types/database';

type Tab = 'overview' | 'leads' | 'meetings' | 'targets' | 'email';
type Section = 'Deal' | 'Meeting' | 'Quotation';

const TABS: { key: Tab; label: string }[] = [
  { key: 'overview', label: 'Overview' },
  { key: 'leads', label: 'Leads' },
  { key: 'meetings', label: 'Meetings' },
  { key: 'targets', label: 'Targets' },
  { key: 'email', label: 'Email duties' },
];

/** Stage colours for the pipeline columns; each column is also labelled. */
const STAGE_TONE: Record<Deal['stage'], string> = {
  new: DataColors.neutral,
  contacted: DataColors.company,
  interested: DataColors.marketing,
  negotiating: DataColors.sales,
  won: '#16A34A',
  lost: '#DC2626',
};

const LEAD_TONE: Record<Lead['status'], Tone> = {
  new: 'info',
  contacted: 'accent',
  qualified: 'success',
  disqualified: 'neutral',
};

function download(text: string, name: string, type = 'text/plain') {
  if (Platform.OS !== 'web') throw new Error('Downloads are available in the web app.');
  const url = URL.createObjectURL(new Blob(['﻿' + text], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function draftOf(d: Deal): DealInput {
  const { id, user_id, organization_id, closed_at, created_at, updated_at, ...input } = d;
  return input;
}

/** Two or more fields side by side on a wide screen, stacked on a phone. */
function FieldRow({ children }: { children: ReactNode }) {
  return <View style={styles.fieldRow}>{children}</View>;
}

function Grow({ children }: { children: ReactNode }) {
  return <View style={styles.fieldCell}>{children}</View>;
}

export function SalesWorkspace() {
  const theme = useTheme();
  const { width, isCompact } = useBreakpoint();
  const { identity } = useWorkspace();
  const params = useLocalSearchParams<{ compose?: string; view?: string }>();
  const emailVisible = params.compose === '1' || params.view === 'email';
  const current: Tab = emailVisible
    ? 'email'
    : params.view === 'leads' || params.view === 'meetings' || params.view === 'targets'
      ? params.view
      : 'overview';
  const [rows, setRows] = useState<Deal[]>([]),
    [leadRows, setLeadRows] = useState<Lead[]>([]),
    [campaignRows, setCampaignRows] = useState<OutreachCampaign[]>([]),
    [emailError, setEmailError] = useState(''),
    [meetingRows, setMeetingRows] = useState<Awaited<ReturnType<typeof loadSalesMeetings>>>([]),
    [meetingError, setMeetingError] = useState(''),
    [target, setTarget] = useState<SalesTarget | null>(null),
    [loaded, setLoaded] = useState(false),
    [error, setError] = useState('');
  const [search, setSearch] = useState(''),
    [leadSearch, setLeadSearch] = useState(''),
    [archived, setArchived] = useState(false),
    [activityFilter, setActivityFilter] = useState<'all' | 'leads' | 'meetings' | 'deals'>('all'),
    [busy, setBusy] = useState(false);
  const [editor, setEditor] = useState(false),
    [editing, setEditing] = useState<Deal>(),
    [draft, setDraft] = useState<DealInput>(blankDeal),
    [baseline, setBaseline] = useState(''),
    [section, setSection] = useState<Section>('Deal'),
    [formError, setFormError] = useState(''),
    [formNotice, setFormNotice] = useState(''),
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
      const [deals, goal, leads] = await Promise.all([loadSales(), loadTarget(month), listLeads()]);
      setRows(deals);
      setLeadRows(leads);
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
        const [deals, goal, leads] = await Promise.all([loadSales(), loadTarget(month), listLeads()]);
        if (live) {
          setRows(deals);
          setLeadRows(leads);
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
  useEffect(() => {
    let live = true;
    const load = () =>
      void loadSalesMeetings()
        .then((items) => {
          if (live) {
            setMeetingRows(items);
            setMeetingError('');
          }
        })
        .catch((cause: unknown) => {
          if (live) setMeetingError(cause instanceof Error ? cause.message : 'Could not load meeting activity.');
        });
    load();
    const timer = setInterval(load, 30000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, []);
  useEffect(() => {
    let live = true;
    const initial = setTimeout(
      () =>
        void listCampaigns()
          .then((items) => {
            if (live) {
              setCampaignRows(items);
              setEmailError('');
            }
          })
          .catch((cause: unknown) => {
            if (live) setEmailError(cause instanceof Error ? cause.message : 'Could not load email-duty status.');
          }),
      0,
    );
    const timer = setInterval(
      () =>
        void listCampaigns()
          .then((items) => {
            if (live) {
              setCampaignRows(items);
              setEmailError('');
            }
          })
          .catch(() => {}),
      30000,
    );
    return () => {
      live = false;
      clearTimeout(initial);
      clearInterval(timer);
    };
  }, []);

  const stats = salesSummary(rows, today);
  // All-time, including archived deals: the share of recorded opportunities that closed as won.
  const wonEver = rows.filter((deal) => deal.stage === 'won').length;
  const filtered = rows.filter(
    (d) =>
      d.archived === archived &&
      (d.title + ' ' + d.contact_name + ' ' + d.company + ' ' + d.contact_email).toLowerCase().includes(search.toLowerCase()),
  );
  const field = <K extends keyof DealInput>(key: K, value: DealInput[K]) => setDraft((d) => ({ ...d, [key]: value }));
  function open(deal?: Deal, part: Section = 'Deal', preset?: Partial<DealInput>) {
    const input = { ...(deal ? draftOf(deal) : blankDeal()), ...preset };
    setEditing(deal);
    setDraft(input);
    setAmountText(input.amount === null ? '' : String(input.amount));
    setBaseline(JSON.stringify(deal ? draftOf(deal) : input));
    setSection(part);
    setFormError('');
    setFormNotice('');
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
      showToast(editing ? 'Opportunity updated.' : 'Opportunity added to your company pipeline.');
      await refresh();
    } catch (e) {
      setFormError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function selectTab(value: Tab) {
    router.setParams({ view: value, compose: '0' });
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

  const reasons = new Map<string, number>();
  for (const deal of rows.filter((d) => d.stage === 'lost')) {
    const reason = deal.lost_reason.trim().toLowerCase();
    reasons.set(reason, (reasons.get(reason) || 0) + 1);
  }
  const revenueGoal = target ? Number(target.revenue_goal) : 0;
  const dealsGoal = target ? Number(target.deals_goal) : 0;
  const nowIso = new Date().toISOString();
  const upcoming = [
    ...meetingRows.filter((meeting) => meeting.starts_at > nowIso).map((meeting) => ({ id: meeting.id, title: meeting.title, when: meetingTime(meeting.starts_at), sort: meeting.starts_at, deal: undefined as Deal | undefined })),
    ...stats.meetings
      .filter((deal) => deal.meeting_on! >= today)
      .map((deal) => ({ id: deal.id, title: deal.title, when: `${deal.meeting_on} ${deal.meeting_time}`.trim(), sort: `${deal.meeting_on}T${deal.meeting_time || '00:00'}`, deal })),
  ].sort((a, b) => a.sort.localeCompare(b.sort));
  const totalMeetings = meetingRows.length + rows.filter((deal) => deal.meeting_on).length;
  const leadsThisMonth = leadRows.filter((lead) => lead.created_at.slice(0, 7) === today.slice(0, 7)).length;
  const nextActions = stats.open
    .filter((d) => d.next_action)
    .sort((a, b) => (a.next_action_on || '9999').localeCompare(b.next_action_on || '9999'));
  const monthLabel = new Date(month + 'T12:00:00').toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  const openTarget = () => {
    setGoalRevenue(String(target?.revenue_goal ?? ''));
    setGoalDeals(String(target?.deals_goal ?? ''));
    setTargetError('');
    setTargetOpen(true);
  };

  const header = (
    <View style={styles.headerBlock}>
      <PageHeader
        title="Sales"
        description="Turn conversations into opportunities — and opportunities into customers."
        actions={
          <>
            <Button label="Import leads" icon={UploadIcon} onPress={() => router.push('/import-leads')} />
            <Button label="New opportunity" variant="primary" icon={PlusIcon} onPress={() => open()} />
          </>
        }
      />
      <Tabs label="Sales sections" items={TABS} value={current} onChange={selectTab} />
    </View>
  );

  const kpis = (
    <View style={styles.kpis}>
      {[
        <KpiCard
          key="leads"
          label="Total leads"
          icon={UsersIcon}
          color={DataColors.company}
          value={loaded ? String(leadRows.length) : null}
          note={leadsThisMonth ? `${leadsThisMonth} added this month` : 'In your CRM'}
          onPress={() => selectTab('leads')}
        />,
        <KpiCard
          key="meetings"
          label="Meetings booked"
          icon={CalendarIcon}
          color={DataColors.marketing}
          value={loaded ? String(totalMeetings) : null}
          note={meetingError ? 'Meeting list unavailable' : `${upcoming.length} upcoming`}
          onPress={() => selectTab('meetings')}
        />,
        <KpiCard
          key="conversion"
          label="Conversion rate"
          icon={TrendUpIcon}
          color="#16A34A"
          value={loaded ? (rows.length ? `${Math.round((wonEver / rows.length) * 100)}%` : '—') : null}
          note={rows.length ? `${wonEver} of ${rows.length} opportunities won` : 'Add opportunities to see this'}
          onPress={() => selectTab('targets')}
        />,
      ].map((card, index) => (
        <View key={index} style={[styles.kpiCell, { flexBasis: width >= 1280 || (width >= 760 && width < 1180) ? '30%' : width >= 520 ? '45%' : '100%' }]}>
          {card}
        </View>
      ))}
    </View>
  );

  const dealCard = (deal: Deal) => {
    const overdue = deal.next_action_on && deal.next_action_on < today && !['won', 'lost'].includes(deal.stage);
    return (
      <Pressable
        key={deal.id}
        accessibilityRole="button"
        accessibilityLabel={`Edit ${deal.title}`}
        onPress={() => open(deal)}
        style={({ hovered }) => [
          styles.deal,
          transition,
          { borderColor: hovered ? theme.borderStrong : theme.border, backgroundColor: theme.surface },
        ]}
      >
        <ThemedText type="smallBold" numberOfLines={2}>
          {deal.title}
        </ThemedText>
        <ThemedText type="caption" themeColor="textSecondary" numberOfLines={1}>
          {deal.contact_name || deal.company || 'Add a contact'}
          {deal.contact_name && deal.company ? ' · ' + deal.company : ''}
        </ThemedText>
        <ThemedText type="caption" style={{ color: theme.text, fontWeight: '600' }}>
          {deal.amount === null ? 'Value not set' : money(Number(deal.amount))}
        </ThemedText>
        <ThemedText type="caption" themeColor="textSecondary" numberOfLines={2}>
          {deal.next_action ? `${deal.next_action}${deal.next_action_on ? ' · ' + deal.next_action_on : ''}` : 'Add the next step →'}
        </ThemedText>
        {overdue ? <StatusBadge label="Action overdue" tone="danger" /> : null}
        {deal.stage === 'lost' && deal.lost_reason ? (
          <ThemedText type="caption" themeColor="textSecondary" numberOfLines={2}>
            Lost: {deal.lost_reason}
          </ThemedText>
        ) : null}
      </Pressable>
    );
  };

  const pipeline = (
    <Card>
      <SectionHeader
        title="Sales pipeline"
        subtitle="Track opportunities from first contact to closed deal."
        action={
          <Button
            label="Export CSV"
            size="sm"
            icon={DownloadIcon}
            disabled={!filtered.length}
            onPress={() => {
              try {
                download(dealsCsv(filtered), `synq-deals-${today}.csv`, 'text/csv');
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          />
        }
      />
      <View style={styles.toolbar}>
        <SearchInput placeholder="Search deals, contacts or companies" value={search} onChangeText={setSearch} style={styles.toolbarSearch} />
        <Button
          label={archived ? 'Show active deals' : 'View archived'}
          size="sm"
          onPress={() => setArchived((v) => !v)}
          accessibilityHint={archived ? 'Shows deals that are still active' : 'Shows archived deals'}
        />
      </View>
      {!rows.length ? (
        <EmptyState
          icon={HandshakeIcon}
          title="No opportunities yet"
          description="Add one here, or create one from a reply in Email duties."
          action={{ label: 'New opportunity', icon: PlusIcon, onPress: () => open() }}
        />
      ) : !filtered.length ? (
        <EmptyState
          title={search ? 'No matching deals' : archived ? 'No archived deals' : 'No active deals'}
          description={search ? 'Try a different name or email address.' : archived ? 'Archived deals stay saved and can be restored.' : 'Every deal here is archived. Choose “View archived” to see them.'}
          compact
        />
      ) : (
        <ScrollView horizontal showsHorizontalScrollIndicator contentContainerStyle={styles.board}>
          {STAGES.map((stage) => {
            const deals = filtered.filter((d) => d.stage === stage);
            const color = STAGE_TONE[stage];
            return (
              <View key={stage} style={[styles.column, { backgroundColor: alpha(color, 0.07), borderColor: alpha(color, 0.2) }]}>
                <View style={styles.columnHead}>
                  <ThemedText type="smallBold">{STAGE_LABELS[stage]}</ThemedText>
                  <View style={[styles.countChip, { backgroundColor: alpha(color, 0.16) }]}>
                    <Text style={[styles.countText, { color: theme.text }]}>{deals.length}</Text>
                  </View>
                </View>
                <ThemedText type="caption" themeColor="textSecondary">
                  {money(deals.reduce((s, d) => s + Number(d.amount || 0), 0))} known value
                </ThemedText>
                {deals.map(dealCard)}
                {!archived ? (
                  <Button label="Add deal" size="sm" variant="ghost" icon={PlusIcon} onPress={() => open(undefined, 'Deal', { stage })} style={styles.addDeal} accessibilityLabel={`Add a deal in ${STAGE_LABELS[stage]}`} />
                ) : null}
              </View>
            );
          })}
        </ScrollView>
      )}
    </Card>
  );

  const salesAi = (
    <Card>
      <SectionHeader title="Sales AI" subtitle="Let Synq help with your outreach." icon={<IconTile icon={SparkIcon} color={DataColors.sales} size={36} />} />
      <View>
        {[
          {
            title: 'Write cold emails',
            subtitle:
              emailError || !campaignRows.length
                ? 'Create an email duty with an AI draft'
                : `${campaignRows.length} email ${campaignRows.length === 1 ? 'duty' : 'duties'} · ${campaignRows.filter((c) => c.status === 'active').length} active`,
            icon: MailIcon, color: DataColors.sales, onPress: () => router.setParams({ compose: '1', view: 'email' }) },
          { title: 'Ask Sales AI', subtitle: 'Get help with targeting, replies and follow-ups', icon: SparkIcon, color: DataColors.marketing, onPress: () => router.setParams({ ai: '1', department: 'sales' }) },
          { title: 'Import leads', subtitle: 'Bring contacts in from a spreadsheet', icon: UploadIcon, color: DataColors.company, onPress: () => router.push('/import-leads') },
          { title: 'Prepare a quotation', subtitle: 'Start a draft quote for an opportunity', icon: FileTextIcon, color: '#16A34A', onPress: () => open(undefined, 'Quotation') },
        ].map((item, index, list) => (
          <ListRow
            key={item.title}
            title={item.title}
            subtitle={item.subtitle}
            leading={<IconTile icon={item.icon} color={item.color} size={36} />}
            onPress={item.onPress}
            divider={index < list.length - 1}
          />
        ))}
      </View>
    </Card>
  );

  const whatsNext = (
    <Card>
      <SectionHeader
        title="What's next?"
        subtitle="Next steps saved on open opportunities"
        action={nextActions.length ? <StatusBadge label={`${nextActions.length} ${nextActions.length === 1 ? 'step' : 'steps'}`} dot={false} /> : undefined}
      />
      {!nextActions.length ? (
        <EmptyState
          icon={ClockIcon}
          title="No next steps yet"
          description="Add a next action inside an opportunity to build your follow-up list."
          action={{ label: 'Plan a meeting', onPress: () => open(undefined, 'Meeting') }}
          compact
        />
      ) : (
        <View>
          {nextActions.slice(0, 5).map((d, index, list) => {
            const overdue = d.next_action_on && d.next_action_on < today;
            return (
              <ListRow
                key={d.id}
                title={d.next_action}
                subtitle={`${d.title} · ${d.next_action_on || 'No due date'}`}
                leading={<IconTile icon={overdue ? ClockIcon : TargetIcon} color={overdue ? '#DC2626' : DataColors.sales} size={34} />}
                trailing={overdue ? <StatusBadge label="Overdue" tone="danger" /> : undefined}
                onPress={() => open(d)}
                chevron={!overdue}
                divider={index < list.length - 1}
              />
            );
          })}
        </View>
      )}
    </Card>
  );

  const targetsBody = target ? (
    <View style={styles.targets}>
      {revenueGoal > 0 ? (
        <View style={styles.targetRow}>
          <View style={styles.targetHead}>
            <ThemedText type="small">Revenue won</ThemedText>
            <ThemedText type="smallBold">
              {money(stats.wonValue)} / {money(revenueGoal)}
            </ThemedText>
          </View>
          <ProgressBar value={stats.wonValue / revenueGoal} label="Revenue target progress" />
          <ThemedText type="caption" themeColor="textSecondary">
            {Math.round((stats.wonValue / revenueGoal) * 100)}% of the revenue target
          </ThemedText>
        </View>
      ) : null}
      {dealsGoal > 0 ? (
        <View style={styles.targetRow}>
          <View style={styles.targetHead}>
            <ThemedText type="small">Deals won</ThemedText>
            <ThemedText type="smallBold">
              {stats.won.length} / {dealsGoal}
            </ThemedText>
          </View>
          <ProgressBar value={stats.won.length / dealsGoal} color={DataColors.company} label="Deals target progress" />
        </View>
      ) : null}
    </View>
  ) : (
    <EmptyState
      icon={TargetIcon}
      title="No target for this month"
      description={owner ? 'Set a monthly company goal to track progress.' : 'Your company owner can set a monthly target.'}
      action={owner ? { label: 'Set target', onPress: openTarget } : undefined}
      compact
    />
  );

  const targetsSummary = (
    <Card>
      <SectionHeader title="Targets" subtitle={monthLabel} action={<LinkButton label="Details" icon={ArrowIcon} onPress={() => selectTab('targets')} />} />
      {targetsBody}
    </Card>
  );

  const activityItems = [
    ...leadRows.map((lead) => ({ type: 'leads' as const, label: `New lead: ${lead.name || lead.company || lead.email || 'New contact'}`, at: lead.created_at, icon: UserIcon, color: DataColors.company })),
    ...meetingRows.map((meeting) => ({ type: 'meetings' as const, label: `Meeting scheduled: ${meeting.title}`, at: meeting.created_at, icon: CalendarIcon, color: DataColors.marketing })),
    ...rows.map((deal) => ({ type: 'deals' as const, label: `Opportunity updated: ${deal.title}`, at: deal.updated_at, icon: HandshakeIcon, color: DataColors.sales })),
  ]
    .filter((item) => activityFilter === 'all' || item.type === activityFilter)
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, 6);

  const recentActivity = (
    <Card>
      <SectionHeader title="Recent sales activity" />
      <FilterChips
        label="Filter sales activity"
        value={activityFilter}
        onChange={setActivityFilter}
        items={[
          { key: 'all', label: 'All' },
          { key: 'leads', label: 'Leads' },
          { key: 'meetings', label: 'Meetings' },
          { key: 'deals', label: 'Opportunities' },
        ]}
      />
      {meetingError ? <InlineAlert tone="warning" message={meetingError} /> : null}
      {!activityItems.length ? (
        <EmptyState icon={ChartIcon} title="No sales activity yet" description="New leads, meetings and opportunities appear here." compact />
      ) : (
        <View>
          {activityItems.map((item, index) => (
            <ListRow
              key={`${item.at}-${index}`}
              title={item.label}
              subtitle={relativeTime(item.at)}
              leading={<IconTile icon={item.icon} color={item.color} size={34} />}
              divider={index < activityItems.length - 1}
            />
          ))}
        </View>
      )}
    </Card>
  );

  const upcomingCard = (
    <Card>
      <SectionHeader title="Upcoming meetings" action={<LinkButton label="View all" icon={ArrowIcon} onPress={() => selectTab('meetings')} />} />
      {!upcoming.length ? (
        <EmptyState
          icon={CalendarIcon}
          title="No upcoming meetings"
          description="Plan one in Meetings; the people you invite will see it too."
          action={{ label: 'Plan a meeting', onPress: () => selectTab('meetings') }}
          compact
        />
      ) : (
        <View>
          {upcoming.slice(0, 4).map((meeting, index, list) => (
            <ListRow
              key={meeting.id}
              title={meeting.title}
              subtitle={meeting.when}
              leading={<IconTile icon={CalendarIcon} color={DataColors.marketing} size={36} />}
              onPress={() => (meeting.deal ? open(meeting.deal, 'Meeting') : selectTab('meetings'))}
              divider={index < list.length - 1}
            />
          ))}
        </View>
      )}
    </Card>
  );

  const shownLeads = leadRows.filter((lead) =>
    `${lead.name ?? ''} ${lead.company ?? ''} ${lead.email ?? ''} ${lead.phone ?? ''}`.toLowerCase().includes(leadSearch.toLowerCase()),
  );
  const leadsTab = (
    <Card>
      <SectionHeader
        title="Leads"
        subtitle={`${leadRows.length} ${leadRows.length === 1 ? 'contact' : 'contacts'} in your CRM. Select one to start an opportunity with their details.`}
        action={<Button label="Import leads" size="sm" icon={UploadIcon} onPress={() => router.push('/import-leads')} />}
      />
      {leadRows.length ? <SearchInput placeholder="Search by name, company, email or phone" value={leadSearch} onChangeText={setLeadSearch} /> : null}
      <DataTable
        rows={shownLeads}
        rowKey={(lead) => lead.id}
        rowLabel={(lead) => `Start an opportunity with ${lead.name || lead.company || lead.email || 'this lead'}`}
        onRowPress={(lead) =>
          open(undefined, 'Deal', {
            title: `${lead.company || lead.name || 'New opportunity'}`.slice(0, 160),
            contact_name: lead.name || '',
            contact_email: lead.email || '',
            company: lead.company || '',
          })
        }
        columns={[
          {
            key: 'name',
            title: 'Contact',
            flex: 1.6,
            render: (lead) => (
              <View>
                <ThemedText type="smallBold" numberOfLines={1}>
                  {lead.name || lead.company || 'Unnamed contact'}
                </ThemedText>
                {lead.name && lead.company ? (
                  <ThemedText type="caption" themeColor="textSecondary" numberOfLines={1}>
                    {lead.company}
                  </ThemedText>
                ) : null}
              </View>
            ),
          },
          { key: 'email', title: 'Email', flex: 1.6, render: (lead) => <ThemedText type="small" numberOfLines={1}>{lead.email || '—'}</ThemedText> },
          { key: 'phone', title: 'Phone', flex: 1, hideOnCompact: true, render: (lead) => <ThemedText type="small" numberOfLines={1}>{lead.phone || '—'}</ThemedText> },
          {
            key: 'status',
            title: 'Status',
            flex: 0.9,
            render: (lead) => <StatusBadge label={lead.status.charAt(0).toUpperCase() + lead.status.slice(1)} tone={LEAD_TONE[lead.status] ?? 'neutral'} />,
          },
          {
            key: 'added',
            title: 'Added',
            flex: 0.9,
            hideOnCompact: true,
            render: (lead) => (
              <ThemedText type="caption" themeColor="textSecondary">
                {new Date(lead.created_at).toLocaleDateString()}
              </ThemedText>
            ),
          },
        ]}
        empty={
          <EmptyState
            icon={UsersIcon}
            title={leadSearch ? 'No matching leads' : 'No leads yet'}
            description={leadSearch ? 'Try another name or email.' : 'Import a spreadsheet of contacts to build your CRM.'}
            action={leadSearch ? undefined : { label: 'Import leads', icon: UploadIcon, onPress: () => router.push('/import-leads') }}
          />
        }
      />
    </Card>
  );

  const targetsTab = (
    <>
      <Card>
        <SectionHeader
          title={`${monthLabel} targets`}
          subtitle="Based on deals marked Won this month, including archived wins. This is recorded deal value, not a payment or accounting report. All values are INR."
          action={owner ? <Button label={target ? 'Edit target' : 'Set target'} variant="primary" size="sm" onPress={openTarget} /> : undefined}
        />
        {targetsBody}
      </Card>
      <Split
        ratio={1}
        main={
          <Card>
            <SectionHeader title="Why deals were lost" subtitle="All recorded losses, including archived deals. Use them to improve the next conversation." />
            {!reasons.size ? (
              <EmptyState title="No lost-deal reasons recorded yet" compact />
            ) : (
              <View>
                {[...reasons]
                  .sort((a, b) => b[1] - a[1])
                  .map(([reason, count], index, list) => (
                    <ListRow key={reason} title={reason || 'No reason given'} trailing={<ThemedText type="smallBold">{count}</ThemedText>} divider={index < list.length - 1} />
                  ))}
              </View>
            )}
          </Card>
        }
        side={rows.length > 0 ? <DepartmentActivityChart department="sales" /> : <View />}
      />
    </>
  );

  const body = !loaded ? (
    <LoadingState label="Loading your sales workspace…" />
  ) : error ? (
    <ErrorState message={error} onRetry={() => void refresh()} />
  ) : current === 'overview' ? (
    // The mockup's layout: work on the left, help and goals on the right.
    <Split
      ratio={2.6}
      breakAt={1180}
      main={
        <>
          {kpis}
          {pipeline}
          <Split ratio={1.15} breakAt={1500} main={recentActivity} side={upcomingCard} />
        </>
      }
      side={
        <>
          {salesAi}
          {whatsNext}
          {targetsSummary}
        </>
      }
    />
  ) : current === 'leads' ? (
    leadsTab
  ) : current === 'meetings' ? (
    <SalesMeetings legacyMeetings={stats.active.filter((deal) => deal.meeting_on)} onEditLegacy={(deal) => open(deal, 'Meeting')} />
  ) : (
    targetsTab
  );

  return (
    <View style={styles.fill}>
      {emailVisible ? (
        <EmailOutreach
          header={header}
          onCreateDeal={(recipient, campaign) => {
            try {
              const input = opportunityFromEmail(recipient, campaign);
              open();
              setDraft(input);
              setBaseline(JSON.stringify(input));
              router.setParams({ view: 'overview', compose: '0' });
            } catch (e) {
              setError((e as Error).message);
            }
          }}
        />
      ) : (
        <ScrollView style={styles.fill} contentContainerStyle={[styles.page, { padding: isCompact ? Spacing.three : 28 }]}>
          {header}
          {body}
        </ScrollView>
      )}

      <Modal visible={editor} animationType="slide" onRequestClose={close}>
        <View style={[styles.fill, { backgroundColor: theme.background }]}>
          <View style={[styles.editorHeader, { borderBottomColor: theme.border, backgroundColor: theme.surface }]}>
            <View style={styles.grow}>
              <ThemedText type="sectionTitle" accessibilityRole="header">
                {editing ? 'Edit opportunity' : 'New opportunity'}
              </ThemedText>
              <ThemedText type="caption" themeColor="textSecondary">
                Company members share this opportunity. Values are INR.
              </ThemedText>
            </View>
            <IconButton icon={XIcon} label="Close" onPress={close} disabled={busy} variant="outline" />
          </View>
          <ScrollView contentContainerStyle={[styles.editorBody, { padding: isCompact ? 16 : 28 }]} keyboardShouldPersistTaps="handled">
            <ChoiceGroup
              label="Opportunity section"
              value={section}
              disabled={busy}
              onChange={(part) => {
                setSection(part);
                setCrm(null);
              }}
              options={[
                { value: 'Deal', label: 'Deal' },
                { value: 'Meeting', label: 'Meeting' },
                { value: 'Quotation', label: 'Quotation' },
              ]}
            />
            {formError ? <InlineAlert tone="danger" message={formError} /> : null}
            {formNotice ? <InlineAlert tone="success" message={formNotice} /> : null}
            {section === 'Deal' ? (
              <Card>
                <Field label="Deal name" required count={{ value: draft.title.length, max: 160 }}>
                  <TextField accessibilityLabel="Deal name" placeholder="e.g. Website package for Acme" value={draft.title} maxLength={160} onChangeText={(v) => field('title', v)} />
                </Field>
                <Field label="Stage">
                  <ChoiceGroup label="Stage" value={draft.stage} onChange={(stage) => field('stage', stage)} options={STAGES.map((stage) => ({ value: stage, label: STAGE_LABELS[stage] }))} />
                </Field>
                {draft.stage === 'lost' ? (
                  <Field label="Why was the deal lost?" required>
                    <TextField accessibilityLabel="Lost deal reason" value={draft.lost_reason} maxLength={500} placeholder="Price, timing, competitor, no response…" onChangeText={(v) => field('lost_reason', v)} />
                  </Field>
                ) : null}
                <FieldRow>
                  <Grow>
                    <Field label="Value (INR)" helper="Optional. Leave blank if unknown.">
                      <TextField
                        accessibilityLabel="Deal value in INR"
                        keyboardType="decimal-pad"
                        placeholder="e.g. 25000"
                        value={amountText}
                        onChangeText={(v) => {
                          setAmountText(v);
                          field('amount', v.trim() === '' ? null : Number(v));
                        }}
                      />
                    </Field>
                  </Grow>
                  <Grow>
                    <Field label="Expected close" helper="YYYY-MM-DD">
                      <TextField accessibilityLabel="Expected closing date" placeholder="YYYY-MM-DD" value={draft.expected_close || ''} maxLength={10} onChangeText={(v) => field('expected_close', v || null)} />
                    </Field>
                  </Grow>
                </FieldRow>
                <FieldRow>
                  <Grow>
                    <Field label="Next action" helper="Shows in What's next until the deal closes.">
                      <TextField accessibilityLabel="Next action" placeholder="e.g. Send the proposal" value={draft.next_action} maxLength={500} onChangeText={(v) => field('next_action', v)} />
                    </Field>
                  </Grow>
                  <Grow>
                    <Field label="Next action due" helper="YYYY-MM-DD">
                      <TextField accessibilityLabel="Next action due date" placeholder="YYYY-MM-DD" value={draft.next_action_on || ''} maxLength={10} onChangeText={(v) => field('next_action_on', v || null)} />
                    </Field>
                  </Grow>
                </FieldRow>
              </Card>
            ) : null}
            {section === 'Deal' ? (
              <Card>
                <SectionHeader title="Contact" size="card" action={<Button label="Choose from CRM" size="sm" icon={UsersIcon} disabled={busy} onPress={() => void chooseCrm()} />} />
                {crm ? (
                  <Card tone="muted">
                    <SearchInput accessibilityLabel="Search CRM contacts" placeholder="Search CRM contacts" value={crmSearch} onChangeText={setCrmSearch} />
                    <ScrollView style={styles.crmList}>
                      {crm
                        .filter((l) => (l.name + ' ' + l.company + ' ' + l.email).toLowerCase().includes(crmSearch.toLowerCase()))
                        .slice(0, 50)
                        .map((l) => (
                          <ListRow
                            key={l.id}
                            title={l.name || l.company || 'Unnamed contact'}
                            subtitle={l.email || 'No email saved'}
                            onPress={() => {
                              setDraft((d) => ({ ...d, contact_name: l.name || '', contact_email: l.email || '', company: l.company || '' }));
                              setCrm(null);
                            }}
                          />
                        ))}
                    </ScrollView>
                    <ThemedText type="caption" themeColor="textSecondary">
                      Showing up to 50 matches. Type to narrow the list.
                    </ThemedText>
                    <Button label="Close contact picker" size="sm" onPress={() => setCrm(null)} />
                  </Card>
                ) : null}
                <FieldRow>
                  <Grow>
                    <Field label="Contact name">
                      <TextField accessibilityLabel="Contact name" value={draft.contact_name} maxLength={120} onChangeText={(v) => field('contact_name', v)} />
                    </Field>
                  </Grow>
                  <Grow>
                    <Field label="Company">
                      <TextField accessibilityLabel="Contact company" value={draft.company} maxLength={120} onChangeText={(v) => field('company', v)} />
                    </Field>
                  </Grow>
                </FieldRow>
                <Field label="Contact email">
                  <TextField accessibilityLabel="Contact email" keyboardType="email-address" value={draft.contact_email} maxLength={254} onChangeText={(v) => field('contact_email', v)} />
                </Field>
                <Field label="Deal notes" count={{ value: draft.notes.length, max: 5000 }}>
                  <TextField accessibilityLabel="Deal notes" multiline style={{ minHeight: 120 }} value={draft.notes} maxLength={5000} onChangeText={(v) => field('notes', v)} />
                </Field>
                {editing ? (
                  <View style={styles.archiveRow}>
                    <Button
                      label={draft.archived ? 'Restore to active pipeline' : 'Archive this deal'}
                      size="sm"
                      onPress={() => field('archived', !draft.archived)}
                    />
                    <ThemedText type="caption" themeColor="textSecondary" style={styles.grow}>
                      {draft.archived ? 'This deal will be archived when you save. You can restore it later.' : 'Archiving keeps its history.'}
                    </ThemedText>
                  </View>
                ) : null}
              </Card>
            ) : null}
            {section === 'Meeting' ? (
              <Card>
                <SectionHeader title="Meeting or demo" size="card" subtitle="Meeting times are local wall-clock time; this does not create a calendar event." />
                <FieldRow>
                  <Grow>
                    <Field label="Meeting date" helper="YYYY-MM-DD">
                      <TextField
                        accessibilityLabel="Meeting date"
                        placeholder="YYYY-MM-DD"
                        value={draft.meeting_on || ''}
                        maxLength={10}
                        onChangeText={(v) => setDraft((d) => ({ ...d, meeting_on: v || null, meeting_time: v ? d.meeting_time : '' }))}
                      />
                    </Field>
                  </Grow>
                  <Grow>
                    <Field label="Local time" helper="HH:mm, 24-hour">
                      <TextField accessibilityLabel="Meeting time" placeholder="14:30" value={draft.meeting_time} maxLength={5} onChangeText={(v) => field('meeting_time', v)} />
                    </Field>
                  </Grow>
                </FieldRow>
                <Field label="Status">
                  <ChoiceGroup
                    label="Meeting status"
                    value={draft.meeting_status}
                    onChange={(s) => field('meeting_status', s)}
                    options={[
                      { value: 'planned', label: 'Planned' },
                      { value: 'held', label: 'Held' },
                      { value: 'no_show', label: 'No show' },
                      { value: 'cancelled', label: 'Cancelled' },
                    ]}
                  />
                </Field>
                <Field label="Meeting notes or outcome" count={{ value: draft.meeting_notes.length, max: 3000 }}>
                  <TextField accessibilityLabel="Meeting notes" multiline style={{ minHeight: 120 }} value={draft.meeting_notes} maxLength={3000} onChangeText={(v) => field('meeting_notes', v)} />
                </Field>
              </Card>
            ) : null}
            {section === 'Quotation' ? (
              <Card>
                <SectionHeader
                  title="Prepare a quotation"
                  size="card"
                  subtitle="Start from the deal details, then add scope, taxes, validity and payment terms yourself. Existing text is kept unless you replace it. Nothing is sent automatically."
                />
                {!draft.quote_text ? (
                  <Button label="Create quotation template" variant="primary" icon={FileTextIcon} onPress={() => field('quote_text', quoteDraft(draft))} />
                ) : null}
                <Field label="Quotation draft" count={{ value: draft.quote_text.length, max: 12000 }}>
                  <TextField
                    accessibilityLabel="Quotation draft"
                    multiline
                    placeholder="Write or generate your quotation here…"
                    value={draft.quote_text}
                    maxLength={12000}
                    style={{ minHeight: 320 }}
                    onChangeText={(v) => field('quote_text', v)}
                  />
                </Field>
                <ButtonRow>
                  <Button
                    label="Copy draft"
                    size="sm"
                    disabled={!draft.quote_text || Platform.OS !== 'web'}
                    onPress={() => {
                      setFormError('');
                      navigator.clipboard
                        .writeText(draft.quote_text)
                        .then(() => setFormNotice('Draft copied.'))
                        .catch(() => setFormError('Could not copy. Select the text or download it instead.'));
                    }}
                  />
                  <Button
                    label="Download .txt"
                    size="sm"
                    icon={DownloadIcon}
                    disabled={!draft.quote_text}
                    onPress={() => {
                      try {
                        download(draft.quote_text, editing ? `synq-quotation-${editing.id.slice(0, 8)}.txt` : 'synq-quotation-draft.txt');
                      } catch (e) {
                        setFormError((e as Error).message);
                      }
                    }}
                  />
                </ButtonRow>
                <ThemedText type="caption" themeColor="textSecondary">
                  Save the opportunity to keep this quotation in your company workspace.
                </ThemedText>
              </Card>
            ) : null}
          </ScrollView>
          <View style={[styles.footer, { borderTopColor: theme.border, backgroundColor: theme.surface }]}>
            <ThemedText type="caption" themeColor="textSecondary" style={styles.grow}>
              {JSON.stringify(draft) !== baseline ? 'Unsaved changes' : 'No changes yet'}
            </ThemedText>
            <ButtonRow>
              <Button label="Cancel" onPress={close} disabled={busy} />
              <Button label={editing ? 'Save changes' : 'Create opportunity'} variant="primary" loading={busy} onPress={() => void save()} />
            </ButtonRow>
          </View>
        </View>
      </Modal>

      <ModalSheet visible={discard} onClose={() => setDiscard(false)} title="Discard unsaved changes?" description="Your saved opportunity stays unchanged.">
        <ButtonRow style={styles.endRow}>
          <Button
            label="Discard changes"
            variant="dangerOutline"
            onPress={() => {
              setDiscard(false);
              setEditor(false);
            }}
          />
          <Button label="Keep editing" variant="primary" onPress={() => setDiscard(false)} />
        </ButtonRow>
      </ModalSheet>

      <ModalSheet
        visible={targetOpen}
        onClose={() => {
          if (!busy) setTargetOpen(false);
        }}
        title="Monthly company target"
        description={`${monthLabel} · INR · Only the company owner can change this.`}
      >
        <Field label="Revenue target (INR)">
          <TextField accessibilityLabel="Monthly revenue target" keyboardType="decimal-pad" value={goalRevenue} onChangeText={setGoalRevenue} />
        </Field>
        <Field label="Deals to win">
          <TextField accessibilityLabel="Monthly deals target" keyboardType="number-pad" value={goalDeals} onChangeText={setGoalDeals} />
        </Field>
        {targetError ? <InlineAlert tone="danger" message={targetError} /> : null}
        <ButtonRow style={styles.endRow}>
          <Button label="Cancel" disabled={busy} onPress={() => setTargetOpen(false)} />
          <Button
            label="Save target"
            variant="primary"
            loading={busy}
            disabled={!goalRevenue.trim() || !goalDeals.trim()}
            onPress={async () => {
              setBusy(true);
              setTargetError('');
              try {
                await saveTarget(identity!.membership!.organization_id, month, Number(goalRevenue), parseDealsTarget(goalDeals), target);
                setTargetOpen(false);
                showToast('Target saved.');
                await refresh();
              } catch (e) {
                setTargetError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          />
        </ButtonRow>
      </ModalSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, minHeight: 0 },
  page: { gap: 20, paddingBottom: 72, width: '100%', maxWidth: PageMaxWidth, alignSelf: 'center' },
  headerBlock: { gap: 18 },
  grow: { flex: 1, minWidth: 0 },
  kpis: { flexDirection: 'row', flexWrap: 'wrap', gap: 16 },
  kpiCell: { flexGrow: 1, minWidth: 0 },
  toolbar: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 10 },
  toolbarSearch: { flexGrow: 1, flexBasis: 240 },
  board: { gap: 12, paddingBottom: 6 },
  column: { width: 232, gap: 10, padding: 12, borderRadius: Radius.control + 4, borderWidth: 1, alignSelf: 'flex-start' },
  columnHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  countChip: { minWidth: 24, height: 22, paddingHorizontal: 7, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  countText: { fontSize: 12, fontWeight: '700' },
  deal: { gap: 5, padding: 12, borderWidth: 1, borderRadius: Radius.control + 2 },
  addDeal: { alignSelf: 'stretch' },
  targets: { gap: 18 },
  targetRow: { gap: 8 },
  targetHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  fieldRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 14 },
  fieldCell: { flexGrow: 1, flexBasis: 240, minWidth: 0 },
  editorHeader: { flexDirection: 'row', alignItems: 'center', gap: 16, paddingHorizontal: 24, paddingVertical: 18, borderBottomWidth: 1 },
  editorBody: { gap: 16, width: '100%', maxWidth: 920, alignSelf: 'center', paddingBottom: 40 },
  crmList: { maxHeight: 240 },
  archiveRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 12 },
  footer: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 12, paddingHorizontal: 24, paddingVertical: 14, borderTopWidth: 1 },
  endRow: { justifyContent: 'flex-end' },
});
