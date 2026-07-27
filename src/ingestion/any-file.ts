import { extname } from 'node:path';
import type { PlanDocument } from './document-reader.js';
import { planDocumentFromText } from './document-reader.js';
import type { Table } from './table.js';
import { parseCsv } from './table.js';

/**
 * Backend any-file reader. The UI sends raw bytes; the backend routes by
 * extension and extracts text (for plan documents) or a table (for claims-like
 * data). All file-type handling lives here so the front end never parses.
 *
 *   Documents (text):  .pdf (pdf-parse) · .docx (mammoth) · .txt/.md (direct)
 *   Tables:            .csv/.tsv (parser) · .xlsx/.xls (SheetJS → csv)
 */

export type UploadKind =
  | 'plan_document'
  | 'schedule_of_benefits'
  | 'claims'
  | 'prior_auth'
  | 'appeals'
  | 'network'
  | 'reimbursement'
  | 'unknown';

const DOC_EXTS = new Set(['.pdf', '.docx', '.txt', '.md', '']);
const TABLE_EXTS = new Set(['.csv', '.tsv', '.xlsx', '.xls', '.xlsm']);

export function isTableFile(name: string): boolean {
  return TABLE_EXTS.has(extname(name).toLowerCase());
}
export function isDocumentFile(name: string): boolean {
  return DOC_EXTS.has(extname(name).toLowerCase());
}

/** Read any supported plan-document file into text. */
export async function readAnyDocument(name: string, bytes: Buffer): Promise<PlanDocument> {
  const ext = extname(name).toLowerCase();
  if (ext === '.pdf') {
    const mod = await import('pdf-parse/lib/pdf-parse.js');
    const pdfParse = (mod.default ?? mod) as (b: Buffer, o?: unknown) => Promise<{ text: string; numpages: number }>;
    const data = await pdfParse(bytes, {
      pagerender: (pageData: { getTextContent: (o: unknown) => Promise<{ items: Array<{ str: string }> }> }) =>
        pageData.getTextContent({ normalizeWhitespace: true }).then((tc) => tc.items.map((i) => i.str).join(' ') + '\n\f'),
    });
    return { source: name, text: data.text, pageCount: data.numpages, format: 'pdf' };
  }
  if (ext === '.docx') {
    const mammoth = (await import('mammoth')).default as { extractRawText(o: { buffer: Buffer }): Promise<{ value: string }> };
    const { value } = await mammoth.extractRawText({ buffer: bytes });
    return { source: name, text: value, pageCount: null, format: 'text' };
  }
  if (ext === '.txt' || ext === '.md' || ext === '') {
    return planDocumentFromText(bytes.toString('utf8'), name);
  }
  throw new Error(`Unsupported document type '${ext}' for ${name}. Supported: .pdf, .docx, .txt, .md.`);
}

/** Read any supported tabular file (claims-like data) into a Table. */
export async function readAnyTable(name: string, bytes: Buffer): Promise<Table> {
  const ext = extname(name).toLowerCase();
  if (ext === '.csv' || ext === '.tsv' || ext === '') {
    return parseCsv(bytes.toString('utf8'), name);
  }
  if (ext === '.xlsx' || ext === '.xls' || ext === '.xlsm') {
    const XLSX = await import('xlsx');
    const wb = XLSX.read(bytes, { type: 'buffer' });
    const first = wb.SheetNames[0];
    if (!first) return { headers: [], rows: [], source: name };
    const csv = XLSX.utils.sheet_to_csv(wb.Sheets[first]!);
    return parseCsv(csv, name);
  }
  throw new Error(`Unsupported table type '${ext}' for ${name}. Supported: .csv, .tsv, .xlsx, .xls.`);
}

/** Best-effort guess of what an uploaded file is, from its name/extension. */
export function guessKind(name: string): UploadKind {
  const n = name.toLowerCase();
  if (isTableFile(name)) {
    if (/(prior|precert|preauth|\bpa\b)/.test(n)) return 'prior_auth';
    if (/appeal/.test(n)) return 'appeals';
    if (/(network|roster|directory|credential)/.test(n)) return 'network';
    if (/(fee|reimburse|rate)/.test(n)) return 'reimbursement';
    return 'claims';
  }
  if (/(schedule.*benefit|summary.*benefit|\bsob\b|sbc)/.test(n)) return 'schedule_of_benefits';
  if (isDocumentFile(name)) return 'plan_document';
  return 'unknown';
}
