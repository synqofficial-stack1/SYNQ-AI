import { router } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { TextField } from '@/components/text-field';
import { AIUsageNotice } from '@/components/ai-usage-notice';
import { VideoActions } from '@/components/video-actions';
import { ThemedText } from '@/components/themed-text';
import { AccentColors, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import {
  ChatError,
  listConversations,
  loadLatestConversation,
  loadMessages,
  sendChatMessage,
  type ChatKind,
  type ConversationSummary,
} from '@/lib/chat';

type Turn = { role: 'user' | 'model'; content: string };

const PAGE_LABELS: Record<string, string> = {
  '/': 'Dashboard',
  '/history': 'Activity',
  '/sales': 'Sales',
  '/import-leads': 'CRM',
  '/cold-call': 'Cold Call',
  '/follow-ups': 'Follow-ups',
  '/marketing': 'Marketing',
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
  onReply,
  enableVideo = false,
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
  /**
   * Fired after every model reply. A tool the agent ran may have changed rows
   * the surrounding screen is showing, and the screen has no other way to know.
   */
  onReply?: () => void;
  /** Shows the video generation action, which only Marketing wants today. */
  enableVideo?: boolean;
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
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const selectionRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    const selection = ++selectionRef.current;
    setConversationId(undefined);
    setTurns([]);
    setHydrating(resume);
    setHistoryLoading(true);

    listConversations(kind)
      .then((items) => {
        if (!cancelled) setConversations(items);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setHistoryLoading(false);
      });

    if (!resume) {
      setHydrating(false);
      return () => {
        cancelled = true;
      };
    }

    loadLatestConversation(kind)
      .then((found) => {
        if (cancelled || selection !== selectionRef.current || !found) return;
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

  async function openConversation(item: ConversationSummary) {
    const selection = ++selectionRef.current;
    setHydrating(true);
    setHistoryOpen(false);
    setError(null);
    try {
      const messages = await loadMessages(item.id);
      if (selection !== selectionRef.current) return;
      setConversationId(item.id);
      setTurns(messages.map((message) => ({ role: message.role, content: message.content })));
      setNavigations([]);
      setSaved(false);
    } catch (e) {
      if (selection === selectionRef.current) {
        setError(e instanceof Error ? e.message : 'Could not open that chat.');
      }
    } finally {
      if (selection === selectionRef.current) setHydrating(false);
    }
  }

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
        onReply?.();
      } catch (e) {
        setError(e instanceof ChatError ? e.message : 'Something went wrong. Please try again.');
      } finally {
        setSending(false);
        listConversations(kind).then(setConversations).catch(() => {});
      }
    },
    [conversationId, context, kind, onReply, sending]
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
      <AIUsageNotice sending={sending} />
      <View style={[styles.panelHeader, { borderColor: theme.border }]}>
        <ThemedText type="caption" themeColor="textSecondary">
          {turns.length > 0
            ? `${turns.length} message${turns.length === 1 ? '' : 's'} · saved`
            : 'Your conversations'}
        </ThemedText>
        <View style={styles.headerActions}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Show previous chats"
            disabled={sending}
            onPress={() => setHistoryOpen((open) => !open)}
          >
            <ThemedText type="caption" style={{ color: AccentColors.primary }}>
              {historyOpen ? 'Hide chats' : `Previous chats${conversations.length ? ` (${conversations.length})` : ''}`}
            </ThemedText>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            disabled={sending}
            onPress={() => {
              selectionRef.current += 1;
              setConversationId(undefined);
              setTurns([]);
              setNavigations([]);
              setError(null);
              setSaved(false);
              setHistoryOpen(false);
            }}
          >
            <ThemedText type="caption" style={{ color: AccentColors.primary }}>
              New chat
            </ThemedText>
          </Pressable>
        </View>
      </View>

      {historyOpen ? (
        <ScrollView
          style={[styles.historyList, { borderBottomColor: theme.border }]}
          nestedScrollEnabled
          keyboardShouldPersistTaps="handled"
        >
          {historyLoading ? (
            <ThemedText type="caption" themeColor="textSecondary" style={styles.historyEmpty}>
              Loading chats…
            </ThemedText>
          ) : conversations.length === 0 ? (
            <ThemedText type="caption" themeColor="textSecondary" style={styles.historyEmpty}>
              No previous chats for this assistant yet.
            </ThemedText>
          ) : (
            conversations.map((item) => (
              <Pressable
                key={item.id}
                accessibilityRole="button"
                accessibilityLabel={`Open chat ${item.title || 'Untitled chat'}`}
                disabled={sending}
                onPress={() => openConversation(item)}
                style={({ hovered }) => [
                  styles.historyItem,
                  {
                    backgroundColor:
                      item.id === conversationId || hovered ? theme.surfaceRaised : 'transparent',
                  },
                ]}
              >
                <ThemedText type="caption" numberOfLines={1} style={styles.historyTitle}>
                  {item.title || 'Untitled chat'}
                </ThemedText>
                <ThemedText type="caption" themeColor="textSecondary">
                  {new Date(item.updated_at).toLocaleDateString(undefined, {
                    month: 'short',
                    day: 'numeric',
                  })}
                </ThemedText>
              </Pressable>
            ))
          )}
        </ScrollView>
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

        {enableVideo ? (
          <VideoActions conversationId={conversationId} suggestedPrompt={lastReply} />
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
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  historyList: { maxHeight: 180, borderBottomWidth: 1 },
  historyEmpty: { paddingHorizontal: Spacing.three, paddingVertical: Spacing.two },
  historyItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  historyTitle: { flex: 1 },
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
