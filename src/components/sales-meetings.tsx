import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, View } from 'react-native';

import { PrimaryButton } from '@/components/primary-button';
import { TextField } from '@/components/text-field';
import { ThemedText } from '@/components/themed-text';
import { AccentColors } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useWorkspace } from '@/hooks/use-workspace';
import type { Deal } from '@/lib/sales-workspace';
import { activeWorkspaceMembers, createSalesMeeting, loadSalesMeetings, newWorkspaceRecordId, updateSalesMeetingAttendees, type WorkspaceMember } from '@/lib/organization';

type Meeting = Awaited<ReturnType<typeof loadSalesMeetings>>[number];
function defaults() {
  const value = new Date(); value.setMinutes(0, 0, 0); value.setHours(value.getHours() + 1);
  return { date: `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`, time: `${String(value.getHours()).padStart(2, '0')}:${String(value.getMinutes()).padStart(2, '0')}` };
}
function toTimestamp(date: string, time: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new Error('Enter a valid local date and time.');
  const [year, month, day] = date.split('-').map(Number);
  const [hour, minute] = time.split(':').map(Number);
  const value = new Date(year, month - 1, day, hour, minute, 0, 0);
  if (value.getFullYear() !== year || value.getMonth() !== month - 1 || value.getDate() !== day || value.getHours() !== hour || value.getMinutes() !== minute) throw new Error('That local time does not exist because of a time-zone change. Choose another time.');
  if (value.getTime() <= Date.now()) throw new Error('Choose a meeting time in the future.');
  return value.toISOString();
}

export function SalesMeetings({ legacyMeetings = [], onEditLegacy }: { legacyMeetings?: Deal[]; onEditLegacy?: (deal: Deal) => void }) {
  const theme = useTheme();
  const { identity } = useWorkspace();
  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [{ date, time }, setDateTime] = useState(defaults);
  const [selected, setSelected] = useState<string[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [editingSelected, setEditingSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const pendingMeetingId = useRef<string | null>(null);
  const pendingMeetingKey = useRef('');
  const owner = identity?.membership?.role === 'owner';
  const names = useMemo(() => new Map(members.map((member) => [member.user_id, member.display_name])), [members]);
  const refresh = useCallback(async () => {
    const [people, items] = await Promise.all([activeWorkspaceMembers(), loadSalesMeetings()]);
    setMembers(people); setMeetings(items);
  }, []);
  useEffect(() => {
    const initial = setTimeout(() => void refresh().catch((cause) => setError(cause instanceof Error ? cause.message : 'Could not load meetings.')), 0);
    return () => clearTimeout(initial);
  }, [refresh]);

  async function create() {
    if (!title.trim() || busy) return;
    setBusy(true); setError('');
    try {
      const startsAt = toTimestamp(date, time);
      const key = `${title.trim()}|${description.trim()}|${startsAt}|${selected.slice().sort().join(',')}`;
      if (pendingMeetingKey.current !== key || !pendingMeetingId.current) { pendingMeetingKey.current = key; pendingMeetingId.current = newWorkspaceRecordId(); }
      const requestId = pendingMeetingId.current;
      await createSalesMeeting({ requestId, title: title.trim(), description: description.trim(), startsAt, attendees: selected });
      pendingMeetingId.current = null; pendingMeetingKey.current = '';
      setTitle(''); setDescription(''); setSelected([]); setDateTime(defaults()); await refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not create the meeting.'); }
    finally { setBusy(false); }
  }
  async function saveAttendees(meetingId: string) {
    setBusy(true); setError('');
    try { await updateSalesMeetingAttendees(meetingId, editingSelected); setEditing(null); await refresh(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not update attendees.'); }
    finally { setBusy(false); }
  }
  function toggle(ids: string[], setIds: (value: string[]) => void, id: string) {
    setIds(ids.includes(id) ? ids.filter((value) => value !== id) : [...ids, id]);
  }
  const box = { padding: 20, gap: 14, borderWidth: 1 as const, borderColor: theme.border, borderRadius: 14, backgroundColor: theme.surface };
  function memberPicker(ids: string[], update: (value: string[]) => void) {
    return <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{members.filter((member) => !member.is_current_user).map((member) => {
      const active = ids.includes(member.user_id);
      return <Pressable key={member.user_id} accessibilityRole="checkbox" accessibilityState={{ checked: active }} onPress={() => toggle(ids, update, member.user_id)} style={{ padding: 10, borderWidth: 1, borderColor: active ? AccentColors.primary : theme.border, borderRadius: 9 }}><ThemedText type="caption">{member.display_name}</ThemedText></Pressable>;
    })}{members.length <= 1 ? <ThemedText type="caption" themeColor="textSecondary">No other active teammates are available yet.</ThemedText> : null}</View>;
  }
  return <View style={{ gap: 18 }}>
    <View style={box}>
      <ThemedText type="sectionTitle">Create a meeting</ThemedText>
      <ThemedText type="caption" themeColor="textSecondary">Choose teammates who can see this meeting and its complete attendee list. No calendar invitation or email is sent.</ThemedText>
      <TextField accessibilityLabel="Meeting title" placeholder="Meeting title" value={title} onChangeText={setTitle} maxLength={160} />
      <TextField accessibilityLabel="Meeting details" placeholder="Details (optional)" value={description} onChangeText={setDescription} multiline maxLength={3000} />
      <View style={{ flexDirection: 'row', gap: 12, flexWrap: 'wrap' }}>
        <View style={{ flex: 1, minWidth: 170 }}><TextField accessibilityLabel="Meeting date" placeholder="YYYY-MM-DD" value={date} onChangeText={(value) => setDateTime((current) => ({ ...current, date: value }))} maxLength={10} /></View>
        <View style={{ flex: 1, minWidth: 120 }}><TextField accessibilityLabel="Meeting time" placeholder="HH:mm" value={time} onChangeText={(value) => setDateTime((current) => ({ ...current, time: value }))} maxLength={5} /></View>
      </View>
      <ThemedText type="caption" themeColor="textSecondary">Local time zone · saved as UTC · defaults to the next local hour. Change the date or time before saving if needed.</ThemedText>
      <ThemedText type="caption" themeColor="textSecondary">Invite teammates</ThemedText>
      {memberPicker(selected, setSelected)}
      <PrimaryButton title="Create meeting" loading={busy} disabled={busy || !title.trim()} onPress={() => void create()} />
    </View>
    {legacyMeetings.length ? <View style={box}>
      <ThemedText type="sectionTitle">Previously recorded meetings</ThemedText>
      <ThemedText type="caption" themeColor="textSecondary">These meeting notes were saved with existing Sales records. They remain editable and have no attendee invitations.</ThemedText>
      {legacyMeetings.map((deal) => <View key={deal.id} style={{ gap: 6, paddingTop: 10, borderTopWidth: 1, borderTopColor: theme.border }}>
        <ThemedText type="smallBold">{deal.title}</ThemedText>
        <ThemedText type="caption" themeColor="textSecondary">{deal.meeting_on} {deal.meeting_time} · {deal.meeting_status.replace('_', ' ')}</ThemedText>
        {deal.meeting_notes ? <ThemedText type="caption">{deal.meeting_notes}</ThemedText> : null}
        {onEditLegacy ? <Pressable accessibilityRole="button" onPress={() => onEditLegacy(deal)}><ThemedText type="caption" style={{ color: AccentColors.primary }}>Edit meeting details</ThemedText></Pressable> : null}
      </View>)}
    </View> : null}
    <View style={box}>
      <ThemedText type="sectionTitle">Meetings</ThemedText>
      {!meetings.length ? <ThemedText type="caption" themeColor="textSecondary">No meetings yet. Meetings you organize or attend will appear here.</ThemedText> : meetings.map((meeting) => <View key={meeting.id} style={{ gap: 7, paddingTop: 12, borderTopWidth: 1, borderTopColor: theme.border }}>
        <ThemedText type="smallBold">{meeting.title}</ThemedText>
        <ThemedText type="caption" themeColor="textSecondary">{new Date(meeting.starts_at).toLocaleString()} · Organized by {names.get(meeting.organizer_id) || 'Team member'}</ThemedText>
        {meeting.description ? <ThemedText type="caption">{meeting.description}</ThemedText> : null}
        <ThemedText type="caption">Attendees: {[meeting.organizer_id, ...meeting.attendee_ids].map((id) => `${names.get(id) || 'Team member'}${id === meeting.organizer_id ? ' (organizer)' : ''}`).join(', ')}</ThemedText>
        {(owner || meeting.organizer_id === (members.find((member) => member.is_current_user)?.user_id ?? '')) ? <Pressable accessibilityRole="button" onPress={() => { setEditing(meeting.id); setEditingSelected(meeting.attendee_ids); }}><ThemedText type="caption" style={{ color: AccentColors.primary }}>Edit attendees</ThemedText></Pressable> : null}
        {editing === meeting.id ? <View style={{ gap: 10 }}>{memberPicker(editingSelected, setEditingSelected)}<PrimaryButton title="Save attendees" loading={busy} disabled={busy} onPress={() => void saveAttendees(meeting.id)} /><Pressable accessibilityRole="button" onPress={() => setEditing(null)}><ThemedText type="caption" themeColor="textSecondary">Cancel</ThemedText></Pressable></View> : null}
      </View>)}
    </View>
    {error ? <ThemedText accessibilityRole="alert" style={{ color: AccentColors.error }}>{error}</ThemedText> : null}
  </View>;
}
