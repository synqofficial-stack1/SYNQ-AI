// Finds real businesses on Google Maps and writes them into a run as prospects.
//
// Every prospect in this system must be traceable to a place that actually
// exists. That is why discovery is a directory lookup and never a model call: a
// language model asked for "20 restaurants in Hyderabad with phone numbers"
// will produce twenty plausible names and twenty plausible numbers, and those
// numbers would then be dialled. Google Places returns businesses that are
// listed, with the number they published.
//
// Screening happens here too, alongside the insert, so a prospect cannot reach
// the calling function without having passed it.

import { createClient } from 'jsr:@supabase/supabase-js@2';

const PLACES_ENDPOINT = 'https://places.googleapis.com/v1/places:searchText';

// Phone number and website sit in the Places "Enterprise" billing tier. The
// phone number is the entire point of this call, so that tier is unavoidable —
// but the mask stays tight, because every extra field is billed and nothing
// here needs one.
const FIELD_MASK = [
  'places.id',
  'places.displayName',
  'places.formattedAddress',
  'places.nationalPhoneNumber',
  'places.internationalPhoneNumber',
  'places.websiteUri',
  'places.primaryTypeDisplayName',
].join(',');

const MAX_RESULTS = 20;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

type PlaceResult = {
  id?: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  nationalPhoneNumber?: string;
  internationalPhoneNumber?: string;
  websiteUri?: string;
  primaryTypeDisplayName?: { text?: string };
};

function normalizePhone(phone: string): string {
  return phone.replace(/[^\d]/g, '');
}

/**
 * Mirrors src/lib/sales/compliance.ts. Duplicated rather than shared because an
 * edge function cannot import from the app bundle — and of the two copies this
 * is the one that decides what gets written, so it is the one that governs.
 */
function screen(
  phone: string | null,
  source: string,
  suppressed: Set<string>
): { eligibility: 'eligible' | 'excluded'; reason: string } {
  if (!phone || normalizePhone(phone).length < 8) {
    return { eligibility: 'excluded', reason: 'No usable phone number.' };
  }
  if (suppressed.has(normalizePhone(phone))) {
    return {
      eligibility: 'excluded',
      reason: 'Already asked not to be contacted. Permanently suppressed.',
    };
  }
  if (source === 'imported_leads') {
    return { eligibility: 'eligible', reason: 'Your own contact record.' };
  }
  return {
    eligibility: 'eligible',
    reason: 'Publicly listed business number. Needs your confirmation before dialling.',
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return json({ error: 'Not signed in.' }, 401);

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_ANON_KEY') ?? '',
    { global: { headers: { Authorization: authHeader } } }
  );

  const { data: userData, error: userError } = await supabase.auth.getUser();
  const user = userData?.user;
  if (userError || !user) return json({ error: 'Not signed in.' }, 401);

  let body: { run_id?: string; industry?: string; location?: string; limit?: number };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Bad request body.' }, 400);
  }

  const runId = String(body.run_id ?? '');
  if (!runId) return json({ error: 'Which run is this for?' }, 400);

  // RLS scopes this to the caller, so a forged run id simply finds nothing.
  const { data: run } = await supabase
    .from('sales_runs')
    .select('id, industry, location, target_count')
    .eq('id', runId)
    .maybeSingle();
  if (!run) return json({ error: 'That run does not exist.' }, 404);

  const industry = String(body.industry ?? run.industry ?? '').trim();
  const location = String(body.location ?? run.location ?? '').trim();
  const limit = Math.min(
    Number(body.limit ?? run.target_count ?? MAX_RESULTS) || MAX_RESULTS,
    MAX_RESULTS
  );

  async function block(reason: string, status: number) {
    await supabase
      .from('sales_runs')
      .update({ status: 'blocked', blocked_reason: reason })
      .eq('id', runId);
    return json({ error: reason }, status);
  }

  if (!location) return block('Which city or area should I search?', 400);

  const apiKey = Deno.env.get('GOOGLE_PLACES_API_KEY');
  if (!apiKey) {
    return block(
      'Google Maps search is not connected. Add a GOOGLE_PLACES_API_KEY secret in Supabase, with the Places API (New) enabled on that key.',
      503
    );
  }

  await supabase.from('sales_runs').update({ status: 'discovering' }).eq('id', runId);

  const textQuery = industry ? `${industry} in ${location}` : `businesses in ${location}`;

  let places: PlaceResult[] = [];
  try {
    const response = await fetch(PLACES_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': FIELD_MASK,
      },
      body: JSON.stringify({ textQuery, maxResultCount: limit }),
    });

    if (!response.ok) {
      const detail = await response.text();
      let reason = `Google Maps search failed (${response.status}).`;
      if (response.status === 403) {
        reason =
          'Google rejected the Places key. Check that Places API (New) is enabled on it and that billing is turned on for that Google Cloud project.';
      } else if (response.status === 400 && detail.includes('FieldMask')) {
        reason = 'Google rejected the field list on the Places request.';
      } else if (response.status === 429) {
        reason = 'Google Maps rate limit reached. Try again in a minute.';
      }
      return block(reason, 502);
    }

    places = ((await response.json())?.places ?? []) as PlaceResult[];
  } catch {
    return block('Could not reach Google Maps. Check the connection and try again.', 502);
  }

  if (places.length === 0) {
    return block(
      `No businesses found for "${textQuery}". Try a broader area or a different category.`,
      404
    );
  }

  await supabase.from('sales_runs').update({ status: 'screening' }).eq('id', runId);

  // Anyone who has already said no, in any earlier run or manual call.
  const { data: priorCalls } = await supabase
    .from('calls')
    .select('outcome, leads ( phone )')
    .in('outcome', ['not_interested', 'wrong_number']);

  const suppressed = new Set<string>();
  for (const call of priorCalls ?? []) {
    const phone = (call as { leads?: { phone?: string | null } }).leads?.phone;
    if (phone) suppressed.add(normalizePhone(phone));
  }

  // Google can return the same business twice across name variants. A duplicate
  // here is a second phone call to the same person.
  const seen = new Set<string>();
  const rows: Record<string, unknown>[] = [];
  for (const place of places) {
    const phone = place.internationalPhoneNumber ?? place.nationalPhoneNumber ?? null;
    const key = phone ? normalizePhone(phone) : (place.id ?? place.displayName?.text ?? '');
    if (!key || seen.has(key)) continue;
    seen.add(key);

    const verdict = screen(phone, 'google_places', suppressed);
    rows.push({
      user_id: user.id,
      run_id: runId,
      name: place.displayName?.text ?? 'Unnamed business',
      phone,
      website: place.websiteUri ?? null,
      address: place.formattedAddress ?? null,
      category: place.primaryTypeDisplayName?.text ?? null,
      source: 'google_places',
      source_ref: place.id ?? null,
      eligibility: verdict.eligibility,
      eligibility_reason: verdict.reason,
    });
  }

  const { error: insertError } = await supabase.from('prospects').insert(rows);
  if (insertError) return json({ error: insertError.message }, 500);

  const eligible = rows.filter((r) => r.eligibility === 'eligible').length;

  await supabase
    .from('sales_runs')
    .update({
      status: 'awaiting_approval',
      blocked_reason: null,
      source: 'google_places',
      industry: industry || null,
      location,
    })
    .eq('id', runId);

  return json({
    found: rows.length,
    eligible,
    excluded: rows.length - eligible,
    query: textQuery,
  });
});
