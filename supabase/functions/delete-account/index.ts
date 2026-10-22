// Deletes the signed-in user's account and everything that belongs to it.
//
// Called from Settings in the app and from the public /delete-account page,
// which Google Play requires so people can delete without reinstalling. The
// caller must send `confirm: "DELETE"`; the app makes them type it.
//
// Order matters. Files go first through the Storage API (storage rows cannot be
// deleted with SQL); if that fails nothing else has happened yet and the user
// can retry. Then `delete_account` removes the user's own workspaces and the
// auth user in one transaction, and every other row cascades from auth.users.
//
// A workspace owner with other active members is refused, with the workspace
// names, because there is no ownership transfer yet and deleting them would
// take a shared CRM away from the rest of the team.

// eslint-disable-next-line import/no-unresolved -- Deno resolves the JSR registry.
import { createClient } from 'jsr:@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...CORS, 'Content-Type': 'application/json' },
});

/** The Storage API takes at most 1,000 paths per remove; stay well under it. */
const REMOVE_BATCH = 100;

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (request.method !== 'POST') return json({ error: 'Use POST.' }, 405);

  const url = Deno.env.get('SUPABASE_URL') ?? '';
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!serviceKey) return json({ error: 'Account deletion is not configured on the server.' }, 503);

  const authorization = request.headers.get('Authorization');
  if (!authorization) return json({ error: 'Sign in to delete your account.' }, 401);
  const caller = createClient(url, anonKey, { global: { headers: { Authorization: authorization } } });
  const { data: auth, error: authError } = await caller.auth.getUser();
  if (authError || !auth.user) return json({ error: 'Sign in again to delete your account.' }, 401);
  const userId = auth.user.id;

  let body: { action?: unknown; confirm?: unknown };
  try { body = await request.json(); } catch { return json({ error: 'Malformed request.' }, 400); }

  const db = createClient(url, serviceKey, { auth: { persistSession: false } });

  const { data: blockers, error: blockerError } = await db.rpc('account_deletion_blockers', { p_user: userId });
  if (blockerError) return json({ error: 'Could not check your workspaces. Nothing was deleted; try again.' }, 500);
  const blockedBy = Array.isArray(blockers) ? blockers.map(String) : [];

  // Lets the screen explain what will happen before the user commits.
  if (body.action === 'check') return json({ blocked_by: blockedBy });

  if (body.confirm !== 'DELETE') return json({ error: 'Type DELETE to confirm.' }, 400);
  if (blockedBy.length) {
    return json({
      error: `You own ${blockedBy.join(', ')}, which still has other active members. Remove them in Company first, then delete your account.`,
      blocked_by: blockedBy,
    }, 409);
  }

  const { data: objects, error: listError } = await db.rpc('account_storage_objects', { p_user: userId });
  if (listError) return json({ error: 'Could not find your files. Nothing was deleted; try again.' }, 500);
  const byBucket = new Map<string, string[]>();
  for (const row of (objects ?? []) as { bucket_id: string; name: string }[]) {
    byBucket.set(row.bucket_id, [...(byBucket.get(row.bucket_id) ?? []), row.name]);
  }
  for (const [bucket, paths] of byBucket) {
    for (let start = 0; start < paths.length; start += REMOVE_BATCH) {
      const { error } = await db.storage.from(bucket).remove(paths.slice(start, start + REMOVE_BATCH));
      if (error) return json({ error: 'Could not remove your files. Your account was not deleted; try again.' }, 500);
    }
  }

  const { error: deleteError } = await db.rpc('delete_account', { p_user: userId });
  if (deleteError) {
    // A teammate could have been approved between the check and now.
    if (deleteError.message.includes('ACCOUNT_DELETION_BLOCKED')) {
      return json({ error: 'A workspace you own gained an active member. Remove them in Company first, then try again.' }, 409);
    }
    return json({ error: 'Your files were removed, but the account could not be deleted. Try again.' }, 500);
  }
  return json({ ok: true });
});
