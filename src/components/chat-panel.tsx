import { router } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { TextField } from '@/components/text-field';
import { ThemedText } from '@/components/themed-text';
import { AccentColors, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { ChatError, loadLatestConversation, sendChatMessage, type ChatKind } from '@/lib/chat';

type Turn = { role: 'user' | 'model'; content: string };

const PAGE_LABELS: Record<string, string> = {
  '/': 'Dashboard',
  '/history': 'Activity',
  '/sales': 'Sales AI',
  '/import-leads': 'CRM',
  '/cold-call': 'Cold Call',
  '/follow-ups': 'Follow-ups',
  '/marketing': 'Marketing',
  '/campaigns': 'Campaigns',
  '/content': 'Content',
};

export function ChatPanel({
  kind,
  context,
  placeholder = 'Ask anything…',
  emptyHint,
  suggestions = [],
  seedMessage,
  saveLabel,
  onSaveReply,
  height = 380,
  resume = true,
}: {
  kind: ChatKind;
  context?: Record<string, unknown>;
  placeholder?: string;
  emptyHint?: string;
  suggestions?: string[];
  /** Sent automatically once, when it becomes non-empty. */
  seedMessage?: string;
  saveLabel?: string;
  onSaveReply?: (reply: string) => Promise<void> | void;
  height?: number;
  /**
   * Reopen the most recent thread of this kind on mount. Off for surfaces that
   * are seeded per lead or per campaign, where the previous thread is about
   * something else entirely.
   */
  resume?: boolean;
}) {
  const theme = useTheme();
  const scrollRef = useRef<ScrollView>(null);
  const seededRef = useRef<string | null>(null);

  const [turns, setTurns] = useState<Turn[]>([]);
  const [conversationId, setConversationId] = useState<string | undefined>();
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [navigations, setNavigations] = useState<string[]>([]);
  const [saved, setSaved] = useState(false);
  const [hydrating, setHydrating] = useState(resume);

  useEffect(() => {
    if (!resume) return;
    let cancelled = false;
    loadLatestConversation(kind)
      .then((found) => {
        if (cancelled || !found) return;
        setConversationId(found.id);
        setTurns(found.messages.map((m) => ({ role: m.role, content: m.content })));
      })
      // A thread that won't load shouldn't block a new one being started.
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setHydrating(false);
      });
    return () => {
      cancelled = true;
    };
  }, [kind, resume]);

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || sending) return;

      setSending(true);
      setError(null);
      setNavigations([]);
      setSaved(false);
      // Shown immediately so the thread doesn't sit empty while Gemini thinks.
      setTurns((current) => [...current, { role: 'user', content: trimmed }]);

      try {
        const result = await sendChatMessage({ conversationId, kind, context, message: trimmed });
        setConversationId(result.conversationId);
        setTurns((current) => [...current, { role: 'model', content: result.reply }]);
        setNavigations(result.navigations);
      } catch (e) {
        setError(e instanceof ChatError ? e.message : 'Something went wrong. Please try again.');
      } finally {
        setSending(false);
      }
    },
    [conversationId, context, kind, sending]
  );

  useEffect(() => {
    if (seedMessage && seededRef.current !== seedMessage) {
      seededRef.current = seedMessage;
      send(seedMessage);
    }
  }, [seedMessage, send]);

  const lastReply = [...turns].reverse().find((turn) => turn.role === 'model')?.content;

  return (
    <View style={[styles.panel, { borderColor: theme.border, backgroundColor: theme.surface }]}>
      {turns.length > 0 ? (
        <View style={[styles.panelHeader, { borderColor: theme.border }]}>
          <ThemedText type="caption" themeColor="textSecondary">
            {turns.length} message{turns.length === 1 ? '' : 's'} · remembered
          </ThemedText>
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              setConversationId(undefined);
              setTurns([]);
              setNavigations([]);
              setError(null);
              setSaved(false);
            }}
          >
            <ThemedText type="caption" style={{ color: AccentColors.primary }}>
              New chat
            </ThemedText>
          </Pressable>
        </View>
      ) : null}

      <ScrollView
        ref={scrollRef}
        style={{ height }}
        contentContainerStyle={styles.thread}
        onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}
      >
        {hydrating ? (
          <ThemedText type="caption" themeColor="textSecondary" style={styles.hint}>
            Loading your conversation…
          </ThemedText>
        ) : turns.length === 0 ? (
          <ThemedText type="caption" themeColor="textSecondary" style={styles.hint}>
            {emptyHint ?? 'Start a conversation. You can keep refining the answer.'}
          </ThemedText>
        ) : (
          turns.map((turn, index) => (
            <View
              key={index}
              style={[
                styles.bubble,
                turn.role === 'user'
                  ? { alignSelf: 'flex-end', backgroundColor: theme.backgroundSelected }
                  : { alignSelf: 'flex-start', backgroundColor: theme.surfaceRaised },
              ]}
            >
              <ThemedText type="small" selectable style={styles.bubbleText}>
                {turn.content}
              </ThemedText>
            </View>
          ))
        )}

        {sending ? (
          <ThemedText type="caption" themeColor="textSecondary">
            Thinking…
          </ThemedText>
        ) : null}

        {error ? (
          <ThemedText type="caption" style={{ color: AccentColors.error }}>
            {error}
          </ThemedText>
        ) : null}

        {navigations.length > 0 ? (
          <View style={styles.navRow}>
            {navigations.map((path) => (
              <Pressable
                key={path}
                accessibilityRole="button"
                onPress={() => router.push(path as Parameters<typeof router.push>[0])}
                style={({ hovered }) => [
                  styles.navButton,
                  {
                    borderColor: AccentColors.primary,
                    backgroundColor: hovered ? theme.surfaceRaised : 'transparent',
                  },
                ]}
              >
                <ThemedText type="caption" style={{ color: AccentColors.primary }}>
                  Go to {PAGE_LABELS[path] ?? path} →
                </ThemedText>
              </Pressable>
            ))}
          </View>
        ) : null}

        {onSaveReply && lastReply && !sending ? (
          <Pressable
            accessibilityRole="button"
            onPress={async () => {
              await onSaveReply(lastReply);
              setSaved(true);
            }}
            style={({ hovered }) => [
              styles.navButton,
              {
                alignSelf: 'flex-start',
                borderColor: theme.border,
                backgroundColor: hovered ? theme.surfaceRaised : 'transparent',
              },
            ]}
          >
            <ThemedText type="caption" style={{ color: AccentColors.primary }}>
              {saved ? 'Saved ✓' : (saveLabel ?? 'Save this')}
            </ThemedText>
          </Pressable>
        ) : null}
      </ScrollView>

      {suggestions.length > 0 && turns.length === 0 ? (
        <View style={styles.suggestionRow}>
          {suggestions.map((suggestion) => (
            <Pressable
              key={suggestion}
              accessibilityRole="button"
              onPress={() => send(suggestion)}
              style={({ hovered }) => [
                styles.suggestion,
                {
                  borderColor: theme.border,
                  backgroundColor: hovered ? theme.surfaceRaised : 'transparent',
                },
              ]}
            >
              <ThemedText type="caption" themeColor="textSecondary">
                {suggestion}
              </ThemedText>
            </Pressable>
          ))}
        </View>
      ) : null}

      <View style={[styles.composer, { borderColor: theme.border }]}>
        <View style={styles.composerInput}>
          <TextField
            placeholder={placeholder}
            value={input}
            onChangeText={setInput}
            onSubmitEditing={() => {
              const text = input;
              setInput('');
              send(text);
            }}
            returnKeyType="send"
            multiline
            style={styles.input}
          />
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Send message"
          disabled={sending || !input.trim()}
          onPress={() => {
            const text = input;
            setInput('');
            send(text);
          }}
          style={[
            styles.send,
            { backgroundColor: AccentColors.primary, opacity: sending || !input.trim() ? 0.5 : 1 },
          ]}
        >
          <ThemedText type="caption" style={styles.sendText}>
            Send
          </ThemedText>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { borderWidth: 1, borderRadius: Radius.card, overflow: 'hidden' },
  panelHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderBottomWidth: 1,
  },
  thread: { gap: Spacing.two, padding: Spacing.three },
  hint: { paddingVertical: Spacing.three },
  bubble: {
    maxWidth: '88%',
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Radius.card,
  },
  bubbleText: { lineHeight: 21 },
  navRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  navButton: {
    borderWidth: 1,
    borderRadius: Radius.control,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two - 2,
  },
  suggestionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.two,
  },
  suggestion: {
    borderWidth: 1,
    borderRadius: Radius.pill,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one + 2,
  },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: Spacing.two,
    padding: Spacing.two,
    borderTopWidth: 1,
  },
  composerInput: { flex: 1 },
  input: { minHeight: 40, maxHeight: 120 },
  send: {
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.three,
    borderRadius: Radius.control,
  },
  sendText: { color: '#0d0d0d', fontWeight: 700 },
});
