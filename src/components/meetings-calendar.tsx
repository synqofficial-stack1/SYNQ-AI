import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { CalendarIcon, ChevronLeftIcon, ChevronRightIcon } from '@/components/icons';
import { ThemedText } from '@/components/themed-text';
import { Card, EmptyState, IconTile, ListRow, SectionHeader, transition } from '@/components/ui';
import { DataColors, Radius } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

// A small month calendar for the Sales overview: every planned meeting shows
// as a dot on its day, and choosing a day lists that day's meetings. It draws
// only what it is given; meetings come from the real meetings tables.

export type CalendarMeeting = {
  id: string;
  title: string;
  /** Local start time. Meetings saved with only a date use local midnight. */
  start: Date;
  /** False when the meeting was saved with a date but no time. */
  hasTime: boolean;
  onPress?: () => void;
};

const WEEKDAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

const dayKey = (date: Date) => `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;

/** Monday-first weeks for the month containing `month`, padded with nulls. */
function monthGrid(month: Date): (Date | null)[] {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const days = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const lead = (first.getDay() + 6) % 7;
  const cells: (Date | null)[] = Array.from({ length: lead }, () => null);
  for (let day = 1; day <= days; day++) cells.push(new Date(month.getFullYear(), month.getMonth(), day));
  while (cells.length % 7) cells.push(null);
  return cells;
}

export function MeetingsCalendar({ meetings, onViewAll }: { meetings: CalendarMeeting[]; onViewAll?: () => void }) {
  const theme = useTheme();
  const today = new Date();
  const [month, setMonth] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1));
  const [selected, setSelected] = useState<Date>(today);

  const byDay = new Map<string, CalendarMeeting[]>();
  for (const meeting of meetings) {
    const key = dayKey(meeting.start);
    byDay.set(key, [...(byDay.get(key) ?? []), meeting]);
  }
  for (const list of byDay.values()) list.sort((a, b) => a.start.getTime() - b.start.getTime());

  const shift = (by: number) => setMonth((current) => new Date(current.getFullYear(), current.getMonth() + by, 1));
  const monthMeetings = meetings.filter((meeting) => meeting.start.getFullYear() === month.getFullYear() && meeting.start.getMonth() === month.getMonth()).length;
  const dayMeetings = byDay.get(dayKey(selected)) ?? [];
  const selectedLabel = selected.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });

  return (
    <Card>
      <SectionHeader
        title="Meetings calendar"
        subtitle={monthMeetings ? `${monthMeetings} ${monthMeetings === 1 ? 'meeting' : 'meetings'} this month` : 'No meetings this month'}
        icon={<IconTile icon={CalendarIcon} color={DataColors.marketing} size={36} />}
      />

      <View style={styles.monthRow}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Previous month"
          onPress={() => shift(-1)}
          style={({ hovered }) => [styles.arrow, transition, { borderColor: theme.border }, hovered && { backgroundColor: theme.surfaceRaised }]}
        >
          <ChevronLeftIcon size={16} color={theme.textSecondary} />
        </Pressable>
        <ThemedText type="smallBold" accessibilityRole="header">
          {month.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
        </ThemedText>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Next month"
          onPress={() => shift(1)}
          style={({ hovered }) => [styles.arrow, transition, { borderColor: theme.border }, hovered && { backgroundColor: theme.surfaceRaised }]}
        >
          <ChevronRightIcon size={16} color={theme.textSecondary} />
        </Pressable>
      </View>

      <View>
        <View style={styles.week}>
          {WEEKDAYS.map((label, index) => (
            <Text key={index} style={[styles.weekday, { color: theme.textTertiary }]}>
              {label}
            </Text>
          ))}
        </View>
        <View style={styles.grid}>
          {monthGrid(month).map((date, index) => {
            if (!date) return <View key={`pad-${index}`} style={styles.cell} />;
            const count = byDay.get(dayKey(date))?.length ?? 0;
            const isToday = dayKey(date) === dayKey(today);
            const isSelected = dayKey(date) === dayKey(selected);
            return (
              <Pressable
                key={dayKey(date)}
                accessibilityRole="button"
                accessibilityLabel={`${date.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}${count ? `, ${count} ${count === 1 ? 'meeting' : 'meetings'}` : ''}`}
                accessibilityState={{ selected: isSelected }}
                onPress={() => setSelected(date)}
                style={styles.cell}
              >
                {({ hovered }) => (
                  <View
                    style={[
                      styles.day,
                      transition,
                      {
                        backgroundColor: isSelected ? theme.accent : hovered ? theme.surfaceRaised : 'transparent',
                        borderColor: isToday && !isSelected ? theme.accent : 'transparent',
                      },
                    ]}
                  >
                    <Text style={[styles.dayText, { color: isSelected ? theme.onAccent : theme.text, fontWeight: isToday || isSelected ? '700' : '500' }]}>
                      {date.getDate()}
                    </Text>
                    {count ? (
                      <View style={styles.dots}>
                        {Array.from({ length: Math.min(count, 3) }).map((_, dot) => (
                          <View key={dot} style={[styles.dot, { backgroundColor: isSelected ? theme.onAccent : theme.accentText }]} />
                        ))}
                      </View>
                    ) : null}
                  </View>
                )}
              </Pressable>
            );
          })}
        </View>
      </View>

      <View style={[styles.dayList, { borderTopColor: theme.border }]}>
        <ThemedText type="caption" themeColor="textSecondary">
          {selectedLabel}
        </ThemedText>
        {dayMeetings.length === 0 ? (
          <EmptyState title="No meetings this day" description="Planned meetings show here and as dots on the calendar." compact action={onViewAll ? { label: 'Plan a meeting', onPress: onViewAll } : undefined} />
        ) : (
          dayMeetings.map((meeting, index) => (
            <ListRow
              key={meeting.id}
              title={meeting.title}
              subtitle={meeting.hasTime ? meeting.start.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) : 'Time not set'}
              leading={<IconTile icon={CalendarIcon} color={DataColors.marketing} size={32} />}
              onPress={meeting.onPress}
              divider={index < dayMeetings.length - 1}
            />
          ))
        )}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  monthRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  arrow: { width: 32, height: 32, borderRadius: Radius.control, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  week: { flexDirection: 'row' },
  weekday: { width: `${100 / 7}%`, textAlign: 'center', fontSize: 12, fontWeight: '600', paddingBottom: 6 },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: { width: `${100 / 7}%`, aspectRatio: 1, padding: 2 },
  day: { flex: 1, borderRadius: Radius.control, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center', gap: 2 },
  dayText: { fontSize: 13 },
  dots: { flexDirection: 'row', gap: 2, height: 4 },
  dot: { width: 4, height: 4, borderRadius: 2 },
  dayList: { gap: 4, paddingTop: 12, borderTopWidth: 1 },
});
