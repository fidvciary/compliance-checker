/**
 * Tiny Markdown→HTML converter for the SUBSET the engine emits (headings,
 * GFM pipe tables, bullet lists, bold, inline code, blockquotes, paragraphs).
 * The engine controls all the markdown it produces, so this focused converter
 * is sufficient and avoids a heavy dependency.
 */

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function inline(s: string): string {
  let out = escapeHtml(s);
  out = out.replace(/`([^`]+)`/g, '<code>$1</code>');
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  return out;
}

function renderTable(lines: string[]): string {
  const rows = lines.map((l) => l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim()));
  if (rows.length < 2) return `<p>${inline(lines.join(' '))}</p>`;
  const header = rows[0]!;
  const body = rows.slice(2); // skip the |---| separator row
  const th = header.map((c) => `<th>${inline(c)}</th>`).join('');
  const trs = body
    .map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`)
    .join('');
  return `<div class="table-wrap"><table><thead><tr>${th}</tr></thead><tbody>${trs}</tbody></table></div>`;
}

/** Convert a markdown-subset string to HTML. */
export function mdToHtml(md: string): string {
  const lines = md.replace(/\r\n?/g, '\n').split('\n');
  const out: string[] = [];
  let i = 0;
  const n = lines.length;

  const flushList = (items: string[]) => {
    if (items.length) out.push(`<ul>${items.map((it) => `<li>${inline(it)}</li>`).join('')}</ul>`);
  };

  while (i < n) {
    const line = lines[i]!;
    const trimmed = line.trim();

    if (trimmed === '') {
      i++;
      continue;
    }
    // Heading
    const h = /^(#{2,4})\s+(.*)$/.exec(trimmed);
    if (h) {
      const level = h[1]!.length;
      out.push(`<h${level}>${inline(h[2]!)}</h${level}>`);
      i++;
      continue;
    }
    // Table block
    if (trimmed.startsWith('|')) {
      const tbl: string[] = [];
      while (i < n && lines[i]!.trim().startsWith('|')) {
        tbl.push(lines[i]!);
        i++;
      }
      out.push(renderTable(tbl));
      continue;
    }
    // Blockquote
    if (trimmed.startsWith('>')) {
      const quote: string[] = [];
      while (i < n && lines[i]!.trim().startsWith('>')) {
        quote.push(lines[i]!.trim().replace(/^>\s?/, ''));
        i++;
      }
      out.push(`<blockquote>${inline(quote.join(' '))}</blockquote>`);
      continue;
    }
    // List block (supports one level of nesting by indentation)
    if (/^\s*[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < n && /^\s*[-*]\s+/.test(lines[i]!)) {
        items.push(lines[i]!.replace(/^\s*[-*]\s+/, ''));
        i++;
      }
      flushList(items);
      continue;
    }
    // Numbered list
    if (/^\s*\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (i < n && /^\s*\d+\.\s+/.test(lines[i]!)) {
        items.push(lines[i]!.replace(/^\s*\d+\.\s+/, ''));
        i++;
      }
      out.push(`<ol>${items.map((it) => `<li>${inline(it)}</li>`).join('')}</ol>`);
      continue;
    }
    // Paragraph (gather until blank)
    const para: string[] = [];
    while (i < n && lines[i]!.trim() !== '' && !/^\s*[-*]\s+/.test(lines[i]!) && !lines[i]!.trim().startsWith('|') && !lines[i]!.trim().startsWith('>') && !/^#{2,4}\s/.test(lines[i]!.trim())) {
      para.push(lines[i]!.trim());
      i++;
    }
    out.push(`<p>${inline(para.join(' '))}</p>`);
  }
  return out.join('\n');
}
