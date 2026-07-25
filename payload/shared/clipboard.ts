/**
 * Clipboard table parsing.
 *
 * Split deliberately into a pure normaliser and a thin DOM adapter: the tricky
 * logic (colspan/rowspan expansion, ragged rows) is then testable in Node with
 * no DOM, and the only browser-dependent part is the few lines that walk the
 * parsed document.
 *
 * Excel puts BOTH text/html and text/plain on the clipboard; browsers copying a
 * <table> put only text/html. Prefer HTML — the TSV fallback cannot represent
 * merged cells or multi-line cell content.
 */

export type Grid = string[][];

export interface RawCell {
  text: string;
  colSpan: number;
  rowSpan: number;
}

export type RawRow = RawCell[];

/** Upper bound on a paste, guarding against a runaway rowspan. */
const MAX_ROWS = 200;
const MAX_COLS = 100;

/**
 * Expand a raw cell matrix into a dense rectangular grid.
 *
 * A cell spanning multiple rows or columns is repeated into every position it
 * covers, rather than dropped: repeating keeps every data row aligned to the
 * same column, which is what makes the pasted result usable. Short rows are
 * padded so callers can index any [row][col] safely.
 */
export function normalizeGrid(rows: RawRow[]): Grid {
  const out: string[][] = [];
  /** Cells carried down from a rowspan above, keyed "row:col". */
  const carried = new Map<string, string>();

  const rowCount = Math.min(rows.length, MAX_ROWS);

  for (let r = 0; r < rowCount; r++) {
    const line: string[] = [];
    let c = 0;

    for (const cell of rows[r]) {
      // Skip columns already occupied by a rowspan from an earlier row.
      while (carried.has(`${r}:${c}`)) {
        line[c] = carried.get(`${r}:${c}`) as string;
        c++;
      }

      const colSpan = Math.max(1, Math.min(cell.colSpan, MAX_COLS));
      const rowSpan = Math.max(1, Math.min(cell.rowSpan, MAX_ROWS));

      for (let dc = 0; dc < colSpan && c < MAX_COLS; dc++, c++) {
        line[c] = cell.text;
        for (let dr = 1; dr < rowSpan; dr++) {
          if (r + dr < MAX_ROWS) carried.set(`${r + dr}:${c}`, cell.text);
        }
      }
    }

    // Trailing carried cells, after the last real cell in this row.
    while (carried.has(`${r}:${c}`)) {
      line[c] = carried.get(`${r}:${c}`) as string;
      c++;
    }

    out.push(line);
  }

  // Pad every row to the widest, filling holes left by sparse indexing.
  const width = out.reduce((max, row) => Math.max(max, row.length), 0);
  const padded = out.map((row) => {
    const filled: string[] = [];
    for (let i = 0; i < width; i++) filled.push(row[i] ?? '');
    return filled;
  });

  // Drop rows that are entirely empty — Excel and web tables both trail these.
  return padded.filter((row) => row.some((cell) => cell !== ''));
}

/** Collapse the whitespace Excel and Word leave behind, without losing words. */
function cleanText(raw: string): string {
  return raw
    .replace(/ /g, ' ') // &nbsp;
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Minimal shape of what the adapter needs, so a test or a server-side parser
 * can supply something other than the browser's DOMParser.
 */
export interface TableLike {
  rows: Array<{
    cells: Array<{ text: string; colSpan?: number; rowSpan?: number }>;
  }>;
}

/** Normalise an already-extracted table structure. */
export function gridFromTable(table: TableLike): Grid | null {
  const raw: RawRow[] = table.rows.map((row) =>
    row.cells.map((cell) => ({
      text: cleanText(cell.text),
      colSpan: cell.colSpan ?? 1,
      rowSpan: cell.rowSpan ?? 1,
    }))
  );
  const grid = normalizeGrid(raw);
  return grid.length > 0 ? grid : null;
}

/**
 * Extract the first <table> from an HTML clipboard payload.
 *
 * `parseHTML` is injected rather than calling DOMParser directly so this runs
 * anywhere; in the browser pass `(html) => new DOMParser().parseFromString(html, 'text/html')`.
 */
export function parseClipboardHTML(
  html: string,
  parseHTML: (html: string) => Document
): Grid | null {
  if (!html) return null;
  let doc: Document;
  try {
    doc = parseHTML(html);
  } catch {
    return null;
  }

  const table = doc.querySelector('table');
  if (!table) return null;

  const rows: TableLike['rows'] = [];
  table.querySelectorAll('tr').forEach((tr) => {
    const cells: TableLike['rows'][number]['cells'] = [];
    tr.querySelectorAll('th, td').forEach((cell) => {
      const el = cell as HTMLTableCellElement;
      cells.push({
        text: el.textContent ?? '',
        colSpan: el.colSpan || 1,
        rowSpan: el.rowSpan || 1,
      });
    });
    if (cells.length) rows.push({ cells });
  });

  return rows.length ? gridFromTable({ rows }) : null;
}

/**
 * Tab-separated fallback (Excel's text/plain flavour).
 *
 * Excel quotes any cell containing a tab, newline or quote, so the line split
 * has to respect quoting or a multi-line cell tears the table apart.
 */
export function parseClipboardTSV(text: string): Grid | null {
  if (!text) return null;

  const rows: RawRow[] = [];
  let cells: RawCell[] = [];
  let field = '';
  let quoted = false;

  const pushCell = () => {
    cells.push({ text: cleanText(field), colSpan: 1, rowSpan: 1 });
    field = '';
  };
  const pushRow = () => {
    pushCell();
    rows.push(cells);
    cells = [];
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"' && field === '') quoted = true;
    else if (ch === '\t') pushCell();
    else if (ch === '\r') continue;
    else if (ch === '\n') pushRow();
    else field += ch;
  }
  if (field !== '' || cells.length) pushRow();

  const grid = normalizeGrid(rows);
  return grid.length > 0 ? grid : null;
}

/**
 * Parse a clipboard payload into a grid, preferring HTML.
 *
 * Returns null when the clipboard holds no table-shaped content, so the caller
 * can show "copy a table first" rather than an empty grid.
 */
export function parseClipboard(
  data: { html?: string; text?: string },
  options: { parseHTML?: (html: string) => Document } = {}
): Grid | null {
  const parseHTML =
    options.parseHTML ??
    (typeof DOMParser !== 'undefined'
      ? (html: string) => new DOMParser().parseFromString(html, 'text/html')
      : undefined);

  if (data.html && parseHTML) {
    const fromHtml = parseClipboardHTML(data.html, parseHTML);
    if (fromHtml) return fromHtml;
  }
  return parseClipboardTSV(data.text ?? '');
}

/** Cell text → the Rich Text HTML stored in cellContent. */
export function textToRichHtml(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return '';
  const escaped = trimmed
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return escaped
    .split(/\n\n+/)
    .map((para) => `<p>${para.replace(/\n/g, '<br>')}</p>`)
    .join('');
}
