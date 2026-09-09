import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PrimaryButton } from '@/components/primary-button';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { listTasks } from '@/lib/tasks';
import type { Task } from '@/types/database';

export default function HistoryScreen() {
  const theme = useTheme();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadTasks();
  }, []);

  async function loadTasks() {
    setLoading(true);
    setError(null);
    try {
      const result = await listTasks(50);
      setTasks(result);
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : 'Could not load history. Check your connection and try again.'
      );
    } finally {
      setLoading(false);
    }
  }

  const formatDate = (isoDate: string) => {
    const date = new Date(isoDate);
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const formatTaskType = (type: string): string => {
    switch (type) {
      case 'qualify_lead':
        return 'Qualify';
      case 'draft_outreach_email':
        return 'Email';
      case 'draft_call_script':
        return 'Call script';
      default:
        return type;
    }
  };

  const getStatusColor = (status: string): string => {
    switch (status) {
      case 'completed':
        return '#16a34a';
      case 'failed':
        return '#e5484d';
      case 'running':
        return '#f59e0b';
      default:
        return theme.textSecondary;
    }
  };

  const renderTask = ({ item }: { item: Task }) => (
    <Pressable
      onPress={() => router.push(`/(app)/history/${item.id}`)}
      style={[styles.taskRow, { backgroundColor: theme.backgroundElement }]}
    >
      <View style={styles.taskLeft}>
        <ThemedText type="smallBold">{formatTaskType(item.task_type)}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {formatDate(item.created_at)}
        </ThemedText>
      </View>
      <View style={styles.taskRight}>
        <ThemedText
          type="small"
          style={{
            color: getStatusColor(item.status),
            fontWeight: '600',
          }}
        >
          {item.status === 'completed' ? '✓' : item.status === 'failed' ? '✗' : '…'}
        </ThemedText>
      </View>
    </Pressable>
  );

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.header}>
          <ThemedText type="subtitle">History</ThemedText>
        </View>

        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator />
          </View>
        ) : error ? (
          <View style={styles.center}>
            <ThemedText style={styles.error}>{error}</ThemedText>
            <PrimaryButton title="Retry" onPress={loadTasks} />
          </View>
        ) : tasks.length === 0 ? (
          <View style={styles.center}>
            <ThemedText themeColor="textSecondary">No tasks yet</ThemedText>
          </View>
        ) : (
          <FlatList
            data={tasks}
            renderItem={renderTask}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.listContent}
            scrollEnabled={true}
          />
        )}

        <View style={styles.footer}>
          <PrimaryButton
            title="Back"
            onPress={() => (router.canGoBack() ? router.back() : router.replace('/(app)'))}
          />
        </View>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safeArea: { flex: 1 },
  header: {
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.four,
    paddingBottom: Spacing.two,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.three,
  },
  listContent: {
    gap: Spacing.two,
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.two,
    paddingBottom: Spacing.four,
  },
  taskRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: Spacing.three,
    borderRadius: 12,
  },
  taskLeft: {
    flex: 1,
    gap: Spacing.one,
  },
  taskRight: {
    marginLeft: Spacing.two,
  },
  error: { color: '#e5484d', textAlign: 'center' },
  footer: {
    paddingHorizontal: Spacing.four,
    paddingBottom: Spacing.four,
    gap: Spacing.two,
  },
});
