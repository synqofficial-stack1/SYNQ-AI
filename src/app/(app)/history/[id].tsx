import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PrimaryButton } from '@/components/primary-button';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { supabase } from '@/lib/supabase';
import type { Task } from '@/types/database';

export default function HistoryDetailScreen() {
  const theme = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [loaded, setLoaded] = useState<{
    id: string;
    task: Task | null;
    error: string | null;
  } | null>(null);
  const task = loaded?.id === id ? loaded.task : null;
  const loading = Boolean(id) && loaded?.id !== id;
  const error = id
    ? loaded?.id === id ? loaded.error : null
    : 'No task ID provided';

  useEffect(() => {
    if (!id) return;
    let active = true;
    void (async () => {
      try {
        const { data, error: queryError } = await supabase
          .from('tasks')
          .select('*')
          .eq('id', id)
          .maybeSingle();
        if (queryError) throw new Error(queryError.message);
        if (!data) throw new Error('Task not found');
        return { task: data as Task, error: null };
      } catch (e) {
        return {
          task: null,
          error: e instanceof Error
            ? e.message
            : 'Could not load task. Check your connection.',
        };
      }
    })().then((result) => {
      if (active) setLoaded({ id, ...result });
    });
    return () => {
      active = false;
    };
  }, [id]);

  const formatDate = (isoDate: string) => {
    const date = new Date(isoDate);
    return date.toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  };

  const formatTaskType = (type: string): string => {
    switch (type) {
      case 'qualify_lead':
        return 'Qualify lead';
      case 'draft_outreach_email':
        return 'Draft outreach email';
      case 'draft_call_script':
        return 'Draft call script';
      default:
        return type;
    }
  };

  const getStatusLabel = (status: string): string => {
    switch (status) {
      case 'completed':
        return '✓ Completed';
      case 'failed':
        return '✗ Failed';
      case 'running':
        return '… Running';
      case 'pending':
        return '⊙ Pending';
      default:
        return status;
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

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ScrollView contentContainerStyle={styles.content}>
          <ThemedText type="subtitle">Task Details</ThemedText>

          {loading ? (
            <View style={styles.center}>
              <ActivityIndicator />
            </View>
          ) : error ? (
            <View style={styles.center}>
              <ThemedText style={styles.error}>{error}</ThemedText>
            </View>
          ) : task ? (
            <>
              {/* Metadata */}
              <View style={[styles.panel, { backgroundColor: theme.backgroundElement }]}>
                <View style={styles.metaRow}>
                  <ThemedText type="small" themeColor="textSecondary">
                    Type
                  </ThemedText>
                  <ThemedText type="smallBold">{formatTaskType(task.task_type)}</ThemedText>
                </View>

                <View style={styles.metaRow}>
                  <ThemedText type="small" themeColor="textSecondary">
                    Status
                  </ThemedText>
                  <ThemedText
                    type="smallBold"
                    style={{ color: getStatusColor(task.status) }}
                  >
                    {getStatusLabel(task.status)}
                  </ThemedText>
                </View>

                <View style={styles.metaRow}>
                  <ThemedText type="small" themeColor="textSecondary">
                    Created
                  </ThemedText>
                  <ThemedText type="small">{formatDate(task.created_at)}</ThemedText>
                </View>

                {task.completed_at && (
                  <View style={styles.metaRow}>
                    <ThemedText type="small" themeColor="textSecondary">
                      Completed
                    </ThemedText>
                    <ThemedText type="small">{formatDate(task.completed_at)}</ThemedText>
                  </View>
                )}
              </View>

              {/* Output */}
              {task.output ? (
                <View style={[styles.panel, { backgroundColor: theme.backgroundElement }]}>
                  <ThemedText type="smallBold">Result</ThemedText>
                  <ThemedText
                    type="default"
                    selectable
                    style={styles.output}
                  >
                    {task.output}
                  </ThemedText>
                </View>
              ) : task.status === 'failed' ? (
                <View style={[styles.panel, { backgroundColor: theme.backgroundElement }]}>
                  <ThemedText type="smallBold">Error</ThemedText>
                  <ThemedText type="small" style={styles.error}>
                    {task.output || 'Task failed'}
                  </ThemedText>
                </View>
              ) : null}

              {/* Input (if available) */}
              {task.input && Object.keys(task.input).length > 0 && (
                <View style={[styles.panel, { backgroundColor: theme.backgroundElement }]}>
                  <ThemedText type="smallBold">Input</ThemedText>
                  {Object.entries(task.input as Record<string, unknown>)
                    .filter(([, value]) => value !== null && value !== undefined && value !== '')
                    .map(([key, value]) => (
                      <ThemedText
                        key={key}
                        type="small"
                        selectable
                        themeColor={key === 'lead_id' ? 'textSecondary' : undefined}
                        style={styles.inputText}
                      >
                        {key === 'lead_id' ? `Lead ID: ${String(value)}` : String(value)}
                      </ThemedText>
                    ))}
                </View>
              )}
            </>
          ) : null}

          <View style={styles.footer}>
            <PrimaryButton
              title="Back"
              onPress={() => (router.canGoBack() ? router.back() : router.replace('/(app)/history'))}
            />
          </View>
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safeArea: { flex: 1 },
  content: {
    gap: Spacing.two,
    padding: Spacing.four,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 200,
  },
  panel: {
    gap: Spacing.two,
    padding: Spacing.three,
    borderRadius: 12,
  },
  metaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  output: {
    lineHeight: 22,
    fontFamily: 'monospace',
  },
  inputText: {
    fontFamily: 'monospace',
    marginTop: Spacing.one,
  },
  error: { color: '#e5484d' },
  footer: {
    marginTop: Spacing.four,
    gap: Spacing.two,
  },
});
