import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';

import { PrimaryButton } from '@/components/primary-button';
import { TextField } from '@/components/text-field';
import { ThemedText } from '@/components/themed-text';
import { AccentColors } from '@/constants/theme';
import { useSession } from '@/hooks/use-session';
import { useTheme } from '@/hooks/use-theme';
import { useWorkspace } from '@/hooks/use-workspace';
import {
  activeWorkspaceMembers, createWorkspaceTask, loadWorkspaceChat, loadWorkspaceTasks,
  newWorkspaceRecordId, sendWorkspaceMessage, setWorkspaceTaskStatus,
  type WorkspaceChatMessage, type WorkspaceMember, type WorkspaceTask,
} from '@/lib/organization';

export function CompanyCollaboration() {
  const theme = useTheme();
  const { session } = useSession();
  const { identity } = useWorkspace();
  const organizationId = identity?.membership?.organization_id;
  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [messages, setMessages] = useState<WorkspaceChatMessage[]>([]);
  const [tasks, setTasks] = useState<WorkspaceTask[]>([]);
  const [message, setMessage] = useState('');
  const [title, setTitle] = useState('');
  const [details, setDetails] = useState('');
  const [assignee, setAssignee] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const pendingMessageId = useRef<string | null>(null);
  const pendingMessageText = useRef('');
  const pendingTaskId = useRef<string | null>(null);
  const pendingTaskKey = useRef('');

  const refresh = useCallback(async () => {
    if (!organizationId) return;
    const [people, chat, work] = await Promise.all([activeWorkspaceMembers(), loadWorkspaceChat(), loadWorkspaceTasks()]);
    setMembers(people); setMessages(chat); setTasks(work);
    setAssignee((current) => current || people.find((person) => person.is_current_user)?.user_id || people[0]?.user_id || '');
  }, [organizationId]);
  useEffect(() => {
    let live = true;
    const initial = setTimeout(() => void refresh().catch((cause) => { if (live) setError(cause instanceof Error ? cause.message : 'Could not load team collaboration.'); }), 0);
    const timer = setInterval(() => { void refresh().catch(() => {}); }, 10000);
    return () => { live = false; clearTimeout(initial); clearInterval(timer); };
  }, [refresh]);
  const names = useMemo(() => new Map(members.map((person) => [person.user_id, person.display_name])), [members]);
  const isOwner = identity?.membership?.role === 'owner';
  const myId = session?.user.id;
  const canEdit = (task: WorkspaceTask) => isOwner || task.created_by === myId || task.assigned_to === myId;

  async function send() {
    if (!organizationId || !message.trim() || busy) return;
    setBusy(true); setError('');
    try {
      if (pendingMessageText.current !== message || !pendingMessageId.current) { pendingMessageText.current = message; pendingMessageId.current = newWorkspaceRecordId(); }
      const messageId = pendingMessageId.current;
      await sendWorkspaceMessage(message, organizationId, messageId);
      pendingMessageId.current = null; pendingMessageText.current = ''; setMessage(''); await refresh();
    }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not send this message.'); }
    finally { setBusy(false); }
  }
  async function assign() {
    if (!organizationId || !title.trim() || !assignee || busy) return;
    setBusy(true); setError('');
    try {
      const key = `${organizationId}|${assignee}|${title.trim()}|${details.trim()}`;
      if (pendingTaskKey.current !== key || !pendingTaskId.current) { pendingTaskKey.current = key; pendingTaskId.current = newWorkspaceRecordId(); }
      const taskId = pendingTaskId.current;
      await createWorkspaceTask({ id: taskId, organization_id: organizationId, assigned_to: assignee, title: title.trim(), details: details.trim(), due_at: null });
      pendingTaskId.current = null; pendingTaskKey.current = ''; setTitle(''); setDetails(''); await refresh();
    }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not assign this task.'); }
    finally { setBusy(false); }
  }
  async function updateTask(task: WorkspaceTask) {
    const next = task.status === 'open' ? 'in_progress' : task.status === 'in_progress' ? 'completed' : 'open';
    setError('');
    try { await setWorkspaceTaskStatus(task.id, next); await refresh(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not update task status.'); }
  }

  const box = { padding: 20, gap: 14, borderWidth: 1 as const, borderColor: theme.border, borderRadius: 14, backgroundColor: theme.surface };
  return <View style={{ gap: 18 }}>
    <View style={box}>
      <ThemedText type="sectionTitle">Team chat</ThemedText>
      <ThemedText type="caption" themeColor="textSecondary">Messages are visible to approved members of this company workspace.</ThemedText>
      <ScrollView style={{ maxHeight: 280 }} contentContainerStyle={{ gap: 12 }}>
        {!messages.length ? <ThemedText type="caption" themeColor="textSecondary">No messages yet. Start the conversation.</ThemedText> : messages.map((item) => <View key={item.id} style={{ gap: 3 }}>
          <ThemedText type="caption">{names.get(item.sender_id) || 'Team member'} · {new Date(item.created_at).toLocaleString()}</ThemedText>
          <ThemedText type="small">{item.body}</ThemedText>
        </View>)}
      </ScrollView>
      <TextField accessibilityLabel="Company message" placeholder="Write a message to your team" value={message} onChangeText={setMessage} maxLength={4000} multiline />
      <PrimaryButton title="Send message" loading={busy} disabled={busy || !message.trim()} onPress={() => void send()} />
    </View>
    <View style={box}>
      <ThemedText type="sectionTitle">Assign work</ThemedText>
      <TextField accessibilityLabel="Task title" placeholder="Task title" value={title} onChangeText={setTitle} maxLength={160} />
      <TextField accessibilityLabel="Task details" placeholder="Details (optional)" value={details} onChangeText={setDetails} maxLength={3000} multiline />
      <ThemedText type="caption" themeColor="textSecondary">Assign to</ThemedText>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {members.map((person) => <Pressable key={person.user_id} accessibilityRole="radio" accessibilityState={{ checked: assignee === person.user_id }} onPress={() => setAssignee(person.user_id)} style={{ padding: 10, borderWidth: 1, borderColor: assignee === person.user_id ? AccentColors.primary : theme.border, borderRadius: 9 }}><ThemedText type="caption">{person.display_name}{person.is_current_user ? ' (you)' : ''}</ThemedText></Pressable>)}
      </View>
      {!members.length ? <ThemedText type="caption" themeColor="textSecondary">No active teammates are available.</ThemedText> : <PrimaryButton title="Assign task" loading={busy} disabled={busy || !title.trim() || !assignee} onPress={() => void assign()} />}
      <View style={{ gap: 12, marginTop: 4 }}>
        {!tasks.length ? <ThemedText type="caption" themeColor="textSecondary">No assigned tasks yet.</ThemedText> : tasks.map((task) => <View key={task.id} style={{ gap: 5, paddingTop: 10, borderTopWidth: 1, borderTopColor: theme.border }}>
          <ThemedText type="smallBold">{task.title}</ThemedText>
          <ThemedText type="caption" themeColor="textSecondary">Assigned to {names.get(task.assigned_to) || 'Team member'} · {task.status.replace('_', ' ')}{task.due_at ? ` · Due ${new Date(task.due_at).toLocaleString()}` : ''}</ThemedText>
          {task.details ? <ThemedText type="caption">{task.details}</ThemedText> : null}
          {canEdit(task) ? <Pressable accessibilityRole="button" onPress={() => void updateTask(task)}><ThemedText type="caption" style={{ color: AccentColors.primary }}>{task.status === 'completed' ? 'Reopen task' : 'Update status'}</ThemedText></Pressable> : null}
        </View>)}
      </View>
    </View>
    {error ? <ThemedText accessibilityRole="alert" style={{ color: AccentColors.error }}>{error}</ThemedText> : null}
    {!session ? <ThemedText type="caption" themeColor="textSecondary">Sign in to access company collaboration.</ThemedText> : null}
  </View>;
}
