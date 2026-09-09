import { normalizeHeader, parseCsv } from '@/lib/csv';
import { supabase } from '@/lib/supabase';
import type { Lead, NewLead } from '@/types/database';

/** Header names a CRM export might use for each column we care about. */
const COLUMN_ALIASES: Record<keyof NewLead, string[]> = {
  name: ['name', 'fullname', 'contact', 'contactname', 'leadname', 'firstname'],
  phone: ['phone', 'phonenumber', 'mobile', 'telephone', 'tel', 'cell'],
  email: ['email', 'emailaddress', 'mail'],
  company: ['company', 'companyname', 'organisation', 'organization', 'account', 'business'],
  notes: ['notes', 'note', 'comments', 'comment', 'description', 'details'],
};

/**
 * Guard against someone pasting an entire CRM. Well past anything a person
 * imports by hand, and low enough that the request stays a sane size.
 */
export const MAX_IMPORT_ROWS = 5000;

/** Rows per insert request. Large enough to be few round trips, small enough
 *  that one oversized row can't blow the request limit. */
const CHUNK_SIZE = 500;

export type CsvImportPreview = {
  leads: NewLead[];
  /** Which CSV headers were understood, and which were ignored. */
  matchedColumns: string[];
  ignoredColumns: string[];
  /** Line-level problems. Rows with problems are left out of `leads`. */
  problems: string[];
};

export class CsvImportError extends Error {}

/**
 * Turn CRM CSV text into lead rows, without touching the network.
 *
 * Kept separate from the insert so the UI can show the user what it understood
 * before anything is written — a mis-mapped column is much cheaper to catch
 * here than after a few hundred rows have landed in the table.
 */
export function parseLeadsCsv(text: string): CsvImportPreview {
  const rows = parseCsv(text);
  if (rows.length === 0) throw new CsvImportError('That file is empty.');

  const headers = rows[0].map(normalizeHeader);

  // Map each lead field to the column index holding it.
  const columnIndex = {} as Record<keyof NewLead, number>;
  const matchedColumns: string[] = [];
  (Object.keys(COLUMN_ALIASES) as (keyof NewLead)[]).forEach((field) => {
    const index = headers.findIndex((h) => COLUMN_ALIASES[field].includes(h));
    columnIndex[field] = index;
    if (index !== -1) matchedColumns.push(rows[0][index].trim());
  });

  if (matchedColumns.length === 0) {
    throw new CsvImportError(
      `Couldn't find any usable columns. The first row should name the columns, ` +
        `for example: name, phone, email, company, notes. Found: ${rows[0].join(', ')}`
    );
  }

  const usedIndexes = new Set(Object.values(columnIndex).filter((i) => i !== -1));
  const ignoredColumns = rows[0]
    .map((h) => h.trim())
    .filter((h, i) => h !== '' && !usedIndexes.has(i));

  const dataRows = rows.slice(1);
  if (dataRows.length > MAX_IMPORT_ROWS) {
    throw new CsvImportError(
      `That file has ${dataRows.length} rows. Please import at most ${MAX_IMPORT_ROWS} at a time.`
    );
  }

  const leads: NewLead[] = [];
  const problems: string[] = [];

  dataRows.forEach((row, i) => {
    const lineNumber = i + 2; // +1 for the header, +1 for 1-based line numbers

    if (row.length > rows[0].length) {
      problems.push(
        `Line ${lineNumber}: more values than there are columns — skipped. ` +
          `If a value contains a comma, wrap it in double quotes.`
      );
      return;
    }

    const cell = (field: keyof NewLead): string | null => {
      const index = columnIndex[field];
      if (index === -1) return null;
      const value = (row[index] ?? '').trim();
      return value === '' ? null : value;
    };

    const lead: NewLead = {
      name: cell('name'),
      phone: cell('phone'),
      email: cell('email'),
      company: cell('company'),
      notes: cell('notes'),
    };

    // A lead with nothing in it is almost always a stray blank line.
    if (Object.values(lead).every((v) => v === null)) return;

    // Not fatal: a lead with only notes is still worth qualifying, and rejecting
    // rows over a typo in an address would be more annoying than useful.
    if (lead.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(lead.email)) {
      problems.push(`Line ${lineNumber}: "${lead.email}" doesn't look like an email address.`);
    }

    leads.push(lead);
  });

  return { leads, matchedColumns, ignoredColumns, problems };
}

export type ImportResult = { inserted: number; problems: string[] };

/**
 * Insert parsed leads for the signed-in user.
 *
 * `user_id` is stamped from the current session rather than taken from the CSV:
 * the insert policy requires it to equal auth.uid(), so a file claiming to own
 * rows for someone else is rejected by the database regardless.
 */
export async function importLeads(
  leads: NewLead[],
  problems: string[] = []
): Promise<ImportResult> {
  if (leads.length === 0) return { inserted: 0, problems };

  const { data: userData, error: userError } = await supabase.auth.getUser();
  const user = userData?.user;
  if (userError || !user) throw new CsvImportError('You are signed out. Log in and try again.');

  // Hang the leads off the user's sales department so the agent knows which set
  // of instructions applies. Absent one, the column stays null — the foreign key
  // allows it and the import is still useful.
  const { data: department } = await supabase
    .from('departments')
    .select('id')
    .eq('user_id', user.id)
    .eq('department_type', 'sales')
    .maybeSingle();

  let inserted = 0;
  for (let i = 0; i < leads.length; i += CHUNK_SIZE) {
    const chunk = leads.slice(i, i + CHUNK_SIZE).map((lead) => ({
      ...lead,
      user_id: user.id,
      department_id: department?.id ?? null,
    }));

    const { data, error } = await supabase.from('leads').insert(chunk).select('id');
    if (error) {
      throw new CsvImportError(
        inserted === 0
          ? `Import failed: ${error.message}`
          : `Imported ${inserted} leads, then hit an error: ${error.message}`
      );
    }
    inserted += data?.length ?? 0;
  }

  return { inserted, problems };
}

/** Parse and insert in one go. */
export async function importLeadsFromCsv(text: string): Promise<ImportResult> {
  const { leads, problems } = parseLeadsCsv(text);
  return importLeads(leads, problems);
}

/** Newest first. RLS limits this to the caller's own rows. */
export async function listLeads(): Promise<Lead[]> {
  const { data, error } = await supabase
    .from('leads')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as Lead[];
}
