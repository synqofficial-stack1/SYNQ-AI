import { supabase } from '@/lib/supabase';

// Feedback goes to the Synq team: the admins read it from the notification
// bell (through admin-console) and can mark it "Looking into it". RLS lets a
// person send and read only their own messages.

export const FEEDBACK_MAX = 2000;

export type MyFeedback = { id: string; body: string; createdAt: string; acknowledgedAt: string | null };

export async function loadMyFeedback(): Promise<MyFeedback[]> {
  const { data, error } = await supabase
    .from('feedback_messages')
    .select('id,body,created_at,acknowledged_at')
    .order('created_at', { ascending: false })
    .limit(10);
  if (error) throw new Error('Could not load your feedback. Refresh the page to try again.');
  return (data ?? []).map((row) => ({
    id: row.id,
    body: row.body,
    createdAt: row.created_at,
    acknowledgedAt: row.acknowledged_at,
  }));
}

export async function sendFeedback(body: string): Promise<void> {
  const text = body.trim();
  if (!text) throw new Error('Write a message first.');
  if (text.length > FEEDBACK_MAX) throw new Error(`Keep it under ${FEEDBACK_MAX} characters.`);
  const { error } = await supabase.from('feedback_messages').insert({ body: text });
  if (!error) return;
  // The daily limit is raised by the table's trigger in words meant for people.
  if (error.message.includes('a lot of feedback')) throw new Error(error.message);
  throw new Error('Could not send your feedback. Please try again.');
}
