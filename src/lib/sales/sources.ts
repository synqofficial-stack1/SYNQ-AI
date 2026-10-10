import { supabase } from '@/lib/supabase';
import type { Lead } from '@/types/database';

// Where prospects come from. Two implementations today:
//
//   imported_leads — the contacts already in this account's CRM. Real, works
//                    now, and carries a user-asserted lawful basis for calling.
//   google_places  — a directory search, run server-side so the API key never
//                    reaches the app bundle. Returns nothing until that key is
//                    configured, and says so rather than inventing businesses.
//
// A source never fabricates. If it has no data it reports why, and the run
// stops with a reason the user can act on.

export type DiscoveredProspect = {
  name: string;
  phone: string | null;
  website: string | null;
  address: string | null;
  category: string | null;
  source: string;
  sourceRef: string | null;
};

export type DiscoveryQuery = {
  industry?: string;
  location?: string;
  limit: number;
};

export type DiscoveryResult =
  | { ok: true; prospects: DiscoveredProspect[]; note: string }
  | { ok: false; reason: string };

export type ProspectSource = {
  id: string;
  label: string;
  /** Shown to the user before a run starts, so expectations are set honestly. */
  availability: string;
  discover(query: DiscoveryQuery): Promise<DiscoveryResult>;
};

export const importedLeadsSource: ProspectSource = {
  id: 'imported_leads',
  label: 'Your imported contacts',
  availability: 'Available — uses the contacts already in your CRM.',

  async discover(query) {
    let request = supabase
      .from('leads')
      .select('*')
      .not('phone', 'is', null)
      .order('created_at', { ascending: false })
      .limit(query.limit);

    // Industry is matched loosely against company text; CRM exports rarely
    // carry a category column, so this narrows rather than filters strictly.
    if (query.industry) request = request.ilike('company', `%${query.industry}%`);

    const { data, error } = await request;
    if (error) return { ok: false, reason: error.message };

    const leads = (data ?? []) as Lead[];
    if (leads.length === 0) {
      return {
        ok: false,
        reason: query.industry
          ? `No contacts in your CRM match "${query.industry}". Import a list, or drop the industry filter.`
          : 'No contacts with phone numbers in your CRM yet. Import a spreadsheet first.',
      };
    }

    return {
      ok: true,
      note: `${leads.length} from your own CRM.`,
      prospects: leads.map((lead) => ({
        name: lead.name ?? lead.company ?? 'Unnamed contact',
        phone: lead.phone,
        website: null,
        address: null,
        category: lead.company,
        source: 'imported_leads',
        sourceRef: lead.id,
      })),
    };
  },
};

export const googlePlacesSource: ProspectSource = {
  id: 'google_places',
  label: 'Google Places search',
  availability: 'Needs a GOOGLE_PLACES_API_KEY secret before it returns anything.',

  async discover(query) {
    if (!query.location) {
      return { ok: false, reason: 'A location is needed to search — which city or area?' };
    }

    const { data, error } = await supabase.functions.invoke('discover-prospects', {
      body: { industry: query.industry, location: query.location, limit: query.limit },
    });

    if (error) {
      const response = (error as { context?: Response }).context;
      if (response && typeof response.json === 'function') {
        try {
          const body = await response.json();
          if (body?.error) return { ok: false, reason: body.error };
        } catch {
          // Not JSON; fall through.
        }
      }
      return {
        ok: false,
        reason:
          'Directory search is not connected. Add a GOOGLE_PLACES_API_KEY secret in Supabase and deploy the discover-prospects function.',
      };
    }

    const prospects = (data?.prospects ?? []) as DiscoveredProspect[];
    if (prospects.length === 0) {
      return { ok: false, reason: data?.reason ?? 'The search returned no businesses.' };
    }
    return { ok: true, prospects, note: `${prospects.length} from Google Places.` };
  },
};

export const PROSPECT_SOURCES: Record<string, ProspectSource> = {
  [importedLeadsSource.id]: importedLeadsSource,
  [googlePlacesSource.id]: googlePlacesSource,
};

export function sourceFor(id: string): ProspectSource {
  return PROSPECT_SOURCES[id] ?? importedLeadsSource;
}
