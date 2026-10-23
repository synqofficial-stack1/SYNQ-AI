import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { CalendarIcon } from '@/components/icons';
import { TextField } from '@/components/text-field';
import { ThemedText } from '@/components/themed-text';
import { Avatar, Button, ButtonRow, Card, EmptyState, Field, IconTile, InlineAlert, ListRow, SectionHeader, Select, Split, transition } from '@/components/ui';
import { DataColors, Radius } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useWorkspace } from '@/hooks/use-workspace';
import type { Deal } from '@/lib/sales-workspace';
import { activeWorkspaceMembers, createSalesMeeting, loadSalesMeetings, newWorkspaceRecordId, updateSalesMeetingAttendees, type WorkspaceMember } from '@/lib/organization';
import { meetingTime } from '@/lib/workspace';

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
  const [when, setWhen] = useState<'upcoming' | 'past'>('upcoming');
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
  const me = members.find((member) => member.is_current_user)?.user_id ?? '';
  const nowIso = new Date().toISOString();
  const upcoming = meetings.filter((meeting) => meeting.starts_at > nowIso);
  const past = meetings.filter((meeting) => meeting.starts_at <= nowIso);

  function memberPicker(ids: string[], update: (value: string[]) => void) {
    const others = members.filter((member) => !member.is_current_user);
    if (!others.length) {
      return (
        <ThemedText type="caption" themeColor="textSecondary">
          No other active teammates are available yet.
        </ThemedText>
      );
    }
    return (
      <View style={styles.people}>
        {others.map((member) => {
          const active = ids.includes(member.user_id);
          return (
            <Pressable
              key={member.user_id}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: active }}
              accessibilityLabel={member.display_name}
              onPress={() => toggle(ids, update, member.user_id)}
              style={({ hovered }) => [
                styles.person,
                transition,
                {
                  borderColor: active ? theme.accentHover : theme.border,
                  backgroundColor: active ? theme.accentSoft : hovered ? theme.surfaceRaised : theme.surface,
                },
              ]}
            >
              <Avatar name={member.display_name} size={24} tone={active ? 'accent' : 'neutral'} />
              <ThemedText type="caption" style={{ fontWeight: active ? '600' : '500' }}>
                {member.display_name}
              </ThemedText>
            </Pressable>
          );
        })}
      </View>
    );
  }

  const meetingRow = (meeting: Meeting, index: number, list: Meeting[]) => {
    const canEditAttendees = owner || meeting.organizer_id === me;
    return (
      <View key={meeting.id} style={[styles.meeting, index < list.length - 1 && { borderBottomWidth: 1, borderBottomColor: theme.border }]}>
        <View style={styles.meetingHead}>
          <IconTile icon={CalendarIcon} color={DataColors.marketing} size={38} />
          <View style={styles.meetingText}>
            <ThemedText type="smallBold">{meeting.title}</ThemedText>
            <ThemedText type="caption" themeColor="textSecondary">
              {meetingTime(meeting.starts_at)} · Organised by {meeting.organizer_id === me ? 'you' : names.get(meeting.organizer_id) || 'Team member'}
            </ThemedText>
          </View>
          {canEditAttendees && editing !== meeting.id ? (
            <Button
              label="Edit attendees"
              size="sm"
              onPress={() => {
                setEditing(meeting.id);
                setEditingSelected(meeting.attendee_ids);
              }}
            />
          ) : null}
        </View>
        {meeting.description ? <ThemedText type="small">{meeting.description}</ThemedText> : null}
        <ThemedText type="caption" themeColor="textSecondary">
          Attendees:{' '}
          {[meeting.organizer_id, ...meeting.attendee_ids]
            .map((id) => `${id === me ? 'You' : names.get(id) || 'Team member'}${id === meeting.organizer_id ? ' (organiser)' : ''}`)
            .join(', ')}
        </ThemedText>
        {editing === meeting.id ? (
          <Card tone="muted">
            <ThemedText type="label">Invite teammates</ThemedText>
            {memberPicker(editingSelected, setEditingSelected)}
            <ButtonRow>
              <Button label="Save attendees" variant="primary" size="sm" loading={busy} disabled={busy} onPress={() => void saveAttendees(meeting.id)} />
              <Button label="Cancel" size="sm" onPress={() => setEditing(null)} />
            </ButtonRow>
          </Card>
        ) : null}
      </View>
    );
  };

  return (
    <Split
      ratio={1.25}
      main={
        <>
          <Card>
            <SectionHeader
              title="Meetings"
              subtitle="Meetings you organise or attend."
              action={
                <Select
                  label="Show meetings"
                  size="sm"
                  value={when}
                  onChange={setWhen}
                  options={[
                    { value: 'upcoming', label: `Upcoming (${upcoming.length})` },
                    { value: 'past', label: `Past (${past.length})` },
                  ]}
                />
              }
            />
            {when === 'upcoming' ? (
              !upcoming.length ? (
                <EmptyState icon={CalendarIcon} title="No upcoming meetings" description="Plan one with the form; invited teammates will see it here too." compact />
              ) : (
                <View>{upcoming.map(meetingRow)}</View>
              )
            ) : !past.length ? (
              <EmptyState icon={CalendarIcon} title="No past meetings" description="Meetings move here once their start time has passed." compact />
            ) : (
              <View>{past.slice().reverse().map(meetingRow)}</View>
            )}
          </Card>
          {legacyMeetings.length ? (
            <Card>
              <SectionHeader
                title="Meetings saved on opportunities"
                subtitle="Notes recorded with existing Sales records. They stay editable and have no attendee invitations."
              />
              <View>
                {legacyMeetings.map((deal, index) => (
                  <ListRow
                    key={deal.id}
                    title={deal.title}
                    subtitle={`${deal.meeting_on} ${deal.meeting_time} · ${deal.meeting_status.replace('_', ' ')}${deal.meeting_notes ? ` · ${deal.meeting_notes}` : ''}`}
                    leading={<IconTile icon={CalendarIcon} color={DataColors.neutral} size={36} />}
                    onPress={onEditLegacy ? () => onEditLegacy(deal) : undefined}
                    accessibilityLabel={`Edit meeting details for ${deal.title}`}
                    divider={index < legacyMeetings.length - 1}
                  />
                ))}
              </View>
            </Card>
          ) : null}
        </>
      }
      side={
        <Card>
          <SectionHeader title="Plan a meeting" subtitle="Choose teammates who can see this meeting and its attendee list. No calendar invitation or email is sent." />
          <Field label="Meeting title" required count={{ value: title.length, max: 160 }}>
            <TextField accessibilityLabel="Meeting title" placeholder="e.g. Demo with Blue Tokai" value={title} onChangeText={setTitle} maxLength={160} />
          </Field>
          <Field label="Details" helper="Optional.">
            <TextField accessibilityLabel="Meeting details" placeholder="Agenda, link or location" value={description} onChangeText={setDescription} multiline maxLength={3000} />
          </Field>
          <View style={styles.when}>
            <View style={styles.whenCell}>
              <Field label="Date" helper="YYYY-MM-DD">
                <TextField accessibilityLabel="Meeting date" placeholder="YYYY-MM-DD" value={date} onChangeText={(value) => setDateTime((current) => ({ ...current, date: value }))} maxLength={10} />
              </Field>
            </View>
            <View style={styles.whenCell}>
              <Field label="Time" helper="HH:mm, your time zone">
                <TextField accessibilityLabel="Meeting time" placeholder="HH:mm" value={time} onChangeText={(value) => setDateTime((current) => ({ ...current, time: value }))} maxLength={5} />
              </Field>
            </View>
          </View>
          <ThemedText type="caption" themeColor="textSecondary">
            Defaults to the next hour. Saved in your local time zone.
          </ThemedText>
          <ThemedText type="label">Invite teammates</ThemedText>
          {memberPicker(selected, setSelected)}
          {error ? <InlineAlert tone="danger" message={error} /> : null}
          <Button label="Create meeting" variant="primary" size="lg" fullWidth loading={busy} disabled={busy || !title.trim()} onPress={() => void create()} />
        </Card>
      }
    />
  );
}

const styles = StyleSheet.create({
  people: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  person: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6, paddingLeft: 6, paddingRight: 12, borderWidth: 1, borderRadius: Radius.pill },
  meeting: { gap: 8, paddingVertical: 14 },
  meetingHead: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  meetingText: { flex: 1, minWidth: 0, gap: 2 },
  when: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  whenCell: { flexGrow: 1, flexBasis: 150 },
});
