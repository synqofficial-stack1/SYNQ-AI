import { supabase } from '@/lib/supabase';
import { notifyAnalyticsChanged } from '@/lib/analytics-events';

export const CHAT_KINDS = ['assistant', 'sales_ai', 'crm', 'content', 'campaign'] as const;
export type ChatKind = (typeof CHAT_KINDS)[number];

export type ChatMessage = {
  id: string;
  role: 'user' | 'model';
  content: string;
  created_at: string;
};

export type ChatReply = {
  conversationId: string;
  reply: string;
  /** Paths the assistant offered as buttons. Empty for every other kind. */
  navigations: string[];
};

export class ChatError extends Error {}

/**
 * Send one turn. The Edge Function owns the thread: it stores both messages and
 * replays the history to Gemini, so the client never has to hold or resend it.
 */
export async function sendChatMessage(input: {
  conversationId?: string;
  kind: ChatKind;
  context?: Record<string, unknown>;
  message: string;
}): Promise<ChatReply> {
  const { data, error } = await supabase.functions.invoke('chat', {
    body: {
      conversation_id: input.conversationId,
      kind: input.kind,
      context: input.context,
      message: input.message,
    },
  });

  if (error) {
    // The user turn may already have been persisted by the function.
    notifyAnalyticsChanged();
    // supabase-js flattens any non-2xx into "Edge Function returned a non-2xx
    // status code" and hides the real body on `context`. Dig it out, or the user
    // sees nothing they can act on.
    const response = (error as { context?: Response }).context;
    if (response && typeof response.json === 'function') {
      try {
        const body = await response.json();
        if (body?.error) throw new ChatError(body.error);
      } catch (e) {
        if (e instanceof ChatError) throw e;
        // Body wasn't JSON; fall through to the wording below.
      }
    }
    if (error.name === 'FunctionsFetchError' || /failed to send/i.test(error.message)) {
      throw new ChatError(
        "Couldn't reach the AI service. If this is a fresh setup, the chat function may not be deployed yet."
      );
    }
    throw new ChatError(error.message);
  }

  if (!data?.reply) throw new ChatError('The agent returned nothing. Please try again.');
  notifyAnalyticsChanged();
  return {
    conversationId: data.conversation_id,
    reply: data.reply,
    navigations: data.navigations ?? [],
  };
}

/**
 * The most recent thread of a given kind, so a chat survives navigating away.
 * Without this every visit starts a fresh conversation and the agent loses
 * everything said earlier — the history was in the database, just never reopened.
 */
export async function loadLatestConversation(
  kind: ChatKind
): Promise<{ id: string; messages: ChatMessage[] } | null> {
  const { data, error } = await supabase
    .from('conversations')
    .select('id')
    .eq('kind', kind)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) return null;
  return { id: data.id, messages: await loadMessages(data.id) };
}

export type ConversationSummary = {
  id: string;
  title: string | null;
  updated_at: string;
};

/** Recent conversations for this agent. RLS scopes the list to the signed-in user. */
export async function listConversations(
  kind: ChatKind,
  limit = 100
): Promise<ConversationSummary[]> {
  const { data, error } = await supabase
    .from('conversations')
    .select('id, title, updated_at')
    .eq('kind', kind)
    .order('updated_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []) as ConversationSummary[];
}

/** Full thread, oldest first. RLS limits this to the caller's own rows. */
export async function loadMessages(conversationId: string): Promise<ChatMessage[]> {
  const { data, error } = await supabase
    .from('messages')
    .select('id, role, content, created_at')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as ChatMessage[];
}
