import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getPageContext, parsePresentationDetails, smartTableDatasources } from './context.ts';
import { SMARTTABLE } from '../smarttable.ts';

const RENDERING = SMARTTABLE.rendering.toUpperCase();

const details = (renderings: Array<Record<string, string>>) =>
  JSON.stringify({ devices: [{ id: 'default', renderings }] });

test('parses renderings out of the device tree', () => {
  const parsed = parsePresentationDetails(
    details([
      { id: '{AAA}', dataSource: '{111}' },
      { id: '{BBB}' },
    ])
  );
  assert.equal(parsed.length, 2);
  assert.equal(parsed[0].dataSource, '{111}');
  assert.equal(parsed[1].dataSource, undefined);
});

test('malformed or missing presentationDetails yields no renderings, not a throw', () => {
  assert.deepEqual(parsePresentationDetails(null), []);
  assert.deepEqual(parsePresentationDetails(''), []);
  assert.deepEqual(parsePresentationDetails('not json'), []);
  assert.deepEqual(parsePresentationDetails('{"devices":"wrong"}'), []);
});

test('picks the SmartTable rendering and ignores every other component', () => {
  const parsed = parsePresentationDetails(
    details([
      { id: '{11111111-1111-1111-1111-111111111111}', dataSource: '{OTHER}' },
      { id: `{${RENDERING}}`, dataSource: '{DDDDDDDD-0000-0000-0000-000000000001}' },
      { id: '{22222222-2222-2222-2222-222222222222}', dataSource: '{ALSO-OTHER}' },
    ])
  );
  assert.deepEqual(smartTableDatasources(parsed), ['dddddddd-0000-0000-0000-000000000001']);
});

test('rendering id matching survives braces and casing', () => {
  const lower = parsePresentationDetails(
    details([{ id: SMARTTABLE.rendering, dataSource: '{ABC}' }])
  );
  assert.deepEqual(smartTableDatasources(lower), ['abc']);
});

test('a SmartTable with no datasource assigned is skipped', () => {
  const parsed = parsePresentationDetails(details([{ id: `{${RENDERING}}` }]));
  assert.deepEqual(smartTableDatasources(parsed), []);
});

test('two SmartTables on a page return both, de-duplicated and in order', () => {
  const parsed = parsePresentationDetails(
    details([
      { id: `{${RENDERING}}`, dataSource: '{AAAAAAAA-0000-0000-0000-000000000001}' },
      { id: `{${RENDERING}}`, dataSource: '{BBBBBBBB-0000-0000-0000-000000000002}' },
      // Same datasource placed twice — one entry, not two.
      { id: `{${RENDERING}}`, dataSource: '{AAAAAAAA-0000-0000-0000-000000000001}' },
    ])
  );
  assert.deepEqual(smartTableDatasources(parsed), [
    'aaaaaaaa-0000-0000-0000-000000000001',
    'bbbbbbbb-0000-0000-0000-000000000002',
  ]);
});

test('getPageContext reads the page, not the datasource', async () => {
  const fetchContext = async () => ({
      data: {
        pageInfo: {
          id: '{PAGE-ID}',
          language: 'de-DE',
          version: 2,
          presentationDetails: details([{ id: `{${RENDERING}}`, dataSource: '{DS}' }]),
        },
      },
    });
  const context = await getPageContext(fetchContext);
  assert.equal(context.pageId, '{PAGE-ID}');
  assert.equal(context.language, 'de-DE');
  assert.deepEqual(smartTableDatasources(context.renderings), ['ds']);
});

test('a missing pageInfo throws with the raw payload for diagnosis', async () => {
  const fetchContext = async () => ({ data: { somethingElse: true } });
  await assert.rejects(getPageContext(fetchContext), /somethingElse/);
});
