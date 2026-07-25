import {
  buildCreateItemMutation,
  buildDeleteItemMutation,
  buildGetTableQuery,
  buildUpdateFieldsMutation,
  normalizeGuid,
  readTableStructure,
  type GraphqlOperation,
  type ItemRef,
  type RowNode,
} from './queries.ts';

/**
 * Turns a parsed clipboard grid into Sitecore Row/Cell items.
 *
 * The GraphQL transport is injected rather than imported so the whole engine
 * runs under `node --test` against a fake — the ordering, idempotency and
 * batching rules are where the bugs live, and none of them need a tenant to
 * exercise.
 */

export type Grid = string[][];

export type PasteMode = 'replace' | 'append';

/** Executes one Authoring API operation and returns its `data`. */
export type GqlRunner = (op: GraphqlOperation) => Promise<unknown>;

export interface WriteOptions {
  /** The datasource, addressed by id or path. */
  ref: ItemRef;
  grid: Grid;
  mode?: PasteMode;
  language?: string;
  database?: string;
  rowTemplateId: string;
  cellTemplateId: string;
  /** Field on the cell template that holds the body. */
  cellField?: string;
  run: GqlRunner;
  /**
   * Parallel writes per round trip. Kept low deliberately: the Authoring API's
   * rate limit is shared across every automation, pipeline and editor session
   * in the environment, and several authors pasting at once multiply this.
   */
  batchSize?: number;
  onProgress?: (done: number, total: number) => void;
}

export interface WriteResult {
  mode: PasteMode;
  rows: number;
  columns: number;
  rowsCreated: number;
  cellsCreated: number;
  cellsUpdated: number;
  rowsDeleted: number;
  cellsDeleted: number;
}

const ROW_PREFIX = 'Row-';
const CELL_PREFIX = 'Cell-';

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

/** Sitecore sorts children by name, so index suffixes must be zero-padded. */
function indexName(prefix: string, index: number): string {
  return `${prefix}${String(index).padStart(3, '0')}`;
}

/** Trailing digits of "Row-007" → 7. NaN when the name is not ours. */
function nameIndex(name: string): number {
  const match = /(\d+)\s*$/.exec(name);
  return match ? Number(match[1]) : Number.NaN;
}

/** Existing children in positional order, tolerating hand-created names. */
function ordered<T extends { name: string }>(items: T[]): T[] {
  if (items.some((i) => Number.isNaN(nameIndex(i.name)))) return items;
  return [...items].sort((a, b) => nameIndex(a.name) - nameIndex(b.name));
}

async function runInBatches<T>(
  items: T[],
  fn: (item: T) => Promise<void>,
  batchSize: number,
  onDone?: (n: number) => void
): Promise<void> {
  let done = 0;
  for (let i = 0; i < items.length; i += batchSize) {
    await Promise.all(
      items.slice(i, i + batchSize).map(async (item) => {
        await fn(item);
        done++;
        onDone?.(done);
      })
    );
  }
}

/**
 * Write `grid` into the datasource.
 *
 * Reuses whatever Row/Cell items already exist rather than deleting and
 * recreating: item IDs survive, so personalisation, links into cells and
 * anything else referencing them keeps working. That also makes a re-run
 * cheap — a second paste over the same shape issues no creates at all.
 *
 * replace — grid[0] is the header row, grid[1..] the data rows.
 * append  — every grid row is a data row, added after the existing ones.
 */
export async function writeGrid(options: WriteOptions): Promise<WriteResult> {
  const {
    ref,
    grid,
    mode = 'replace',
    language = 'en',
    database = 'master',
    rowTemplateId,
    cellTemplateId,
    cellField = 'cellContent',
    run,
    batchSize = 4,
    onProgress,
  } = options;

  if (grid.length === 0) throw new Error('Nothing to write: the grid is empty.');

  // The datasource may arrive as an id or a path (Sitecore's default for a
  // canvas-created datasource is the relative token `local:/Data/Name`), so the
  // real id comes back from this first read and every create parents onto it.
  const lookupRef = ref.itemId ? { itemId: normalizeGuid(ref.itemId) } : ref;
  const existingData = await run(buildGetTableQuery({ ref: lookupRef, database, language }));
  const structure = readTableStructure(existingData);
  if (!structure) {
    throw new Error(
      `Datasource not found: ${ref.itemId ?? ref.path}. Check the component has a ` +
        'datasource assigned and that it exists in the master database.'
    );
  }

  const itemId = normalizeGuid(structure.itemId);
  const existingRows = ordered(structure.rows);

  const incomingCols = grid.reduce((max, row) => Math.max(max, row.length), 0);
  const existingCols = existingRows.reduce((max, row) => Math.max(max, row.cells.length), 0);

  // Append keeps existing rows and widens the table if the paste is wider;
  // replace rewrites from Row-000 and adopts the pasted width outright.
  const startRow = mode === 'append' ? existingRows.length : 0;
  const targetCols = mode === 'append' ? Math.max(existingCols, incomingCols) : incomingCols;
  const targetRows = startRow + grid.length;

  let rowsCreated = 0;
  let cellsCreated = 0;

  /** rowIndex → cell item ids, indexed by column. */
  const cellIds: string[][] = [];

  // Creates are sequential on purpose: Sitecore derives ordering from creation
  // and names must not collide, so a parallel burst risks duplicate names.
  for (let r = 0; r < targetRows; r++) {
    let row: RowNode | undefined = existingRows[r];

    if (!row) {
      const created = (await run(
        buildCreateItemMutation({
          name: indexName(ROW_PREFIX, r),
          templateId: normalizeGuid(rowTemplateId),
          parentId: itemId,
          language,
        })
      )) as { createItem?: { item?: { itemId: string; name: string } } };

      const item = created?.createItem?.item;
      if (!item) throw new Error(`Failed to create row ${r}.`);
      row = { itemId: item.itemId, name: item.name, cells: [] };
      rowsCreated++;
    }

    const existingCells = ordered(row.cells);
    cellIds[r] = [];

    for (let c = 0; c < targetCols; c++) {
      const existing = existingCells[c];
      if (existing) {
        cellIds[r][c] = existing.itemId;
        continue;
      }
      const created = (await run(
        buildCreateItemMutation({
          name: indexName(CELL_PREFIX, c),
          templateId: normalizeGuid(cellTemplateId),
          parentId: row.itemId,
          language,
        })
      )) as { createItem?: { item?: { itemId: string } } };

      const item = created?.createItem?.item;
      if (!item) throw new Error(`Failed to create cell ${c} in row ${r}.`);
      cellIds[r][c] = item.itemId;
      cellsCreated++;
    }
  }

  // ── content writes ────────────────────────────────────────────────────────
  interface Write {
    itemId: string;
    value: string;
  }
  const writes: Write[] = [];

  const written = new Set<string>();

  for (let r = 0; r < grid.length; r++) {
    const target = startRow + r;
    for (let c = 0; c < targetCols; c++) {
      const id = cellIds[target]?.[c];
      if (!id) continue;
      writes.push({ itemId: id, value: textToRichHtml(grid[r][c] ?? '') });
      written.add(id);
    }
  }

  // Surplus structure from a larger previous table. Blanking these instead of
  // removing them was wrong: the items still exist, so the component still
  // renders them — an empty row on the page rather than no row.
  const surplusRows: string[] = [];
  const surplusCells: string[] = [];
  if (mode === 'replace') {
    existingRows.forEach((row, r) => {
      if (r >= grid.length) {
        // Cells are children of the row, so they go with it — one call, not one per cell.
        surplusRows.push(row.itemId);
        return;
      }
      for (const cell of ordered(row.cells)) {
        if (!written.has(cell.itemId)) surplusCells.push(cell.itemId);
      }
    });
  }

  await runInBatches(
    writes,
    async (write) => {
      await run(
        buildUpdateFieldsMutation({
          itemId: write.itemId,
          database,
          language,
          version: 1,
          fields: [{ name: cellField, value: write.value }],
        })
      );
    },
    batchSize,
    (done) => onProgress?.(done, writes.length)
  );

  // Deletes run last: if one fails, the table already reads correctly and the
  // only residue is an extra row, which a re-paste clears. Running them first
  // would risk removing structure and then failing to write the replacement.
  const deletions = [...surplusRows, ...surplusCells];
  await runInBatches(
    deletions,
    async (itemId) => {
      await run(buildDeleteItemMutation({ itemId, database }));
    },
    batchSize
  );

  return {
    mode,
    rows: mode === 'append' ? targetRows : grid.length,
    columns: targetCols,
    rowsCreated,
    cellsCreated,
    cellsUpdated: writes.length,
    rowsDeleted: surplusRows.length,
    cellsDeleted: surplusCells.length,
  };
}
