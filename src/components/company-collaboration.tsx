import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, TextInput, View, type TextStyle } from 'react-native';

import { ArrowIcon, ChatIcon, ClipboardIcon } from '@/components/icons';
import { TextField } from '@/components/text-field';
import { ThemedText } from '@/components/themed-text';
import {
  Avatar,
  Button,
  ButtonRow,
  Card,
  EmptyState,
  Field,
  InlineAlert,
  SectionHeader,
  Select,
  SkeletonList,
  StatusBadge,
  showToast,
  transition,
} from '@/components/ui';
import { Radius } from '@/constants/theme';
import { useSession } from '@/hooks/use-session';
import { useTheme } from '@/hooks/use-theme';
import { useWorkspace } from '@/hooks/use-workspace';
import {
  activeWorkspaceMembers,
  createWorkspaceTask,
  loadWorkspaceChat,
  loadWorkspaceTasks,
  newWorkspaceRecordId,
  sendWorkspaceMessage,
  setWorkspaceTaskStatus,
  type WorkspaceChatMessage,
  type WorkspaceMember,
  type WorkspaceTask,
} from '@/lib/organization';
import { relativeTime } from '@/lib/workspace';

const noOutline = Platform.select({ web: { outlineStyle: 'none' } as unknown as TextStyle, default: null });

export type Collaboration = ReturnType<typeof useCompanyCollaboration>;

/**
 * Team chat and assigned work for the signed-in person's company. One hook so
 * the Company tabs share a single poll and a single set of idempotency keys:
 * a retried send or assignment reuses its record id, so a slow network can
 * never post a message or create a task twice.
 */
export function useCompanyCollaboration() {
  const { session } = useSession();
  const { identity } = useWorkspace();
  const organizationId = identity?.membership?.organization_id;
  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [messages, setMessages] = useState<WorkspaceChatMessage[]>([]);
  const [tasks, setTasks] = useState<WorkspaceTask[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [message, setMessage] = useState('');
  const [title, setTitle] = useState('');
  const [details, setDetails] = useState('');
  const [assignee, setAssignee] = useState('');
  const [busy, setBusy] = useState<'' | 'send' | 'assign' | string>('');
  const [error, setError] = useState('');
  const pendingMessageId = useRef<string | null>(null);
  const pendingMessageText = useRef('');
  const pendingTaskId = useRef<string | null>(null);
  const pendingTaskKey = useRef('');

  const refresh = useCallback(async () => {
    if (!organizationId) return;
    const [people, chat, work] = await Promise.all([activeWorkspaceMembers(), loadWorkspaceChat(), loadWorkspaceTasks()]);
    setMembers(people);
    setMessages(chat);
    setTasks(work);
    setLoaded(true);
    setAssignee((current) => current || people.find((person) => person.is_current_user)?.user_id || people[0]?.user_id || '');
  }, [organizationId]);

  useEffect(() => {
    let live = true;
    const initial = setTimeout(
      () =>
        void refresh().catch((cause) => {
          if (live) {
            setError(cause instanceof Error ? cause.message : 'Could not load team collaboration.');
            setLoaded(true);
          }
        }),
      0,
    );
    const timer = setInterval(() => {
      void refresh().catch(() => {});
    }, 10000);
    return () => {
      live = false;
      clearTimeout(initial);
      clearInterval(timer);
    };
  }, [refresh]);

  const names = useMemo(() => new Map(members.map((person) => [person.user_id, person.display_name])), [members]);
  const isOwner = identity?.membership?.role === 'owner';
  const myId = session?.user.id;
  const canEdit = (task: WorkspaceTask) => isOwner || task.created_by === myId || task.assigned_to === myId;

  async function send() {
    if (!organizationId || !message.trim() || busy) return;
    setBusy('send');
    setError('');
    try {
      if (pendingMessageText.current !== message || !pendingMessageId.current) {
        pendingMessageText.current = message;
        pendingMessageId.current = newWorkspaceRecordId();
      }
      await sendWorkspaceMessage(message, organizationId, pendingMessageId.current);
      pendingMessageId.current = null;
      pendingMessageText.current = '';
      setMessage('');
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not send this message.');
    } finally {
      setBusy('');
    }
  }

  async function assign() {
    if (!organizationId || !title.trim() || !assignee || busy) return;
    setBusy('assign');
    setError('');
    try {
      const key = `${organizationId}|${assignee}|${title.trim()}|${details.trim()}`;
      if (pendingTaskKey.current !== key || !pendingTaskId.current) {
        pendingTaskKey.current = key;
        pendingTaskId.current = newWorkspaceRecordId();
      }
      await createWorkspaceTask({
        id: pendingTaskId.current,
        organization_id: organizationId,
        assigned_to: assignee,
        title: title.trim(),
        details: details.trim(),
        due_at: null,
      });
      pendingTaskId.current = null;
      pendingTaskKey.current = '';
      setTitle('');
      setDetails('');
      showToast(`Task assigned to ${names.get(assignee) || 'your teammate'}.`);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not assign this task.');
    } finally {
      setBusy('');
    }
  }

  async function updateTask(task: WorkspaceTask, next: WorkspaceTask['status']) {
    setError('');
    setBusy(task.id);
    try {
      await setWorkspaceTaskStatus(task.id, next);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not update task status.');
    } finally {
      setBusy('');
    }
  }

  return {
    organizationId,
    members,
    messages,
    tasks,
    loaded,
    names,
    myId,
    canEdit,
    signedIn: !!session,
    error,
    busy,
    message,
    setMessage,
    send,
    title,
    setTitle,
    details,
    setDetails,
    assignee,
    setAssignee,
    assign,
    updateTask,
  };
}

/** The team's shared chat: recent messages and a composer. */
export function TeamChat({ team, maxHeight = 300 }: { team: Collaboration; maxHeight?: number }) {
  const theme = useTheme();
  const scroll = useRef<ScrollView>(null);
  return (
    <Card>
      <SectionHeader title="Workspace chat" subtitle="Visible to approved members of this company." />
      {!team.loaded ? (
        <SkeletonList rows={2} />
      ) : !team.messages.length ? (
        <EmptyState icon={ChatIcon} title="No messages yet" description="Start a conversation with your team." compact />
      ) : (
        <ScrollView
          ref={scroll}
          style={{ maxHeight }}
          contentContainerStyle={styles.thread}
          onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: false })}
        >
          {team.messages.map((item) => {
            const mine = item.sender_id === team.myId;
            const name = team.names.get(item.sender_id) || 'Team member';
            return (
              <View key={item.id} style={[styles.message, mine && styles.messageMine]}>
                {mine ? null : <Avatar name={name} size={28} tone="neutral" />}
                <View style={[styles.bubble, { backgroundColor: mine ? theme.accentSoft : theme.surfaceRaised }]}>
                  <ThemedText type="caption" themeColor="textSecondary">
                    {mine ? 'You' : name} · {relativeTime(item.created_at)}
                  </ThemedText>
                  <ThemedText type="small" selectable>
                    {item.body}
                  </ThemedText>
                </View>
              </View>
            );
          })}
        </ScrollView>
      )}
      <View style={[styles.composer, { borderColor: theme.border, backgroundColor: theme.surface }]}>
        <TextInput
          accessibilityLabel="Message your team"
          placeholder="Write a message…"
          placeholderTextColor={theme.textTertiary}
          value={team.message}
          onChangeText={team.setMessage}
          maxLength={4000}
          multiline
          style={[styles.composerInput, noOutline, { color: theme.text }]}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Send message"
          accessibilityState={{ disabled: !team.message.trim() || !!team.busy, busy: team.busy === 'send' }}
          disabled={!team.message.trim() || !!team.busy}
          onPress={() => void team.send()}
          style={({ hovered }) => [
            styles.send,
            transition,
            { backgroundColor: hovered ? '#2A2A28' : '#171717', opacity: !team.message.trim() || team.busy ? 0.45 : 1 },
          ]}
        >
          <ArrowIcon size={17} color="#FFFFFF" />
        </Pressable>
      </View>
    </Card>
  );
}

/** Assign a task to an active teammate. */
export function AssignWork({ team }: { team: Collaboration }) {
  return (
    <Card>
      <SectionHeader title="Assign work" subtitle="Create a task and assign it to someone on your team." />
      <Field label="Task title" required count={{ value: team.title.length, max: 160 }}>
        <TextField accessibilityLabel="Task title" placeholder="e.g. Follow up with this week's leads" value={team.title} onChangeText={team.setTitle} maxLength={160} />
      </Field>
      <Field label="Details" helper="Optional. Anything the assignee needs to know.">
        <TextField accessibilityLabel="Task details" placeholder="Details (optional)" value={team.details} onChangeText={team.setDetails} maxLength={3000} multiline />
      </Field>
      <View style={styles.assignRow}>
        <View style={styles.assignSelect}>
          <Field label="Assign to">
            <Select
              label="Assign to"
              value={team.assignee || null}
              onChange={team.setAssignee}
              options={team.members.map((person) => ({
                value: person.user_id,
                label: `${person.display_name}${person.is_current_user ? ' (you)' : ''}`,
              }))}
              placeholder={team.members.length ? 'Choose a teammate' : 'No active teammates'}
            />
          </Field>
        </View>
        <Button
          label="Assign task"
          variant="primary"
          loading={team.busy === 'assign'}
          disabled={!!team.busy || !team.title.trim() || !team.assignee}
          onPress={() => void team.assign()}
          style={styles.assignButton}
        />
      </View>
    </Card>
  );
}

const STATUS: Record<WorkspaceTask['status'], { label: string; tone: 'neutral' | 'info' | 'success' }> = {
  open: { label: 'Open', tone: 'neutral' },
  in_progress: { label: 'In progress', tone: 'info' },
  completed: { label: 'Done', tone: 'success' },
};

/** Every assigned task, with the status actions its creator, assignee or the owner may take. */
export function TaskList({ team, limit }: { team: Collaboration; limit?: number }) {
  const theme = useTheme();
  const list = limit ? team.tasks.slice(0, limit) : team.tasks;
  return (
    <Card>
      <SectionHeader title="Assigned tasks" subtitle={`${team.tasks.filter((task) => task.status !== 'completed').length} open`} />
      {!team.loaded ? (
        <SkeletonList rows={3} />
      ) : !list.length ? (
        <EmptyState icon={ClipboardIcon} title="No assigned tasks yet" description="Tasks you create or are given appear here." compact />
      ) : (
        <View>
          {list.map((task, index) => (
            <View key={task.id} style={[styles.task, index < list.length - 1 && { borderBottomWidth: 1, borderBottomColor: theme.border }]}>
              <View style={styles.taskHead}>
                <ThemedText type="smallBold" style={styles.taskTitle}>
                  {task.title}
                </ThemedText>
                <StatusBadge label={STATUS[task.status].label} tone={STATUS[task.status].tone} />
              </View>
              <ThemedText type="caption" themeColor="textSecondary">
                Assigned to {task.assigned_to === team.myId ? 'you' : team.names.get(task.assigned_to) || 'Team member'} by{' '}
                {task.created_by === team.myId ? 'you' : team.names.get(task.created_by) || 'Team member'} · {relativeTime(task.created_at)}
                {task.due_at ? ` · Due ${new Date(task.due_at).toLocaleString()}` : ''}
              </ThemedText>
              {task.details ? <ThemedText type="small">{task.details}</ThemedText> : null}
              {team.canEdit(task) ? (
                <ButtonRow>
                  {task.status === 'open' ? (
                    <Button label="Start" size="sm" disabled={!!team.busy} loading={team.busy === task.id} onPress={() => void team.updateTask(task, 'in_progress')} />
                  ) : null}
                  {task.status !== 'completed' ? (
                    <Button label="Mark done" size="sm" disabled={!!team.busy} onPress={() => void team.updateTask(task, 'completed')} />
                  ) : (
                    <Button label="Reopen" size="sm" disabled={!!team.busy} loading={team.busy === task.id} onPress={() => void team.updateTask(task, 'open')} />
                  )}
                </ButtonRow>
              ) : null}
            </View>
          ))}
        </View>
      )}
    </Card>
  );
}

export function CollaborationError({ team }: { team: Collaboration }) {
  if (!team.error && team.signedIn) return null;
  return <InlineAlert tone="danger" message={team.error || 'Sign in to access company collaboration.'} />;
}

const styles = StyleSheet.create({
  thread: { gap: 12, paddingVertical: 4 },
  message: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, maxWidth: '92%' },
  messageMine: { alignSelf: 'flex-end' },
  bubble: { flexShrink: 1, gap: 2, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 12 },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    padding: 5,
    paddingLeft: 12,
    borderWidth: 1,
    borderRadius: Radius.control + 2,
  },
  composerInput: { flex: 1, minHeight: 36, maxHeight: 120, paddingVertical: 8, fontSize: 14 },
  send: { width: 38, height: 38, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  assignRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-end', gap: 12 },
  assignSelect: { flexGrow: 1, flexBasis: 220 },
  assignButton: { height: 42 },
  task: { gap: 6, paddingVertical: 14 },
  taskHead: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  taskTitle: { flex: 1 },
});
