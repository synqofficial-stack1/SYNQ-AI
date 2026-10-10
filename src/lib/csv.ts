// A small RFC 4180 CSV reader.
//
// Written by hand rather than pulled in as a dependency: CRM exports are the
// only CSVs this app reads, and the format's awkward parts (quoted fields
// containing commas or newlines, doubled quotes as an escape) are a couple of
// dozen lines of state machine. Adding a parsing library for that would mean
// asking to widen the approved stack for very little.

/**
 * Split raw CSV text into rows of raw string cells.
 *
 * Handles quoted fields (`"a,b"`), escaped quotes inside them (`"he said ""hi"""`),
 * newlines inside quoted fields, both LF and CRLF line endings, and a leading
 * UTF-8 byte order mark — Excel writes one, and it would otherwise become part
 * of the first header name.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let fieldWasQuoted = false;
  // A blank final line is just the file's trailing newline, not an empty record.
  let sawAnyChar = false;

  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

  const endField = () => {
    // Unquoted fields get trimmed (CRM exports pad after commas); quoted ones
    // are taken exactly as written, since the quotes were the author saying so.
    row.push(fieldWasQuoted ? field : field.trim());
    field = '';
    fieldWasQuoted = false;
  };

  const endRow = () => {
    endField();
    if (row.some((cell) => cell !== '')) rows.push(row);
    row = [];
  };

  for (let i = 0; i < src.length; i++) {
    const char = src[i];
    sawAnyChar = true;

    if (inQuotes) {
      if (char === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"' && field === '') {
      inQuotes = true;
      fieldWasQuoted = true;
    } else if (char === ',') {
      endField();
    } else if (char === '\n') {
      endRow();
    } else if (char === '\r') {
      // Swallow; the \n that follows in a CRLF file ends the row.
    } else {
      field += char;
    }
  }

  if (sawAnyChar && (field !== '' || row.length > 0)) endRow();

  return rows;
}

/** `"  First Name "` and `"first_name"` both normalise to `firstname`. */
export function normalizeHeader(header: string): string {
  return header.toLowerCase().replace(/[\s_-]+/g, '');
}
