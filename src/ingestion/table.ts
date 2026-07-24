/**
 * Minimal tabular data model + RFC-4180-ish CSV parser.
 *
 * The engine ingests claims/UM/appeals extracts as tables. We keep an explicit
 * header list and rows-as-objects keyed by header so column-mapping and PHI
 * scanning can operate by column.
 */

export interface Table {
  headers: string[];
  rows: Array<Record<string, string>>;
  /** Provenance for audit + methodology provenance mapping. */
  source: string;
}

/** Parse CSV text into a Table. Handles quoted fields, embedded commas/quotes/newlines. */
export function parseCsv(text: string, source: string): Table {
  // Strip a UTF-8 BOM if present.
  const input = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

  const records: string[][] = [];
  let field = '';
  let record: string[] = [];
  let inQuotes = false;
  let i = 0;
  const n = input.length;

  const endField = () => {
    record.push(field);
    field = '';
  };
  const endRecord = () => {
    endField();
    records.push(record);
    record = [];
  };

  while (i < n) {
    const c = input[i]!;
    if (inQuotes) {
      if (c === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += c;
      i++;
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (c === ',') {
      endField();
      i++;
      continue;
    }
    if (c === '\r') {
      // handle \r\n and lone \r
      if (input[i + 1] === '\n') i++;
      endRecord();
      i++;
      continue;
    }
    if (c === '\n') {
      endRecord();
      i++;
      continue;
    }
    field += c;
    i++;
  }
  // flush trailing field/record if the file did not end with a newline
  if (field.length > 0 || record.length > 0) endRecord();

  if (records.length === 0) return { headers: [], rows: [], source };

  const headers = (records[0] ?? []).map((h) => h.trim());
  const rows: Array<Record<string, string>> = [];
  for (let r = 1; r < records.length; r++) {
    const cells = records[r]!;
    // skip fully-empty trailing rows
    if (cells.length === 1 && cells[0] === '') continue;
    const obj: Record<string, string> = {};
    for (let c = 0; c < headers.length; c++) {
      obj[headers[c]!] = (cells[c] ?? '').trim();
    }
    rows.push(obj);
  }
  return { headers, rows, source };
}

/** All non-empty values in a column. */
export function columnValues(table: Table, header: string): string[] {
  const out: string[] = [];
  for (const row of table.rows) {
    const v = row[header];
    if (v !== undefined && v !== '') out.push(v);
  }
  return out;
}
