import type { CandidatePassage } from '../analysis/warning-sign-scanner.js';
import type { PlanDocument } from './document-reader.js';

/**
 * Chunk a plan document into anchored candidate passages for the deterministic
 * scanner. PDF/plan-text extraction wraps sentences across lines, so we:
 *   1. track the current section heading and page,
 *   2. reflow wrapped lines within a paragraph,
 *   3. split into sentence-level passages (precise verbatim quotes),
 * each carrying { documentId, page, section, text }.
 *
 * This is mechanical text structuring — no interpretation. The scanner decides
 * what fires.
 */

export interface ChunkOptions {
  documentId: string;
  /** Minimum characters for a passage to be scanned (drops fragments). */
  minChars?: number;
  /** Maximum characters per passage (very long runs are split). */
  maxChars?: number;
}

// Artifacts seen in PDF-to-text exports.
const TEMPLATE_ARTIFACT = /^\*[A-Z][A-Z0-9_]*\*.*\*[A-Z][A-Z0-9_]*\*$/;
const TOCLVL = /^\*TOCLVL\d\*(.+?)\*TOCLVL\d\*$/;
const BULLET_ONLY = /^[l¡•·◦*-]$/;
const PAGE_NUMBER_ONLY = /^\d{1,4}$/;

function looksLikeHeading(line: string): boolean {
  const t = line.trim();
  if (t.length === 0 || t.length > 72) return false;
  if (/[.;:]$/.test(t)) return false; // headings don't end in sentence punctuation
  const words = t.split(/\s+/);
  if (words.length < 1 || words.length > 9) return false;
  // Most words start uppercase (Title Case-ish) or the line is ALL CAPS.
  const capish = words.filter((w) => /^[A-Z0-9(]/.test(w)).length;
  const isTitleCase = capish / words.length >= 0.7;
  const hasLetters = /[A-Za-z]/.test(t);
  return hasLetters && isTitleCase;
}

function splitSentences(block: string): string[] {
  // Split on sentence terminators followed by a space + capital / end. Keep it
  // conservative to avoid splitting abbreviations mid-sentence.
  const out: string[] = [];
  const parts = block
    .replace(/\s+/g, ' ')
    .trim()
    .split(/(?<=[.!?])\s+(?=[A-Z(])/);
  for (const p of parts) {
    const s = p.trim();
    if (s) out.push(s);
  }
  return out;
}

export function chunkDocument(doc: PlanDocument, opts: ChunkOptions): CandidatePassage[] {
  const minChars = opts.minChars ?? 25;
  const maxChars = opts.maxChars ?? 600;

  const rawLines = doc.text.replace(/\r\n?/g, '\n').split('\n');
  const passages: CandidatePassage[] = [];

  let currentSection = 'Introduction';
  let page = 1;
  let paraLines: string[] = [];
  let paraStartLine = 0;

  const flushParagraph = (endLine: number) => {
    if (paraLines.length === 0) return;
    const block = paraLines.join(' ').replace(/\s+/g, ' ').trim();
    paraLines = [];
    if (block.length < minChars) return;
    for (const sentence of splitSentences(block)) {
      // Split any over-long sentence on clause boundaries.
      const units = sentence.length <= maxChars ? [sentence] : sentence.match(new RegExp(`.{1,${maxChars}}(\\s|$)`, 'g')) ?? [sentence];
      for (const u of units) {
        const text = u.trim();
        if (text.length >= minChars) {
          passages.push({ documentId: opts.documentId, page, section: currentSection, text });
        }
      }
    }
    void endLine;
    void paraStartLine;
  };

  rawLines.forEach((rawLine, idx) => {
    let line = rawLine;
    // Page breaks: form feed or a lone page-number line.
    if (line.includes('\f')) {
      flushParagraph(idx);
      page += (line.match(/\f/g) ?? []).length;
      line = line.replace(/\f/g, '').trim();
      if (line.length === 0) return;
    }
    const trimmed = line.trim();

    if (trimmed.length === 0) {
      flushParagraph(idx);
      return;
    }
    // TOCLVL section markers must be checked BEFORE the generic template-artifact
    // filter (which would otherwise swallow them and lose the section heading).
    const toc = TOCLVL.exec(trimmed);
    if (toc) {
      flushParagraph(idx);
      currentSection = toc[1]!.trim();
      return;
    }
    if (TEMPLATE_ARTIFACT.test(trimmed)) return; // drop other template markers
    if (PAGE_NUMBER_ONLY.test(trimmed)) {
      flushParagraph(idx);
      // Bare page-number lines commonly denote a page boundary in text exports.
      return;
    }
    if (BULLET_ONLY.test(trimmed)) return; // drop lone bullet glyphs
    if (looksLikeHeading(trimmed)) {
      flushParagraph(idx);
      currentSection = trimmed;
      return;
    }
    if (paraLines.length === 0) paraStartLine = idx + 1;
    // Strip a leading bullet glyph.
    paraLines.push(trimmed.replace(/^[l¡•·◦]\s+/, ''));
  });
  flushParagraph(rawLines.length);

  return passages;
}
