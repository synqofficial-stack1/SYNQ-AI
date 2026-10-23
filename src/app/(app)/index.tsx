import { LinearGradient } from 'expo-linear-gradient';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState, type ComponentType, type ReactNode } from 'react';
import { Platform, Pressable, StyleSheet, Text, TextInput, View, type LayoutChangeEvent, type TextStyle } from 'react-native';

import { MultiLineChart } from '@/components/charts';
import {
  ArrowIcon,
  ArrowUpRightIcon,
  BuildingIcon,
  CalendarIcon,
  ChartIcon,
  CheckIcon,
  ClipboardIcon,
  ClockIcon,
  LayersIcon,
  MailIcon,
  MegaphoneIcon,
  PlayIcon,
  PlugIcon,
  PlusIcon,
  SendIcon,
  SparkIcon,
  TargetIcon,
  UserIcon,
  UsersIcon,
  VideoIcon,
  type IconProps,
} from '@/components/icons';
import { ThemedText } from '@/components/themed-text';
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  IconTile,
  KpiCard,
  LinkButton,
  ListRow,
  Page,
  Popover,
  ProgressBar,
  SectionHeader,
  Select,
  SkeletonList,
  StatusBadge,
  showToast,
  transition,
  type Tone,
} from '@/components/ui';
import { DataColors, Radius } from '@/constants/theme';
import { useSession } from '@/hooks/use-session';
import { useTheme } from '@/hooks/use-theme';
import { useWorkspace } from '@/hooks/use-workspace';
import { subscribeAnalytics } from '@/lib/analytics-events';
import { setWorkspaceTaskStatus } from '@/lib/organization';
import { loadSales, loadTarget, localDate, money, salesSummary, type SalesTarget } from '@/lib/sales-workspace';
import { supabase } from '@/lib/supabase';
import {
  compare,
  loadDashboard,
  meetingTime,
  relativeTime,
  type ActivityEntry,
  type DashboardData,
  type DashboardRange,
} from '@/lib/workspace';

// The dashboard. Every number on this screen is counted from the signed-in
// person's own rows (see lib/workspace.ts) — there is no sample series, no
// seeded activity and no analytics service behind any of it. Where something
// has not happened yet, the card says so instead of showing a plausible fake.

const ANALYTICS_TABLES = [
  'tasks',
  'sales_runs',
  'prospects',
  'calls',
  'videos',
  'messages',
  'leads',
  'social_posts',
  'sales_meetings',
  'organization_tasks',
  'outreach_campaigns',
] as const;

const VIDEO_COLOR = '#E0533D';

const RANGES: { value: `${DashboardRange}`; label: string }[] = [
  { value: '7', label: 'Last 7 days' },
  { value: '14', label: 'Last 14 days' },
  { value: '30', label: 'Last 30 days' },
];

type Go = Parameters<typeof router.push>[0];
const go = (path: string) => router.push(path as Go);

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

function toneFor(status: string): Tone {
  if (/completed|published|added|replied/i.test(status)) return 'success';
  if (/failed/i.test(status)) return 'danger';
  if (/attention|waiting/i.test(status)) return 'warning';
  if (/running|progress|scheduled|processing|publishing|ready/i.test(status)) return 'info';
  return 'neutral';
}

const KIND_ICON: Record<ActivityEntry['kind'], { icon: ComponentType<IconProps>; color: string }> = {
  task: { icon: SparkIcon, color: DataColors.sales },
  sales_run: { icon: TargetIcon, color: DataColors.sales },
  post: { icon: PlayIcon, color: VIDEO_COLOR },
  meeting: { icon: CalendarIcon, color: DataColors.marketing },
  lead: { icon: UserIcon, color: DataColors.company },
  email: { icon: MailIcon, color: DataColors.sales },
};

/** Opens the assistant with a prompt already sent, so the real chat answers it. */
function askSynq(prompt?: string) {
  router.setParams({ ai: '1', department: 'general', prompt: prompt || undefined });
}

function Welcome({ firstName, companyName }: { firstName: string; companyName: string }) {
  const theme = useTheme();
  const createAnchor = useRef<View>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const create = (path: string) => {
    setCreateOpen(false);
    go(path);
  };
  return (
    <View style={[styles.welcome, { borderColor: theme.border, backgroundColor: theme.surface }]}>
      <LinearGradient
        pointerEvents="none"
        colors={[theme.accentSoft, theme.surface]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0.6 }}
        style={StyleSheet.absoluteFill}
      />
      <View style={styles.welcomeBody}>
        <ThemedText type="label" themeColor="textSecondary">
          {greeting()},
        </ThemedText>
        <ThemedText type="title" style={styles.welcomeName} numberOfLines={1}>
          {firstName} 👋
        </ThemedText>
        <ThemedText type="default" themeColor="textSecondary" style={styles.welcomeText}>
          Your AI workforce is ready. What do you want to work on today?
        </ThemedText>
        {companyName ? (
          <ThemedText type="caption" themeColor="textSecondary">
            {companyName} workspace · Sales, Marketing and Company departments
          </ThemedText>
        ) : null}
      </View>
      <View style={styles.welcomeActions}>
        <View ref={createAnchor} collapsable={false}>
          <Button label="Create" variant="primary" icon={PlusIcon} onPress={() => setCreateOpen(true)} accessibilityLabel="Create something new" />
        </View>
      </View>
      {/* Every quick action lives here, so the dashboard has one place to start things. */}
      <Popover anchorRef={createAnchor} visible={createOpen} onClose={() => setCreateOpen(false)} label="Create" width={290}>
        {[
          { label: 'Email', hint: 'Send one email from your Gmail', icon: SendIcon, path: '/sales?send=1' },
          { label: 'Email duty', hint: 'AI-drafted outreach to many people', icon: MailIcon, path: '/sales?compose=1' },
          { label: 'Reel', hint: 'Upload a video and publish it', icon: VideoIcon, path: '/marketing?view=create' },
          { label: 'Meeting', hint: 'Plan a sales meeting', icon: CalendarIcon, path: '/sales?view=meetings' },
          { label: 'Team task', hint: 'Assign work to a teammate', icon: ClipboardIcon, path: '/company?tab=tasks' },
          { label: 'Connect accounts', hint: 'Link YouTube, Instagram or X', icon: PlugIcon, path: '/plugins' },
          { label: 'View activity', hint: 'Everything you have done in Synq', icon: ClockIcon, path: '/history' },
        ].map((item) => (
          <Pressable
            key={item.label}
            accessibilityRole="menuitem"
            accessibilityLabel={`${item.label}: ${item.hint}`}
            onPress={() => create(item.path)}
            style={({ hovered }) => [styles.menuItem, hovered && { backgroundColor: theme.surfaceRaised }]}
          >
            <item.icon size={17} color={theme.textSecondary} />
            <View style={styles.menuText}>
              <ThemedText type="smallBold">{item.label}</ThemedText>
              <ThemedText type="caption" themeColor="textSecondary">
                {item.hint}
              </ThemedText>
            </View>
          </Pressable>
        ))}
      </Popover>
    </View>
  );
}

const SUGGESTIONS = [
  'Write a cold email for my business',
  'Plan a week of Instagram posts',
  'Summarize my workspace activity',
  'Ideas for a 30-second reel',
];

const noOutline = Platform.select({ web: { outlineStyle: 'none' } as unknown as TextStyle, default: null });

/** A doorway into the real assistant: whatever is typed here is sent there. */
function AskSynqPanel() {
  const [text, setText] = useState('');
  const send = () => {
    const prompt = text.trim();
    if (!prompt) return;
    setText('');
    askSynq(prompt);
  };
  return (
    <View style={styles.ask}>
      <View style={styles.askHead}>
        <SparkIcon size={20} color="#FFD45A" />
        <View style={styles.askTitle}>
          <Text style={styles.askHeading}>Ask Synq</Text>
          <Text style={styles.askSub}>Your AI business partner</Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Open the full assistant"
          onPress={() => askSynq()}
          style={({ hovered }) => [styles.askExpand, transition, hovered && { backgroundColor: 'rgba(255,255,255,0.08)' }]}
        >
          <ArrowUpRightIcon size={16} color="#A9A59C" />
        </Pressable>
      </View>
      <View style={styles.askInputRow}>
        <TextInput
          value={text}
          onChangeText={setText}
          onSubmitEditing={send}
          placeholder="Tell me what you want to do…"
          placeholderTextColor="#8C887F"
          accessibilityLabel="Ask Synq"
          returnKeyType="send"
          style={[styles.askInput, noOutline]}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Send to Synq"
          accessibilityState={{ disabled: !text.trim() }}
          disabled={!text.trim()}
          onPress={send}
          style={({ hovered }) => [styles.askSend, transition, { opacity: text.trim() ? 1 : 0.5, backgroundColor: hovered ? '#EAB938' : '#FFD45A' }]}
        >
          <ArrowIcon size={16} color="#171717" />
        </Pressable>
      </View>
      <View style={styles.askChips}>
        {SUGGESTIONS.map((suggestion) => (
          <Pressable
            key={suggestion}
            accessibilityRole="button"
            accessibilityLabel={`Use suggestion: ${suggestion}`}
            onPress={() => setText(suggestion)}
            style={({ hovered }) => [styles.askChip, transition, hovered && { borderColor: 'rgba(255,212,90,0.5)' }]}
          >
            <Text style={styles.askChipText}>{suggestion}</Text>
          </Pressable>
        ))}
      </View>
      <Text style={styles.askNote}>Each message uses 1 daily AI credit.</Text>
    </View>
  );
}

/** This month's company target, the same numbers Sales shows. */
function TargetsCard({ attempt }: { attempt: number }) {
  const [state, setState] = useState<{ target: SalesTarget | null; wonValue: number; wonDeals: number } | null>(null);
  const [failed, setFailed] = useState(false);
  const month = localDate().slice(0, 7) + '-01';
  useEffect(() => {
    let live = true;
    Promise.all([loadTarget(month), loadSales()])
      .then(([target, deals]) => {
        if (!live) return;
        const summary = salesSummary(deals);
        setState({ target, wonValue: summary.wonValue, wonDeals: summary.won.length });
        setFailed(false);
      })
      .catch(() => {
        if (live) setFailed(true);
      });
    return () => {
      live = false;
    };
  }, [attempt, month]);
  const monthLabel = new Date(month + 'T12:00:00').toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  const revenueGoal = Number(state?.target?.revenue_goal ?? 0);
  const dealsGoal = Number(state?.target?.deals_goal ?? 0);
  return (
    <Card>
      <SectionHeader title="Targets" subtitle={monthLabel} action={<LinkButton label="Details" icon={ArrowIcon} onPress={() => go('/sales?view=targets')} />} />
      {failed ? (
        <EmptyState icon={TargetIcon} title="Targets are unavailable" description="Could not load this month's target. Try again in a moment." compact />
      ) : !state ? (
        <SkeletonList rows={2} />
      ) : !state.target || (revenueGoal <= 0 && dealsGoal <= 0) ? (
        <EmptyState
          icon={TargetIcon}
          title="No target for this month"
          description="Your company owner can set a monthly goal in Sales."
          action={{ label: 'Open targets', onPress: () => go('/sales?view=targets') }}
          compact
        />
      ) : (
        <View style={styles.targets}>
          {revenueGoal > 0 ? (
            <View style={styles.targetRow}>
              <View style={styles.targetHead}>
                <ThemedText type="small">Revenue won</ThemedText>
                <ThemedText type="smallBold">
                  {money(state.wonValue)} / {money(revenueGoal)}
                </ThemedText>
              </View>
              <ProgressBar value={state.wonValue / revenueGoal} label="Revenue target progress" />
            </View>
          ) : null}
          {dealsGoal > 0 ? (
            <View style={styles.targetRow}>
              <View style={styles.targetHead}>
                <ThemedText type="small">Deals won</ThemedText>
                <ThemedText type="smallBold">
                  {state.wonDeals} / {dealsGoal}
                </ThemedText>
              </View>
              <ProgressBar value={state.wonDeals / dealsGoal} color={DataColors.company} label="Deals target progress" />
            </View>
          ) : null}
        </View>
      )}
    </Card>
  );
}

export default function DashboardScreen() {
  const theme = useTheme();
  const { session } = useSession();
  const { identity } = useWorkspace();
  const [range, setRange] = useState<DashboardRange>(14);
  const [data, setData] = useState<DashboardData | null>(null);
  const [failed, setFailed] = useState(false);
  const [width, setWidth] = useState(0);
  const [completing, setCompleting] = useState<string | null>(null);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // "Try again" and every refresh bump the attempt; the effect below owns every
  // setState, so a reply that lands after the screen is gone is dropped.
  const [attempt, setAttempt] = useState(0);

  useFocusEffect(
    useCallback(() => {
      setAttempt((value) => value + 1);
    }, []),
  );

  const scheduleRefresh = useCallback(() => {
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
    refreshTimer.current = setTimeout(() => {
      refreshTimer.current = null;
      setAttempt((value) => value + 1);
    }, 200);
  }, []);

  useEffect(() => {
    const unsubscribe = subscribeAnalytics(scheduleRefresh);
    let channel = supabase.channel('dashboard-analytics');
    ANALYTICS_TABLES.forEach((table) => {
      channel = channel.on('postgres_changes', { event: '*', schema: 'public', table }, scheduleRefresh);
    });
    channel.subscribe();
    return () => {
      unsubscribe();
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
      void supabase.removeChannel(channel);
    };
  }, [scheduleRefresh]);

  useEffect(() => {
    let live = true;
    loadDashboard(range)
      .then((result) => {
        if (!live) return;
        setData(result);
        setFailed(false);
      })
      .catch(() => {
        if (live) setFailed(true);
      });
    return () => {
      live = false;
    };
  }, [attempt, range]);

  async function completeTask(id: string) {
    setCompleting(id);
    try {
      await setWorkspaceTaskStatus(id, 'completed');
      showToast('Task marked as done.');
      setAttempt((value) => value + 1);
    } catch (cause) {
      showToast(cause instanceof Error ? cause.message : 'Could not update this task.', 'danger');
    } finally {
      setCompleting(null);
    }
  }

  const fullName = identity?.full_name || String(session?.user?.user_metadata?.full_name || session?.user?.user_metadata?.name || '');
  const firstName = fullName.trim().split(/\s+/)[0] || 'there';
  const unavailable = (section: string) => data?.unavailable.includes(section) ?? false;
  const rangeNote = `Last ${range} days`;

  const onLayout = (event: LayoutChangeEvent) => setWidth(event.nativeEvent.layout.width);
  const columns = width >= 1120 ? 3 : width >= 760 ? 2 : 1;

  const kpis = (
    <View style={styles.kpis}>
      {[
        <KpiCard
          key="actions"
          label="Total actions"
          icon={LayersIcon}
          color={DataColors.sales}
          value={data ? (unavailable('activity') ? '—' : String(data.actions.current)) : null}
          trend={data && !unavailable('activity') ? compare(data.actions.current, data.actions.previous) : undefined}
          note={data ? (unavailable('activity') ? 'Could not load activity' : `${rangeNote}${compare(data.actions.current, data.actions.previous) ? ', vs the period before' : ''}`) : undefined}
          spark={data?.days.map((day) => day.total)}
        />,
        <KpiCard
          key="leads"
          label="Leads"
          icon={UsersIcon}
          color={DataColors.company}
          value={data ? (unavailable('leads') ? '—' : String(data.leads.total)) : null}
          note={data ? (unavailable('leads') ? 'Could not load leads' : data.leads.inRange ? `${data.leads.inRange} added, ${rangeNote.toLowerCase()}` : 'In your CRM') : undefined}
          spark={data?.leads.daily}
        />,
        <KpiCard
          key="meetings"
          label="Meetings booked"
          icon={CalendarIcon}
          color={DataColors.marketing}
          value={data ? (unavailable('meetings') ? '—' : String(data.meetings.total)) : null}
          note={data ? (unavailable('meetings') ? 'Could not load meetings' : `${data.meetings.upcoming} upcoming`) : undefined}
          spark={data?.meetings.daily}
          onPress={() => go('/sales?view=meetings')}
        />,
        <KpiCard
          key="videos"
          label="Videos published"
          icon={PlayIcon}
          color={VIDEO_COLOR}
          value={data ? (unavailable('published') ? '—' : String(data.published.total)) : null}
          note={data ? (unavailable('published') ? 'Could not load posts' : data.published.inRange ? `${data.published.inRange} ${rangeNote.toLowerCase()}` : 'To your connected accounts') : undefined}
          spark={data?.published.daily}
          onPress={() => go('/marketing')}
        />,
      ].map((card, index) => (
        <View key={index} style={[styles.kpiCell, { flexBasis: width >= 1120 ? '22%' : width >= 560 ? '40%' : '100%' }]}>
          {card}
        </View>
      ))}
    </View>
  );

  const chart = (
    <Card>
      <SectionHeader
        title="Activity overview"
        subtitle="Actions across your workspace"
        action={
          <Select
            label="Date range"
            size="sm"
            value={`${range}` as `${DashboardRange}`}
            options={RANGES}
            onChange={(value) => setRange(Number(value) as DashboardRange)}
            width={150}
          />
        }
      />
      {!data ? (
        <SkeletonList rows={3} />
      ) : unavailable('activity') ? (
        <ErrorState message="Activity could not be loaded." onRetry={() => setAttempt((value) => value + 1)} />
      ) : data.actions.current === 0 ? (
        <EmptyState
          icon={ChartIcon}
          title="Nothing recorded yet"
          description="Chats, email duties, videos, meetings and team tasks show up here as you work."
          action={{ label: 'Ask Synq', icon: SparkIcon, onPress: () => askSynq() }}
        />
      ) : (
        <>
          <View style={styles.legend}>
            {[
              { label: 'Sales', color: DataColors.sales },
              { label: 'Marketing', color: DataColors.marketing },
              { label: 'Company', color: DataColors.company },
              { label: 'Total', color: theme.text },
            ].map((item) => (
              <View key={item.label} style={styles.legendItem}>
                <View style={[styles.legendDot, { backgroundColor: item.color }]} />
                <ThemedText type="caption" themeColor="textSecondary">
                  {item.label}
                </ThemedText>
              </View>
            ))}
          </View>
          <MultiLineChart
            dates={data.days.map((day) => day.key)}
            height={columns === 1 ? 200 : 236}
            series={[
              { key: 'total', label: 'Total', color: theme.text, values: data.days.map((day) => day.total) },
              { key: 'sales', label: 'Sales', color: DataColors.sales, values: data.days.map((day) => day.sales), fill: true },
              { key: 'marketing', label: 'Marketing', color: DataColors.marketing, values: data.days.map((day) => day.marketing) },
              { key: 'company', label: 'Company', color: DataColors.company, values: data.days.map((day) => day.company) },
            ]}
          />
        </>
      )}
    </Card>
  );

  const departments = (
    <Card>
      <SectionHeader title="Departments" subtitle={`${rangeNote}, compared with the ${range} days before`} />
      {!data ? (
        <SkeletonList rows={3} />
      ) : (
        <View>
          {(
            [
              { key: 'sales', label: 'Sales', icon: ChartIcon, color: DataColors.sales, path: '/sales' },
              { key: 'marketing', label: 'Marketing', icon: MegaphoneIcon, color: DataColors.marketing, path: '/marketing' },
              { key: 'company', label: 'Company', icon: BuildingIcon, color: DataColors.company, path: '/company' },
            ] as const
          ).map((department, index) => {
            const stats = data.departments[department.key];
            const trend = compare(stats.current, stats.previous);
            return (
              <ListRow
                key={department.key}
                title={department.label}
                subtitle={`${stats.current} ${stats.current === 1 ? 'action' : 'actions'}`}
                leading={<IconTile icon={department.icon} color={department.color} size={38} />}
                trailing={
                  trend ? (
                    <Text style={[styles.trend, { color: trend.direction === 'up' ? theme.success : trend.direction === 'down' ? theme.danger : theme.textSecondary }]}>
                      {trend.direction === 'up' ? '↑ ' : trend.direction === 'down' ? '↓ ' : ''}
                      {trend.text}
                    </Text>
                  ) : stats.current === 0 ? (
                    <ThemedText type="caption" themeColor="textSecondary">
                      No activity
                    </ThemedText>
                  ) : null
                }
                onPress={() => go(department.path)}
                accessibilityLabel={`${department.label}: ${stats.current} actions. Open ${department.label}`}
                divider={index < 2}
              />
            );
          })}
        </View>
      )}
    </Card>
  );

  const recent = (
    <Card>
      <SectionHeader title="Recent activity" action={<LinkButton label="View all" icon={ArrowIcon} onPress={() => go('/history')} />} />
      {!data ? (
        <SkeletonList rows={4} />
      ) : unavailable('recent') && !data.recent.length ? (
        <ErrorState message="Recent activity could not be loaded." onRetry={() => setAttempt((value) => value + 1)} />
      ) : !data.recent.length ? (
        <EmptyState
          icon={ClockIcon}
          title="No activity yet"
          description="New leads, email duties, meetings and published posts appear here."
          action={{ label: 'Open Sales', onPress: () => go('/sales') }}
        />
      ) : (
        <View>
          {data.recent.map((entry, index) => {
            const kind = KIND_ICON[entry.kind];
            return (
              <ListRow
                key={entry.id}
                title={entry.label}
                subtitle={`${entry.department} · ${relativeTime(entry.createdAt)}`}
                leading={<IconTile icon={kind.icon} color={kind.color} size={36} />}
                trailing={<StatusBadge label={entry.status} tone={toneFor(entry.status)} />}
                onPress={() => go(entry.path)}
                chevron={false}
                divider={index < data.recent.length - 1}
              />
            );
          })}
        </View>
      )}
    </Card>
  );

  const nextUp = (
    <Card>
      <SectionHeader
        title="What's next?"
        subtitle="Team tasks assigned to you"
        action={data && data.tasks.length ? <StatusBadge label={`${data.tasks.length} ${data.tasks.length === 1 ? 'task' : 'tasks'}`} dot={false} /> : undefined}
      />
      {!data ? (
        <SkeletonList rows={2} />
      ) : !data.tasks.length ? (
        <EmptyState
          icon={CheckIcon}
          title="Nothing assigned to you"
          description="Tasks your team assigns you in Company show up here."
          action={{ label: 'Assign work', onPress: () => go('/company?tab=tasks') }}
          compact
        />
      ) : (
        <View style={styles.tasks}>
          {data.tasks.map((task) => (
            <View key={task.id} style={styles.task}>
              <Pressable
                accessibilityRole="checkbox"
                accessibilityState={{ checked: false, busy: completing === task.id }}
                accessibilityLabel={`Mark “${task.title}” as done`}
                disabled={!!completing}
                onPress={() => void completeTask(task.id)}
                hitSlop={6}
                style={({ hovered }) => [styles.taskCircle, transition, { borderColor: hovered ? theme.accentHover : theme.borderStrong }]}
              >
                {completing === task.id ? <View style={[styles.taskFill, { backgroundColor: theme.accent }]} /> : null}
              </Pressable>
              <Pressable accessibilityRole="link" onPress={() => go('/company?tab=tasks')} style={styles.taskText}>
                <ThemedText type="small" numberOfLines={2}>
                  {task.title}
                </ThemedText>
                <ThemedText type="caption" themeColor="textSecondary">
                  {task.status === 'in_progress' ? 'In progress' : 'Open'}
                  {task.due_at ? ` · due ${meetingTime(task.due_at)}` : ` · assigned ${relativeTime(task.created_at)}`}
                </ThemedText>
              </Pressable>
            </View>
          ))}
        </View>
      )}
    </Card>
  );

  const ask = <AskSynqPanel />;
  const targets = <TargetsCard attempt={attempt} />;

  const layout: ReactNode[][] =
    columns === 3
      ? [[chart, recent], [departments, targets], [ask, nextUp]]
      : columns === 2
        ? [[chart, recent], [ask, targets, departments, nextUp]]
        : [[ask, chart, targets, nextUp, departments, recent]];
  const flexes = columns === 3 ? [1.5, 1.15, 1] : [1.35, 1];

  return (
    <Page>
      <View onLayout={onLayout} style={styles.stack}>
        <Welcome firstName={firstName} companyName={identity?.membership?.company_name ?? ''} />
        {failed ? <ErrorState message="Something went wrong loading your workspace." onRetry={() => setAttempt((value) => value + 1)} /> : null}
        {kpis}
        <View style={[styles.columns, columns === 1 && styles.columnsStacked]}>
          {layout.map((column, index) => (
            <View key={index} style={[styles.column, columns > 1 && { flex: flexes[index] }]}>
              {column.map((card, cardIndex) => (
                <View key={cardIndex}>{card}</View>
              ))}
            </View>
          ))}
        </View>
      </View>
    </Page>
  );
}

const styles = StyleSheet.create({
  stack: { gap: 20 },
  welcome: {
    borderWidth: 1,
    borderRadius: Radius.card,
    padding: 24,
    gap: 18,
    overflow: 'hidden',
  },
  welcomeBody: { gap: 4 },
  welcomeName: { fontSize: 34, lineHeight: 40 },
  welcomeText: { maxWidth: 560 },
  welcomeActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  menuItem: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 10, borderRadius: 8 },
  menuText: { flex: 1, gap: 1 },
  kpis: { flexDirection: 'row', flexWrap: 'wrap', gap: 16 },
  kpiCell: { flexGrow: 1, minWidth: 0 },
  columns: { flexDirection: 'row', gap: 16, alignItems: 'flex-start' },
  columnsStacked: { flexDirection: 'column', alignItems: 'stretch' },
  column: { gap: 16, minWidth: 0, alignSelf: 'stretch' },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: 16, marginTop: -4 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  trend: { fontSize: 13, fontWeight: '600' },
  quickGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  quick: {
    flexGrow: 1,
    flexBasis: '30%',
    minWidth: 92,
    minHeight: 78,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    padding: 10,
    borderRadius: Radius.control + 2,
    borderWidth: 1,
  },
  quickLabel: { fontSize: 12.5, fontWeight: '500', textAlign: 'center' },
  ask: {
    gap: 14,
    padding: 20,
    borderRadius: Radius.card,
    backgroundColor: '#141412',
    borderWidth: 1,
    borderColor: '#25241F',
  },
  askHead: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  askTitle: { flex: 1, gap: 2 },
  askHeading: { color: '#FFFFFF', fontSize: 18, fontWeight: '700' },
  askSub: { color: '#A9A59C', fontSize: 13 },
  askExpand: {
    width: 32,
    height: 32,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  askInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 5,
    paddingLeft: 14,
    borderRadius: Radius.control + 2,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
    backgroundColor: '#1D1D1A',
  },
  askInput: { flex: 1, minWidth: 0, height: 38, color: '#FFFFFF', fontSize: 14 },
  askSend: { width: 36, height: 36, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  askChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  askChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: Radius.control,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
    backgroundColor: '#1D1D1A',
  },
  askChipText: { color: '#E8E4DC', fontSize: 12.5, fontWeight: '500' },
  askNote: { color: '#8C887F', fontSize: 12 },
  tasks: { gap: 14 },
  task: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  taskCircle: {
    width: 22,
    height: 22,
    marginTop: 1,
    borderRadius: 11,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  taskFill: { width: 12, height: 12, borderRadius: 6 },
  taskText: { flex: 1, gap: 2 },
  targets: { gap: 14 },
  targetRow: { gap: 6 },
  targetHead: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
});
