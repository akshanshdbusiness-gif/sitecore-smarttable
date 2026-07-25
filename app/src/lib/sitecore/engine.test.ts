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
        : 'query';
    ops.push({ kind, op });

    if (kind === 'query') {
      return {
        item: {
          itemId: op.variables.itemId,
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

    return { updateItem: { item: { itemId: op.variables.itemId } } };
  };

  const updates = () =>
    ops
      .filter((o) => o.kind === 'update')
      .map((o) => ({
        itemId: o.op.variables.itemId as string,
        value: o.op.variables.fieldValue0 as string,
      }));

  return { run, ops, updates, rows };
}

const grid = (...rows: string[][]): Grid => rows;

const templates = {
  rowTemplateId: '{AAAA0000-0000-0000-0000-000000000000}',
  cellTemplateId: '{BBBB0000-0000-0000-0000-000000000000}',
};

test('creates the full structure for an empty datasource', async () => {
  const t = fakeTenant();
  const result = await writeGrid({
    datasourceId: 'ds-1',
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
    datasourceId: 'ds-1',
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
    datasourceId: 'ds-1',
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

test('replace blanks cells left over from a larger previous table', async () => {
  const existing: FakeRow[] = [
    { itemId: 'r0', name: 'Row-000', cells: [{ itemId: 'r0c0', name: 'Cell-000' }] },
    { itemId: 'r1', name: 'Row-001', cells: [{ itemId: 'r1c0', name: 'Cell-000' }] },
    { itemId: 'r2', name: 'Row-002', cells: [{ itemId: 'r2c0', name: 'Cell-000' }] },
  ];
  const t = fakeTenant(existing);
  const result = await writeGrid({
    datasourceId: 'ds-1',
    grid: grid(['H'], ['A']),
    run: t.run,
    ...templates,
  });

  assert.equal(result.cellsCleared, 1);
  const cleared = t.updates().filter((u) => u.value === '');
  assert.deepEqual(cleared, [{ itemId: 'r2c0', value: '' }]);
});

test('append adds rows after the existing ones and leaves them untouched', async () => {
  const existing: FakeRow[] = [
    { itemId: 'r0', name: 'Row-000', cells: [{ itemId: 'r0c0', name: 'Cell-000' }] },
    { itemId: 'r1', name: 'Row-001', cells: [{ itemId: 'r1c0', name: 'Cell-000' }] },
  ];
  const t = fakeTenant(existing);
  const result = await writeGrid({
    datasourceId: 'ds-1',
    grid: grid(['B']),
    mode: 'append',
    run: t.run,
    ...templates,
  });

  assert.equal(result.mode, 'append');
  assert.equal(result.rowsCreated, 1);
  assert.equal(result.cellsCleared, 0);
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
    datasourceId: 'ds-1',
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
    datasourceId: 'ds-1',
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
    datasourceId: 'ds-1',
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
    datasourceId: 'ds-1',
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
    writeGrid({ datasourceId: 'ds-1', grid: [], run: t.run, ...templates }),
    /empty/
  );
  assert.equal(t.ops.length, 0);
});

test('braced GUIDs are normalised before use', async () => {
  const t = fakeTenant();
  await writeGrid({
    datasourceId: '{ABCDEF01-0000-0000-0000-000000000000}',
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
