import { supabase } from '@/lib/supabase';

/** What the screen types to confirm; the server checks the same word. */
export const DELETE_CONFIRMATION = 'DELETE';

// supabase-js reports any non-2xx as a generic error and keeps the real body on
// `context`, so the server's sentence has to be dug out for the user to see it.
async function invokeDeleteAccount(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const { data, error } = await supabase.functions.invoke('delete-account', { body });
  if (!error) return (data ?? {}) as Record<string, unknown>;
  const context = (error as { context?: Response }).context;
  if (context && typeof context.json === 'function') {
    const reply = await context.json().catch(() => null);
    if (reply?.error) throw new Error(String(reply.error));
  }
  if (error.name === 'FunctionsFetchError' || /failed to send/i.test(error.message)) {
    throw new Error('Could not reach Synq. Check your connection and try again.');
  }
  throw new Error('Could not delete your account. Try again.');
}

/** Workspaces the user owns that still have other active members; deletion is refused while any exist. */
export async function accountDeletionBlockers(): Promise<string[]> {
  const reply = await invokeDeleteAccount({ action: 'check' });
  return Array.isArray(reply.blocked_by) ? reply.blocked_by.map(String) : [];
}

/** Permanently deletes the signed-in account, then clears the local session. */
export async function deleteAccount(confirmation: string): Promise<void> {
  await invokeDeleteAccount({ confirm: confirmation.trim() });
  // The server has already invalidated the user; this only clears what is stored on the device.
  await supabase.auth.signOut({ scope: 'local' }).catch(() => undefined);
}
