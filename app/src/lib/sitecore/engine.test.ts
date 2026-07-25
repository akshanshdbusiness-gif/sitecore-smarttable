/**
 * Run with: npm test  (node --test, no framework — Node 24 strips types)
 *
 * The fake runner records every operation, so these assert the things that
 * actually break in production: ordering, idempotency, batching and clearing.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { writeGrid, textToRichHtml, type Grid } from './engine.ts';
import type { GraphqlOperation } from './queries.ts';

interface FakeRow {
  itemId: string;
  name: string;
  cells: Array<{ itemId: string; name: string }>;
}

/** Minimal in-memory stand-in for the Authoring API. */
function fakeTenant(initial: FakeRow[] = []) {
  const rows = initial.map((r) => ({ ...r, cells: [...r.cells] }));
  const ops: Array<{ kind: string; op: GraphqlOperation }> = [];
  let seq = 0;

  const run = async (op: GraphqlOperation): Promise<unknown> => {
    const kind = /mutation CreateItem/.test(op.query)
      ? 'create'
      : /mutation UpdateFields/.test(op.query)
        ? 'update'
        : /mutation DeleteItem/.test(op.query)
          ? 'delete'
          : 'query';
    ops.push({ kind, op });

    if (kind === 'query') {
      return {
        item: {
          itemId: op.variables.itemId ?? 'resolved-ds',
          name: 'ds',
          children: {
            nodes: rows.map((r) => ({
              itemId: r.itemId,
              name: r.name,
              children: { nodes: r.cells },
            })),
          },
        },
      };
    }

    if (kind === 'create') {
      const name = op.variables.name as string;
      const parentId = op.variables.parentId as string;
      const itemId = `new-${++seq}`;
      if (name.startsWith('Row-')) rows.push({ itemId, name, cells: [] });
      else rows.find((r) => r.itemId === parentId)?.cells.push({ itemId, name });
      return { createItem: { item: { itemId, name } } };
    }

    if (kind === 'delete') {
      const id = op.variables.itemId as string;
      const rowIndex = rows.findIndex((r) => r.itemId === id);
      if (rowIndex >= 0) rows.splice(rowIndex, 1);
      else for (const r of rows) r.cells = r.cells.filter((c) => c.itemId !== id);
      return { deleteItem: { successful: true } };
    }

    return { updateItem: { item: { itemId: op.variables.itemId } } };
  };

  const updates = () =>
    ops
      .filter((o) => o.kind === 'update')
      .map((o) => ({
        itemId: o.op.variables.itemId as string,
        value: o.op.variables.fieldValue0 as string,
      }));

  const deleted = () =>
    ops.filter((o) => o.kind === 'delete').map((o) => o.op.variables.itemId as string);

  return { run, ops, updates, deleted, rows };
}

const grid = (...rows: string[][]): Grid => rows;

const templates = {
  rowTemplateId: '{AAAA0000-0000-0000-0000-000000000000}',
  cellTemplateId: '{BBBB0000-0000-0000-0000-000000000000}',
};

test('creates the full structure for an empty datasource', async () => {
  const t = fakeTenant();
  const result = await writeGrid({
    ref: { itemId: 'ds-1' },
    grid: grid(['Plan', 'Price'], ['Pro', '$49']),
    run: t.run,
    ...templates,
  });

  assert.equal(result.rowsCreated, 2);
  assert.equal(result.cellsCreated, 4);
  assert.equal(result.columns, 2);
  assert.deepEqual(
    t.updates().map((u) => u.value),
    ['<p>Plan</p>', '<p>Price</p>', '<p>Pro</p>', '<p>$49</p>']
  );
});

test('row and cell names are zero-padded so Sitecore sorts them correctly', async () => {
  const t = fakeTenant();
  await writeGrid({
    ref: { itemId: 'ds-1' },
    grid: grid(...Array.from({ length: 11 }, (_, i) => [`r${i}`])),
    run: t.run,
    ...templates,
  });

  const rowNames = t.rows.map((r) => r.name);
  // "Row-10" would sort before "Row-2" as a string; padding prevents that.
  assert.equal(rowNames[1], 'Row-001');
  assert.equal(rowNames[10], 'Row-010');
  assert.deepEqual([...rowNames].sort(), rowNames);
});

test('re-pasting the same shape creates nothing and only updates', async () => {
  const existing: FakeRow[] = [
    { itemId: 'r0', name: 'Row-000', cells: [{ itemId: 'r0c0', name: 'Cell-000' }] },
    { itemId: 'r1', name: 'Row-001', cells: [{ itemId: 'r1c0', name: 'Cell-000' }] },
  ];
  const t = fakeTenant(existing);
  const result = await writeGrid({
    ref: { itemId: 'ds-1' },
    grid: grid(['H'], ['A']),
    run: t.run,
    ...templates,
  });

  assert.equal(result.rowsCreated, 0);
  assert.equal(result.cellsCreated, 0);
  // Reused the existing item ids rather than replacing them.
  assert.deepEqual(
    t.updates().map((u) => u.itemId),
    ['r0c0', 'r1c0']
  );
});

test('replace deletes the surplus rows of a larger previous table', async () => {
  // Blanking them was wrong: the items still exist, so the component still
  // renders them — an empty row on the page rather than no row.
  const existing: FakeRow[] = [
    { itemId: 'r0', name: 'Row-000', cells: [{ itemId: 'r0c0', name: 'Cell-000' }] },
    { itemId: 'r1', name: 'Row-001', cells: [{ itemId: 'r1c0', name: 'Cell-000' }] },
    { itemId: 'r2', name: 'Row-002', cells: [{ itemId: 'r2c0', name: 'Cell-000' }] },
  ];
  const t = fakeTenant(existing);
  const result = await writeGrid({
    ref: { itemId: 'ds-1' },
    grid: grid(['H'], ['A']),
    run: t.run,
    ...templates,
  });

  assert.equal(result.rowsDeleted, 1);
  // The row goes as one call; its cells are children and go with it.
  assert.deepEqual(t.deleted(), ['r2']);
  assert.equal(t.rows.length, 2);
  // No cell was blanked instead of removed.
  assert.equal(t.updates().filter((u) => u.value === '').length, 0);
});

test('append adds rows after the existing ones and leaves them untouched', async () => {
  const existing: FakeRow[] = [
    { itemId: 'r0', name: 'Row-000', cells: [{ itemId: 'r0c0', name: 'Cell-000' }] },
    { itemId: 'r1', name: 'Row-001', cells: [{ itemId: 'r1c0', name: 'Cell-000' }] },
  ];
  const t = fakeTenant(existing);
  const result = await writeGrid({
    ref: { itemId: 'ds-1' },
    grid: grid(['B']),
    mode: 'append',
    run: t.run,
    ...templates,
  });

  assert.equal(result.mode, 'append');
  assert.equal(result.rowsCreated, 1);
  // Append never removes anything, however small the pasted block is.
  assert.equal(result.rowsDeleted, 0);
  assert.equal(result.cellsDeleted, 0);
  assert.deepEqual(t.deleted(), []);
  // new-1 is the row, new-2 its cell. Only the new row is written; existing
  // content is not rewritten.
  assert.deepEqual(t.updates(), [{ itemId: 'new-2', value: '<p>B</p>' }]);
});

test('append widens existing rows when the paste has more columns', async () => {
  const existing: FakeRow[] = [
    { itemId: 'r0', name: 'Row-000', cells: [{ itemId: 'r0c0', name: 'Cell-000' }] },
  ];
  const t = fakeTenant(existing);
  const result = await writeGrid({
    ref: { itemId: 'ds-1' },
    grid: grid(['a', 'b', 'c']),
    mode: 'append',
    run: t.run,
    ...templates,
  });

  assert.equal(result.columns, 3);
  // Two blank cells added to the pre-existing row so columns stay aligned.
  assert.equal(t.rows[0].cells.length, 3);
});

test('ragged rows do not leave holes', async () => {
  const t = fakeTenant();
  const result = await writeGrid({
    ref: { itemId: 'ds-1' },
    grid: grid(['a', 'b', 'c'], ['d']),
    run: t.run,
    ...templates,
  });

  assert.equal(result.columns, 3);
  assert.deepEqual(
    t.updates().map((u) => u.value),
    ['<p>a</p>', '<p>b</p>', '<p>c</p>', '<p>d</p>', '', '']
  );
});

test('content writes are batched, creates are not parallel', async () => {
  const t = fakeTenant();
  let inFlight = 0;
  let peak = 0;
  const run = async (op: GraphqlOperation) => {
    inFlight++;
    peak = Math.max(peak, inFlight);
    await new Promise((r) => setTimeout(r, 1));
    inFlight--;
    return t.run(op);
  };

  await writeGrid({
    ref: { itemId: 'ds-1' },
    grid: grid(['a', 'b'], ['c', 'd'], ['e', 'f']),
    run,
    batchSize: 2,
    ...templates,
  });

  assert.ok(peak <= 2, `expected at most 2 concurrent requests, saw ${peak}`);
});

test('reports progress across the content writes', async () => {
  const t = fakeTenant();
  const seen: number[] = [];
  await writeGrid({
    ref: { itemId: 'ds-1' },
    grid: grid(['a', 'b'], ['c', 'd']),
    run: t.run,
    onProgress: (done, total) => seen.push(done / total),
    ...templates,
  });
  assert.equal(seen.at(-1), 1);
});

test('an empty grid is rejected rather than silently wiping the table', async () => {
  const t = fakeTenant();
  await assert.rejects(
    writeGrid({ ref: { itemId: 'ds-1' }, grid: [], run: t.run, ...templates }),
    /empty/
  );
  assert.equal(t.ops.length, 0);
});

test('braced GUIDs are normalised before use', async () => {
  const t = fakeTenant();
  await writeGrid({
    ref: { itemId: '{ABCDEF01-0000-0000-0000-000000000000}' },
    grid: grid(['x']),
    run: t.run,
    ...templates,
  });
  assert.equal(t.ops[0].op.variables.itemId, 'abcdef01-0000-0000-0000-000000000000');
});

test('rich text escapes markup and preserves paragraphs', () => {
  assert.equal(textToRichHtml('a\n\nb'), '<p>a</p><p>b</p>');
  assert.equal(textToRichHtml('<b>x'), '<p>&lt;b&gt;x</p>');
  assert.equal(textToRichHtml('  '), '');
});

test('a datasource addressed by path resolves to the real id before creating', async () => {
  // Sitecore's default for a canvas-created datasource is the relative token
  // local:/Data/Name, which arrives here as a path. Rows must be parented onto
  // the id the lookup returns, not onto the path string.
  const t = fakeTenant();
  await writeGrid({
    ref: { path: '/sitecore/content/site/home/Data/New Content Item' },
    grid: grid(['a']),
    run: t.run,
    ...templates,
  });

  const lookup = t.ops[0].op;
  assert.equal(lookup.variables.path, '/sitecore/content/site/home/Data/New Content Item');
  assert.equal(lookup.variables.itemId, undefined);
  assert.match(lookup.query, /path: \$path/);

  const createRow = t.ops.find((o) => o.kind === 'create');
  assert.equal(createRow?.op.variables.parentId, 'resolved-ds');
});

test('a missing datasource is reported, not treated as an empty table', async () => {
  const run = async () => ({ item: null });
  await assert.rejects(
    writeGrid({ ref: { path: '/nope' }, grid: grid(['a']), run, ...templates }),
    /Datasource not found/
  );
});

test('replace deletes surplus columns from rows it keeps', async () => {
  // A narrower paste must not leave a trailing column rendering as blank cells.
  const existing: FakeRow[] = [
    {
      itemId: 'r0',
      name: 'Row-000',
      cells: [
        { itemId: 'r0c0', name: 'Cell-000' },
        { itemId: 'r0c1', name: 'Cell-001' },
        { itemId: 'r0c2', name: 'Cell-002' },
      ],
    },
  ];
  const t = fakeTenant(existing);
  const result = await writeGrid({
    ref: { itemId: 'ds-1' },
    grid: grid(['only']),
    run: t.run,
    ...templates,
  });

  assert.equal(result.cellsDeleted, 2);
  assert.deepEqual(t.deleted(), ['r0c1', 'r0c2']);
  assert.equal(t.rows[0].cells.length, 1);
});

test('deletes run after the content writes, never before', async () => {
  // If a delete fails the table still reads correctly; the reverse order could
  // remove structure and then fail to write its replacement.
  const existing: FakeRow[] = [
    { itemId: 'r0', name: 'Row-000', cells: [{ itemId: 'r0c0', name: 'Cell-000' }] },
    { itemId: 'r1', name: 'Row-001', cells: [{ itemId: 'r1c0', name: 'Cell-000' }] },
  ];
  const t = fakeTenant(existing);
  await writeGrid({
    ref: { itemId: 'ds-1' },
    grid: grid(['x']),
    run: t.run,
    ...templates,
  });

  const kinds = t.ops.map((o) => o.kind);
  assert.ok(kinds.lastIndexOf('update') < kinds.indexOf('delete'));
});
