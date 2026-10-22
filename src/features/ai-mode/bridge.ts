import { supabase } from '@/lib/supabase';
import { generateImage, imageUrl } from '@/lib/images';
import { loadMessages } from '@/lib/chat';
import { AICreditError, getAIUsage } from '@/lib/ai-usage';

type Attachment = { name: string; kind: string; dataUrl?: string; size?: number };
type Message = { role: 'user' | 'assistant'; content: string; image?: string; imagePath?: string; attachments?: Attachment[] };
type Chat = { id: string; title: string; dept: string; messages: Message[]; updatedAt: number; pinned?: boolean };
type ThreadLink = { id: string; kind: string };

// The reference UI keeps browser history. Scope that cache to the signed-in user;
// provider credentials and database authorization remain with Supabase.
export function storageFor(userId: string) {
  return {
    get<T>(key: string, fallback: T): T {
      try { return JSON.parse(localStorage.getItem(`synq-ai:${userId}:${key}`) || 'null') ?? fallback; }
      catch { return fallback; }
    },
    set(key: string, value: unknown) {
      try {
        // Attachment bytes are sent only with the request, not cached in browser storage.
        const json = JSON.stringify(value, (key, value) => key === 'dataUrl' ? undefined : value);
        localStorage.setItem(`synq-ai:${userId}:${key}`, json);
        return true;
      } catch { return false; }
    },
  };
}

const kindFor = (dept: string) => dept === 'general' ? 'assistant' : dept === 'marketing' ? 'content' : 'sales_ai';

/** Persist a chat's department on its Supabase conversation when it has a cloud thread. */
export async function moveCloudChat(userId: string, chatId: string, dept: string): Promise<void> {
  const store = storageFor(userId);
  const links = store.get<Record<string, ThreadLink>>('thread-links', {});
  const link = links[chatId];
  if (!link) return; // A local-only chat will still keep its department in the user-scoped cache.
  const kind = kindFor(dept);
  const { data, error } = await supabase.from('conversations')
    .update({ kind })
    .eq('id', link.id)
    .eq('user_id', userId)
    .select('id')
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('This chat could not be moved. Refresh your chat history and try again.');
  store.set('thread-links', { ...links, [chatId]: { ...link, kind } });
}

export async function loadHistory(userId: string): Promise<Chat[]> {
  const store = storageFor(userId);
  const links = store.get<Record<string, ThreadLink>>('thread-links', {});
  const cached = store.get<Chat[]>('sa_chats', []);
  const { data, error } = await supabase.from('conversations').select('id,title,kind,updated_at')
    .in('kind', ['assistant', 'sales_ai', 'content', 'campaign', 'crm']).order('updated_at', { ascending: false }).limit(100);
  if (error) throw error;
  const imported = await Promise.all((data ?? []).filter((c) => !cached.some((local) => (links[local.id]?.id || local.id) === c.id)).map(async (c) => {
    const messages = await loadMessages(c.id);
    links[c.id] = { id: c.id, kind: c.kind };
    return { id: c.id, title: c.title || 'Untitled chat', dept: c.kind === 'assistant' ? 'general' : ['content', 'campaign'].includes(c.kind) ? 'marketing' : 'sales', updatedAt: Date.parse(c.updated_at), messages: messages.map((m) => ({ role: m.role === 'model' ? 'assistant' as const : 'user' as const, content: m.content })) };
  }));
  store.set('thread-links', { ...store.get<Record<string, ThreadLink>>('thread-links', {}), ...links });
  return imported;
}

export async function refreshImages(chats: Chat[]): Promise<Chat[]> {
  return Promise.all(chats.map(async (chat) => ({ ...chat, messages: await Promise.all(chat.messages.map(async (message) => {
    if (!message.imagePath) return message;
    const { data } = await supabase.storage.from('ai-images').createSignedUrl(message.imagePath, 3600);
    return data?.signedUrl ? { ...message, image: data.signedUrl } : message;
  })) })));
}

export async function removeCloudChats(userId: string, ids: string[]): Promise<void> {
  const store = storageFor(userId);
  const links = store.get<Record<string, ThreadLink>>('thread-links', {});
  const cloudIds = ids.flatMap((id) => links[id] ? [links[id].id] : []);
  if (cloudIds.length) {
    const { error } = await supabase.from('conversations').delete().in('id', cloudIds);
    if (error) throw error;
  }
  for (const id of ids) delete links[id];
  store.set('thread-links', links);
}

async function errorDetail(error: unknown): Promise<string> {
  const response = (error as { context?: Response })?.context;
  try { if (response) return (await response.json()).error || 'The AI service could not complete this request.'; } catch { /* Fall back below. */ }
  return 'Could not reach the AI service. Please try again.';
}

export function createBridge(userId: string) {
  let supportsFilesAndEdits = false;
  return async (url: string, options?: RequestInit): Promise<Response> => {
    try {
      if (url.startsWith('/api/usage')) return Response.json(await getAIUsage());
      const body = JSON.parse(String(options?.body || '{}'));
      const department = body.dept === 'sales' ? 'sales' : 'marketing';
      if (url === '/api/image') {
        const image = await generateImage(body.prompt, department, body.height === 1920 ? '9:16' : '1:1');
        return Response.json({ url: await imageUrl(image), path: image.storage_path });
      }
      if (url === '/api/save-image') {
        const { data, error } = await supabase.functions.invoke('generate-image', { body: { action: 'save-poster', data_url: body.dataUrl, prompt: body.prompt, department } });
        if (error) return Response.json({ error: await errorDetail(error) }, { status: 502 });
        return Response.json({ url: await imageUrl(data.image), path: data.image.storage_path });
      }
      if (url !== '/api/chat') return Response.json({ error: 'Unknown action.' }, { status: 400 });
      const store = storageFor(userId);
      const links = store.get<Record<string, ThreadLink>>('thread-links', {});
      const kind = kindFor(body.dept);
      const link = links[body.chatId];
      const messages = body.messages as Message[];
      const latest = messages.at(-1);
      const useExisting = !body.edited && link?.kind === kind;
      const prior = !useExisting ? messages.slice(0, -1).filter((m) => m.content).slice(-20).map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', content: m.content.slice(0, 8000) })) : undefined;
      if (!supportsFilesAndEdits && (latest?.attachments?.length || prior?.length)) {
        const capability = await supabase.functions.invoke('chat', { body: { action: 'ai-mode-capabilities' } });
        if (capability.error || capability.data?.ai_mode_version !== 2) return Response.json({ error: 'File analysis and revised chats need the AI Mode server update. Complete the setup guide and try again.' }, { status: 503 });
        supportsFilesAndEdits = true;
      }
      const { data, error } = await supabase.functions.invoke('chat', {
        signal: options?.signal ?? undefined,
        body: { conversation_id: useExisting ? link.id : undefined, kind, context: { ai_mode: true }, message: latest?.content || 'Please analyse the attached files.',
          initial_history: prior, attachments: latest?.attachments?.filter((a) => a.dataUrl).map((a) => ({ name: a.name, data_url: a.dataUrl })), work_context: String(body.context || '').slice(0, 4000) },
      });
      if (error) {
        const response = (error as { context?: Response }).context;
        if (response?.status === 402) return Response.json(await response.json(), { status: 402 });
        return Response.json({ error: await errorDetail(error) }, { status: 502 });
      }
      if (!data?.reply || !data?.conversation_id) return Response.json({ error: 'The AI returned an empty reply. Try again.' }, { status: 502 });
      // An edit forks the server conversation. Keep the previous thread discoverable in history.
      links[body.chatId] = { id: data.conversation_id, kind };
      store.set('thread-links', { ...store.get<Record<string, ThreadLink>>('thread-links', {}), ...links });
      return new Response(data.reply, { headers: { 'Content-Type': 'text/plain' } });
    } catch (error) {
      if (error instanceof AICreditError) return Response.json({ ...error.usage, error: error.message, code: 'AI_CREDIT_LIMIT' }, { status: 402 });
      if (options?.signal?.aborted) throw error;
      return Response.json({ error: error instanceof Error ? error.message : 'Could not complete that request.' }, { status: 502 });
    }
  };
}
