import { readFileSync } from 'node:fs';
import { extname } from 'node:path';

/**
 * Plan-document reader. Reads a plan document (SPD / wrap / UM manual) into text
 * the deterministic scanner can chunk and analyze.
 *
 *   - .pdf         → pdf-parse (native, no external tool)
 *   - .txt / .md   → read directly (e.g., a PDF already converted to text)
 *
 * NOTE: this is the "read the document" step. It is mechanical text extraction —
 * it does NOT interpret the plan. The deterministic warning-sign scanner and
 * litigation-language detectors are what classify passages; an LLM is never
 * required to decide whether a rule fired.
 */

export interface PlanDocument {
  source: string;
  text: string;
  pageCount: number | null;
  format: 'pdf' | 'text';
}

/** Read a plan document from disk. */
export async function readPlanDocument(filePath: string): Promise<PlanDocument> {
  const ext = extname(filePath).toLowerCase();
  if (ext === '.pdf') {
    return readPdf(filePath);
  }
  if (ext === '.txt' || ext === '.md' || ext === '') {
    return { source: filePath, text: readFileSync(filePath, 'utf8'), pageCount: null, format: 'text' };
  }
  throw new Error(`Unsupported plan-document format '${ext}'. Supported: .pdf, .txt, .md. Convert other formats to PDF or text first.`);
}

/** Read text directly (for callers that already have the bytes/string). */
export function planDocumentFromText(text: string, source: string): PlanDocument {
  return { source, text, pageCount: null, format: 'text' };
}

async function readPdf(filePath: string): Promise<PlanDocument> {
  // Import the INNER lib module, not the package root: pdf-parse's index.js runs
  // debug code that reads a bundled test file when imported directly (it checks
  // `!module.parent`, which is falsy under ESM). The lib entry avoids that.
  // Loaded dynamically so the dep is only touched when a PDF is actually read.
  const mod = await import('pdf-parse/lib/pdf-parse.js');
  const pdfParse = (mod.default ?? mod) as (buf: Buffer, opts?: unknown) => Promise<{ text: string; numpages: number }>;
  const buf = readFileSync(filePath);
  // Insert a form-feed page marker between pages so the chunker can track pages.
  const options = {
    pagerender: (pageData: { getTextContent: (o: unknown) => Promise<{ items: Array<{ str: string }> }> }) =>
      pageData
        .getTextContent({ normalizeWhitespace: true, disableCombineTextItems: false })
        .then((tc) => tc.items.map((i) => i.str).join(' ') + '\n\f'),
  };
  const data = await pdfParse(buf, options);
  return { source: filePath, text: data.text, pageCount: data.numpages, format: 'pdf' };
}
