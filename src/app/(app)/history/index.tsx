import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState, type ComponentType } from 'react';
import { StyleSheet, View } from 'react-native';

import {
  AlertIcon,
  CalendarIcon,
  ChatIcon,
  ClockIcon,
  ImageIcon,
  MailIcon,
  SendIcon,
  SparkIcon,
  TargetIcon,
  UserIcon,
  UsersIcon,
  VideoIcon,
  type IconProps,
} from '@/components/icons';
import { ThemedText } from '@/components/themed-text';
import { Card, EmptyState, ErrorState, IconTile, ListRow, LoadingState, Page, PageHeader, StatusBadge } from '@/components/ui';
import { DataColors } from '@/constants/theme';
import { useSession } from '@/hooks/use-session';
import { loadMyHistory, type HistoryEntry, type HistoryKind } from '@/lib/history';
import { relativeTime } from '@/lib/workspace';

// Everything the signed-in person has done in Synq, newest first. It reloads
// whenever the page comes back into view and every few seconds while open, so
// a chat, video or email duty shows up here shortly after it happens.

const REFRESH_MS = 15_000;

const ICON: Record<HistoryKind, { icon: ComponentType<IconProps>; color: string }> = {
  chat: { icon: ChatIcon, color: DataColors.sales },
  video: { icon: VideoIcon, color: DataColors.marketing },
  task: { icon: SparkIcon, color: DataColors.sales },
  lead: { icon: UsersIcon, color: DataColors.company },
  run: { icon: TargetIcon, color: DataColors.sales },
  email: { icon: MailIcon, color: DataColors.sales },
  meeting: { icon: CalendarIcon, color: DataColors.marketing },
  image: { icon: ImageIcon, color: DataColors.marketing },
  post: { icon: SendIcon, color: DataColors.marketing },
  account: { icon: UserIcon, color: DataColors.neutral },
  other: { icon: AlertIcon, color: DataColors.neutral },
};

const STATUS: Record<NonNullable<HistoryEntry['status']>, { label: string; tone: 'success' | 'danger' | 'warning' }> = {
  done: { label: 'Done', tone: 'success' },
  failed: { label: 'Failed', tone: 'danger' },
  pending: { label: 'In progress', tone: 'warning' },
};

function dayLabel(iso: string): string {
  const date = new Date(iso);
  const today = new Date();
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
  if (date.toDateString() === today.toDateString()) return 'Today';
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return date.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
}

export default function HistoryScreen() {
  const { session } = useSession();
  const userId = session?.user.id;
  const [entries, setEntries] = useState<HistoryEntry[] | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!userId) return;
    try {
      setEntries(await loadMyHistory(userId));
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load your history.');
    }
  }, [userId]);

  useFocusEffect(
    useCallback(() => {
      void load();
      const timer = setInterval(() => void load(), REFRESH_MS);
      return () => clearInterval(timer);
    }, [load]),
  );

  const groups: { day: string; items: HistoryEntry[] }[] = [];
  for (const entry of entries ?? []) {
    const day = dayLabel(entry.createdAt);
    const group = groups[groups.length - 1];
    if (group?.day === day) group.items.push(entry);
    else groups.push({ day, items: [entry] });
  }

  return (
    <Page maxWidth={860}>
      <PageHeader title="History" description="Everything you have done in Synq, newest first. It updates as you work." />
      {error && !entries ? (
        <ErrorState message={error} onRetry={() => void load()} />
      ) : !entries ? (
        <LoadingState label="Loading your history…" />
      ) : entries.length === 0 ? (
        <EmptyState icon={ClockIcon} title="Nothing here yet" description="Chats, videos, email duties, meetings, images and posts you create will appear here." />
      ) : (
        groups.map((group) => (
          <View key={group.day} style={styles.group}>
            <ThemedText type="smallBold" themeColor="textSecondary" accessibilityRole="header">
              {group.day}
            </ThemedText>
            <Card padded={false}>
              {group.items.map((entry, index) => {
                const look = ICON[entry.kind];
                const status = entry.status ? STATUS[entry.status] : null;
                const path = entry.path;
                return (
                  <ListRow
                    key={entry.id}
                    title={entry.title}
                    subtitle={[relativeTime(entry.createdAt), entry.detail].filter(Boolean).join(' · ')}
                    leading={<IconTile icon={look.icon} color={look.color} size={36} />}
                    trailing={status ? <StatusBadge label={status.label} tone={status.tone} /> : undefined}
                    onPress={path ? () => router.push(path as Parameters<typeof router.push>[0]) : undefined}
                    divider={index < group.items.length - 1}
                  />
                );
              })}
            </Card>
          </View>
        ))
      )}
    </Page>
  );
}

const styles = StyleSheet.create({
  group: { gap: 8 },
});
