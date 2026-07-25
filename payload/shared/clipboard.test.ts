/**
 * Run with: node --test payload/shared/
 * Node 24 strips TypeScript types natively, so no build step or test framework.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  gridFromTable,
  normalizeGrid,
  parseClipboardTSV,
  textToRichHtml,
  type RawRow,
} from './clipboard.ts';

const cell = (text: string, colSpan = 1, rowSpan = 1) => ({ text, colSpan, rowSpan });
const row = (...cells: ReturnType<typeof cell>[]): RawRow => cells;

test('plain grid passes through', () => {
  assert.deepEqual(normalizeGrid([row(cell('a'), cell('b')), row(cell('c'), cell('d'))]), [
    ['a', 'b'],
    ['c', 'd'],
  ]);
});

test('colspan repeats across the columns it covers', () => {
  assert.deepEqual(normalizeGrid([row(cell('wide', 2)), row(cell('a'), cell('b'))]), [
    ['wide', 'wide'],
    ['a', 'b'],
  ]);
});

test('rowspan carries down into later rows', () => {
  const grid = normalizeGrid([
    row(cell('tall', 1, 2), cell('b')),
    row(cell('c')),
    row(cell('d'), cell('e')),
  ]);
  assert.deepEqual(grid, [
    ['tall', 'b'],
    ['tall', 'c'],
    ['d', 'e'],
  ]);
});

test('combined colspan and rowspan fills the whole block', () => {
  const grid = normalizeGrid([row(cell('big', 2, 2), cell('x')), row(cell('y')), row(cell('a'), cell('b'), cell('c'))]);
  assert.deepEqual(grid, [
    ['big', 'big', 'x'],
    ['big', 'big', 'y'],
    ['a', 'b', 'c'],
  ]);
});

test('ragged rows are padded to the widest row', () => {
  assert.deepEqual(normalizeGrid([row(cell('a'), cell('b'), cell('c')), row(cell('d'))]), [
    ['a', 'b', 'c'],
    ['d', '', ''],
  ]);
});

test('entirely empty rows are dropped', () => {
  assert.deepEqual(normalizeGrid([row(cell('a')), row(cell('')), row(cell('b'))]), [['a'], ['b']]);
});

test('whitespace and nbsp are collapsed', () => {
  const grid = gridFromTable({ rows: [{ cells: [{ text: '  Q3 \n  Revenue ' }] }] });
  assert.deepEqual(grid, [['Q3 Revenue']]);
});

test('TSV splits on tabs and newlines', () => {
  assert.deepEqual(parseClipboardTSV('Plan\tPrice\r\nPro\t$49'), [
    ['Plan', 'Price'],
    ['Pro', '$49'],
  ]);
});

test('TSV keeps a quoted cell containing a newline intact', () => {
  // Excel quotes any cell with a tab, newline or quote in it. Splitting on
  // "\n" without respecting quotes would tear this row into two.
  const grid = parseClipboardTSV('a\t"line one\nline two"\tc');
  assert.deepEqual(grid, [['a', 'line one line two', 'c']]);
});

test('TSV unescapes doubled quotes', () => {
  assert.deepEqual(parseClipboardTSV('"say ""hi"""\tb'), [['say "hi"', 'b']]);
});

test('empty clipboard yields null, not an empty grid', () => {
  assert.equal(parseClipboardTSV(''), null);
  assert.equal(parseClipboardTSV('\n\n'), null);
});

test('rich text wraps paragraphs and escapes markup', () => {
  assert.equal(textToRichHtml('hello'), '<p>hello</p>');
  assert.equal(textToRichHtml('a\n\nb'), '<p>a</p><p>b</p>');
  assert.equal(textToRichHtml('a\nb'), '<p>a<br>b</p>');
  assert.equal(textToRichHtml('<script>x</script>'), '<p>&lt;script&gt;x&lt;/script&gt;</p>');
  assert.equal(textToRichHtml('   '), '');
});
