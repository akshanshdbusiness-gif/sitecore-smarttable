#!/usr/bin/env node
/**
 * Generates the QuickTable SCS item payload under payload/items/.
 *
 * The emitted YAML is the shipped artifact — this script exists so the item
 * model lives in one readable place and so a field/icon/sortorder change is a
 * one-line edit plus a regen rather than hand-patching 20 files.
 *
 * Item IDs are generated once into tools/ids.json and then FROZEN. Every org
 * that installs QuickTable gets the same GUIDs, which is what lets the
 * Marketplace app identify a QuickTable datasource without schema discovery.
 * Never delete ids.json.
 *
 *   node tools/gen-items.mjs
 */
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const OUT = join(ROOT, 'payload', 'items');
const IDS_FILE = join(HERE, 'ids.json');

// ── Sitecore system template IDs ────────────────────────────────────────────
const T = {
  template: 'ab86861a-6030-46c5-b394-e8f99e8b87db',
  section: 'e269fbb5-3750-427a-9149-7aa950b49301',
  field: '455a3e98-a627-4b40-8035-e683a0331ac7',
  templateFolder: '77157d54-90c8-4014-9b9e-540d24e71d03',
  jsonRendering: '04646a89-996f-4ee7-878a-ffdbf1f0ef0d',
  standardTemplate: '{1930BBEB-7805-471A-A3BE-4858AC7CF696}',
};

// ── Well-known parents. Fixed across every Sitecore instance. ───────────────
const PARENT = {
  featureTemplates: '8F343079-3CC5-4EF7-BC27-32ADDB46F45E',
  featureRenderings: 'DA61AD50-8FDB-4252-A68F-B4470B1C9FE8',
};

// ── Field hint IDs ──────────────────────────────────────────────────────────
const F = {
  icon: '06d5295c-ed2f-4a54-9bf2-26228d113318',
  baseTemplate: '12c33f3f-86c5-43a5-aeb4-5598cec45116',
  title: '19a69332-a23e-4e70-8d16-b2640cb24cc8',
  source: '1eb8ae32-e190-44a6-968d-ed904c794ebf',
  masters: '1172f251-dad4-4efb-a329-0c63500e4f1e',
  created: '25bed78c-4957-4165-998a-ca1b52f67497',
  unversionedRevision: '30e85e5d-e00a-4864-b358-7624d511deb4',
  owner: '52807595-0f8f-4b20-8d2a-cb71d28c6103',
  createdBy: '5dd74568-4d4b-44c1-b513-0af5f4cda34f',
  revision: '8cdc337e-a112-42fb-bbb4-4143751e123f',
  shortDescription: '9541e67d-ce8c-4225-803d-33f7f29f09ef',
  type: 'ab162cc0-dc80-4abf-8871-998ee5d7ba32',
  updatedBy: 'badd9cf9-53e0-4d0c-bcc0-2d784c282f6a',
  sortorder: 'ba3f86a2-4a1c-4d78-b63d-91c2779c1b5e',
  displayName: 'b5e02ad9-d56f-4c41-a065-a133db87bdeb',
  updated: 'd9cf14b1-fa16-4ba6-9288-e8a174d4d522',
  sharedRevision: 'dbbbeca1-21c7-4906-9dd2-493c1efa59a2',
  standardValues: 'f7d48a55-2158-4f02-9356-756654404f73',
  // Rendering fields
  componentName: '037fe404-dd19-4bf7-8e30-4dadf68b27b0',
  componentQuery: '17bb046a-a32a-41b3-8315-81217947611b',
  datasourceTemplate: '1a7c85e5-dc0b-490d-9187-bb1dbcb4c72f',
  parametersTemplate: 'a77e8568-1ab3-44f1-a664-b7c37ec7810d',
  datasourceLocation: 'b5b27af1-25ef-405c-87ce-369b3a004016',
};

const TS = '20260724T000000Z';
const ADMIN = 'sitecore\\admin';

const TPL_ROOT = '/sitecore/templates/Feature/QuickTable';
const RND_PATH = '/sitecore/layout/Renderings/Feature/QuickTable';

// ── Frozen ID registry ──────────────────────────────────────────────────────
const KEYS = [
  'tplFolder', 'table', 'tableSection', 'fTitle', 'fCaption', 'tableSV',
  'row', 'rowSV', 'cell', 'cellSection', 'fCellContent',
  'folderTemplate', 'folderTemplateSV',
  'paramsFolder', 'params', 'paramsSection',
  'pFirstRowIsHeader', 'pStriped', 'pDisableRowLines', 'pDisableColumnLines',
  'rendering',
];

function loadIds() {
  const ids = existsSync(IDS_FILE) ? JSON.parse(readFileSync(IDS_FILE, 'utf8')) : {};
  let added = 0;
  for (const k of KEYS) {
    if (!ids[k]) {
      ids[k] = { id: randomUUID(), rev: randomUUID(), srev: randomUUID(), urev: randomUUID() };
      added++;
    }
  }
  if (added) writeFileSync(IDS_FILE, JSON.stringify(ids, null, 2) + '\n');
  return { ids, added };
}

// ── YAML emitters ───────────────────────────────────────────────────────────
const braced = (guid) => `{${guid.replace(/[{}]/g, '').toUpperCase()}}`;

/** Quote only when the value needs it, matching how SCS writes files. */
function scalar(v) {
  const s = String(v);
  if (s === '') return '';
  if (/^[0-9]+$/.test(s)) return s;
  if (/^[A-Za-z][A-Za-z0-9 ]*$/.test(s) && !s.includes('  ')) return s;
  return JSON.stringify(s);
}

function emitField({ id, hint, value }) {
  const s = String(value ?? '');
  if (s.includes('\n') || s.includes('\\')) {
    const body = s.replace(/\n$/, '').split('\n').map((l) => `    ${l}`).join('\n');
    return `- ID: "${id}"\n  Hint: ${hint}\n  Value: |\n${body}`;
  }
  return `- ID: "${id}"\n  Hint: ${hint}\n  Value: ${scalar(s)}`;
}

const byId = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/**
 * @param {{id:string,parent:string,template:string,path:string,
 *          shared?:Array,langFields?:Array,displayName?:string,ids:object}} o
 */
function emitItem(o) {
  const lines = ['---'];
  lines.push(`ID: "${o.ids.id}"`);
  lines.push(`Parent: "${o.parent.replace(/[{}]/g, '').toLowerCase()}"`);
  lines.push(`Template: "${o.template.replace(/[{}]/g, '').toLowerCase()}"`);
  lines.push(`Path: ${JSON.stringify(o.path)}`);

  const shared = [...(o.shared ?? []), { id: F.sharedRevision, hint: '__Shared revision', value: o.ids.srev }];
  lines.push('SharedFields:');
  for (const f of shared.sort(byId)) lines.push(emitField({ id: f.id, hint: f.hint, value: f.value }));

  const lang = [...(o.langFields ?? []), { id: F.unversionedRevision, hint: '__Unversioned revision', value: o.ids.urev }];
  if (o.displayName) lang.push({ id: F.displayName, hint: '__Display name', value: o.displayName });

  lines.push('Languages:');
  lines.push('- Language: en');
  lines.push('  Fields:');
  for (const f of lang.sort(byId)) {
    lines.push(emitField({ id: f.id, hint: f.hint, value: f.value }).split('\n').map((l) => `  ${l}`).join('\n'));
  }
  lines.push('  Versions:');
  lines.push('  - Version: 1');
  lines.push('    Fields:');
  const version = [
    { id: F.created, hint: '__Created', value: TS },
    { id: F.createdBy, hint: '__Created by', value: ADMIN },
    { id: F.owner, hint: '__Owner', value: ADMIN },
    { id: F.revision, hint: '__Revision', value: o.ids.rev },
    { id: F.updated, hint: '__Updated', value: TS },
    { id: F.updatedBy, hint: '__Updated by', value: ADMIN },
  ];
  for (const f of version.sort(byId)) {
    lines.push(emitField({ id: f.id, hint: f.hint, value: f.value }).split('\n').map((l) => `    ${l}`).join('\n'));
  }
  return lines.join('\n') + '\n';
}

function write(relPath, content) {
  const full = join(OUT, relPath);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content, 'utf8');
  return relPath;
}

// ── Model ───────────────────────────────────────────────────────────────────
const { ids, added } = loadIds();
const TPL_DIR = 'items/quicktable.templates';
const RND_DIR = 'items/quicktable.renderings';
const written = [];

if (existsSync(OUT)) rmSync(OUT, { recursive: true, force: true });

// module.json — sits at authoring/items/quicktable/ in the consuming repo, so
// the starter's "authoring/items/**/*.module.json" glob picks it up unchanged.
written.push(write('quicktable.module.json', JSON.stringify({
  $schema: '../../../.sitecore/schemas/ModuleFile.schema.json',
  namespace: 'Feature.QuickTable',
  items: {
    includes: [
      { name: 'quicktable.templates', path: TPL_ROOT, allowedPushOperations: 'CreateUpdateAndDelete' },
      { name: 'quicktable.renderings', path: RND_PATH, allowedPushOperations: 'CreateUpdateAndDelete' },
    ],
  },
}, null, 4) + '\n'));

// 1. /sitecore/templates/Feature/QuickTable  (folder)
written.push(write(`${TPL_DIR}/QuickTable.yml`, emitItem({
  ids: ids.tplFolder, parent: PARENT.featureTemplates, template: T.templateFolder, path: TPL_ROOT,
  shared: [{ id: F.icon, hint: '__Icon', value: 'office/32x32/table.png' }],
  displayName: 'QuickTable',
})));

// 2. QuickTable data template
written.push(write(`${TPL_DIR}/QuickTable/QuickTable.yml`, emitItem({
  ids: ids.table, parent: ids.tplFolder.id, template: T.template, path: `${TPL_ROOT}/QuickTable`,
  shared: [
    { id: F.icon, hint: '__Icon', value: 'office/32x32/table.png' },
    { id: F.baseTemplate, hint: '__Base template', value: T.standardTemplate },
    { id: F.sortorder, hint: '__Sortorder', value: 100 },
    { id: F.standardValues, hint: '__Standard values', value: braced(ids.tableSV.id) },
  ],
})));

written.push(write(`${TPL_DIR}/QuickTable/QuickTable/Content.yml`, emitItem({
  ids: ids.tableSection, parent: ids.table.id, template: T.section, path: `${TPL_ROOT}/QuickTable/Content`,
  shared: [{ id: F.sortorder, hint: '__Sortorder', value: 100 }],
})));

const field = (key, name, parentKey, sectionPath, type, title, sortorder, description) =>
  write(`${TPL_DIR}/${sectionPath}/${name}.yml`, emitItem({
    ids: ids[key], parent: ids[parentKey].id, template: T.field,
    path: `${TPL_ROOT}/${sectionPath.replace(/^QuickTable\//, '')}/${name}`.replace('//', '/'),
    shared: [
      { id: F.type, hint: 'Type', value: type },
      { id: F.sortorder, hint: '__Sortorder', value: sortorder },
    ],
    langFields: [
      { id: F.title, hint: 'Title', value: title },
      ...(description ? [{ id: F.shortDescription, hint: '__Short description', value: description }] : []),
    ],
  }));

written.push(field('fTitle', 'title', 'tableSection', 'QuickTable/QuickTable/Content', 'Single-Line Text', 'Title', 100, 'Optional heading rendered above the table.'));
written.push(field('fCaption', 'caption', 'tableSection', 'QuickTable/QuickTable/Content', 'Single-Line Text', 'Caption', 200, 'Optional <caption>, read by screen readers.'));

// __Standard Values — Insert Options limit children to QuickTableRow
written.push(write(`${TPL_DIR}/QuickTable/QuickTable/__Standard Values.yml`, emitItem({
  ids: ids.tableSV, parent: ids.table.id, template: ids.table.id, path: `${TPL_ROOT}/QuickTable/__Standard Values`,
  shared: [{ id: F.masters, hint: '__Masters', value: braced(ids.row.id) }],
})));

// 3. QuickTableRow
written.push(write(`${TPL_DIR}/QuickTable/QuickTableRow.yml`, emitItem({
  ids: ids.row, parent: ids.tplFolder.id, template: T.template, path: `${TPL_ROOT}/QuickTableRow`,
  shared: [
    { id: F.icon, hint: '__Icon', value: 'office/32x32/window.png' },
    { id: F.baseTemplate, hint: '__Base template', value: T.standardTemplate },
    { id: F.sortorder, hint: '__Sortorder', value: 200 },
    { id: F.standardValues, hint: '__Standard values', value: braced(ids.rowSV.id) },
  ],
})));

written.push(write(`${TPL_DIR}/QuickTable/QuickTableRow/__Standard Values.yml`, emitItem({
  ids: ids.rowSV, parent: ids.row.id, template: ids.row.id, path: `${TPL_ROOT}/QuickTableRow/__Standard Values`,
  shared: [{ id: F.masters, hint: '__Masters', value: braced(ids.cell.id) }],
})));

// 4. QuickTableCell
written.push(write(`${TPL_DIR}/QuickTable/QuickTableCell.yml`, emitItem({
  ids: ids.cell, parent: ids.tplFolder.id, template: T.template, path: `${TPL_ROOT}/QuickTableCell`,
  shared: [
    { id: F.icon, hint: '__Icon', value: 'office/32x32/window_dialog.png' },
    { id: F.baseTemplate, hint: '__Base template', value: T.standardTemplate },
    { id: F.sortorder, hint: '__Sortorder', value: 300 },
  ],
})));

written.push(write(`${TPL_DIR}/QuickTable/QuickTableCell/Content.yml`, emitItem({
  ids: ids.cellSection, parent: ids.cell.id, template: T.section, path: `${TPL_ROOT}/QuickTableCell/Content`,
  shared: [{ id: F.sortorder, hint: '__Sortorder', value: 100 }],
})));

written.push(field('fCellContent', 'cellContent', 'cellSection', 'QuickTable/QuickTableCell/Content', 'Rich Text', 'Cell Content', 100, 'Cell body. Rich Text so authors can format and link.'));

// 5. QuickTable Folder — datasource container, targeted by Datasource Location
written.push(write(`${TPL_DIR}/QuickTable/QuickTable Folder.yml`, emitItem({
  ids: ids.folderTemplate, parent: ids.tplFolder.id, template: T.template, path: `${TPL_ROOT}/QuickTable Folder`,
  shared: [
    { id: F.icon, hint: '__Icon', value: 'office/32x32/folder_window.png' },
    { id: F.baseTemplate, hint: '__Base template', value: T.standardTemplate },
    { id: F.sortorder, hint: '__Sortorder', value: 400 },
    { id: F.standardValues, hint: '__Standard values', value: braced(ids.folderTemplateSV.id) },
  ],
})));

written.push(write(`${TPL_DIR}/QuickTable/QuickTable Folder/__Standard Values.yml`, emitItem({
  ids: ids.folderTemplateSV, parent: ids.folderTemplate.id, template: ids.folderTemplate.id,
  path: `${TPL_ROOT}/QuickTable Folder/__Standard Values`,
  shared: [
    { id: F.icon, hint: '__Icon', value: 'office/32x32/folder_window.png' },
    { id: F.masters, hint: '__Masters', value: braced(ids.table.id) },
  ],
})));

// 6. Rendering Parameters
written.push(write(`${TPL_DIR}/QuickTable/Rendering Parameters.yml`, emitItem({
  ids: ids.paramsFolder, parent: ids.tplFolder.id, template: T.templateFolder,
  path: `${TPL_ROOT}/Rendering Parameters`,
  shared: [
    { id: F.icon, hint: '__Icon', value: 'office/32x32/folder_window.png' },
    { id: F.sortorder, hint: '__Sortorder', value: 500 },
  ],
})));

written.push(write(`${TPL_DIR}/QuickTable/Rendering Parameters/QuickTableParameters.yml`, emitItem({
  ids: ids.params, parent: ids.paramsFolder.id, template: T.template,
  path: `${TPL_ROOT}/Rendering Parameters/QuickTableParameters`,
  shared: [
    { id: F.icon, hint: '__Icon', value: 'office/32x32/window_dialog.png' },
    { id: F.baseTemplate, hint: '__Base template', value: T.standardTemplate },
  ],
})));

written.push(write(`${TPL_DIR}/QuickTable/Rendering Parameters/QuickTableParameters/Styling.yml`, emitItem({
  ids: ids.paramsSection, parent: ids.params.id, template: T.section,
  path: `${TPL_ROOT}/Rendering Parameters/QuickTableParameters/Styling`,
  shared: [{ id: F.sortorder, hint: '__Sortorder', value: 100 }],
})));

const paramField = (key, name, title, sortorder, description) =>
  write(`${TPL_DIR}/QuickTable/Rendering Parameters/QuickTableParameters/Styling/${name}.yml`, emitItem({
    ids: ids[key], parent: ids.paramsSection.id, template: T.field,
    path: `${TPL_ROOT}/Rendering Parameters/QuickTableParameters/Styling/${name}`,
    shared: [
      { id: F.type, hint: 'Type', value: 'Checkbox' },
      { id: F.sortorder, hint: '__Sortorder', value: sortorder },
    ],
    langFields: [
      { id: F.title, hint: 'Title', value: title },
      { id: F.shortDescription, hint: '__Short description', value: description },
    ],
  }));

written.push(paramField('pFirstRowIsHeader', 'firstRowIsHeader', 'First Row Is Header', 100, 'Render row 1 as <thead>. Off means all rows are data rows.'));
written.push(paramField('pStriped', 'striped', 'Striped Rows', 200, 'Alternate background colour on even rows.'));
written.push(paramField('pDisableRowLines', 'disableRowLines', 'Disable Row Lines', 300, 'Hide horizontal borders between rows.'));
written.push(paramField('pDisableColumnLines', 'disableColumnLines', 'Disable Column Lines', 400, 'Hide vertical borders between columns.'));

// 7. Rendering
// Fields are read via field(name:) on the base Item interface rather than a
// "... on QuickTable { }" fragment on purpose: an inline fragment needs the
// QuickTable *type* to exist in the preview Edge schema, and that type only
// appears after the template publishes AND the schema regenerates (which lags
// behind publish). An unknown type is a GraphQL validation error that fails the
// entire layout query, 500-ing every page the component sits on. field(name:)
// has no such dependency and keeps working across model changes.
const COMPONENT_QUERY = `query QuickTableQuery($datasource: String!, $language: String!) {
  datasource: item(path: $datasource, language: $language) {
    id
    title: field(name: "title") { jsonValue }
    caption: field(name: "caption") { jsonValue }
    children {
      results {
        id
        name
        children {
          results {
            id
            name
            cellContent: field(name: "cellContent") { jsonValue }
          }
        }
      }
    }
  }
}`;

const DATASOURCE_LOCATION =
  "query:$site/*[@@name='Data']/*[@@templatename='QuickTable Folder']|" +
  "query:$sharedSites/*[@@name='Data']/*[@@templatename='QuickTable Folder']";

written.push(write(`${RND_DIR}/QuickTable.yml`, emitItem({
  ids: ids.rendering, parent: PARENT.featureRenderings, template: T.jsonRendering, path: RND_PATH,
  shared: [
    { id: F.icon, hint: '__Icon', value: 'office/32x32/table.png' },
    { id: F.componentName, hint: 'componentName', value: 'QuickTable' },
    { id: F.componentQuery, hint: 'ComponentQuery', value: COMPONENT_QUERY },
    { id: F.datasourceTemplate, hint: 'Datasource Template', value: `${TPL_ROOT}/QuickTable` },
    { id: F.datasourceLocation, hint: 'Datasource Location', value: DATASOURCE_LOCATION },
    // Parameters Template must be a GUID, not a path. Sitecore parses it with
    // Data.ID during RenderItem for every page containing the rendering, so a
    // path throws FormatException and fails the entire layout response — the
    // page 500s with no usable route, regardless of the ComponentQuery.
    // (Datasource Template, just above, does accept a path.)
    { id: F.parametersTemplate, hint: 'Parameters Template', value: braced(ids.params.id) },
  ],
  langFields: [{ id: F.title, hint: 'Title', value: 'QuickTable' }],
  displayName: 'QuickTable',
})));

console.log(`${added ? `generated ${added} new frozen ids\n` : ''}wrote ${written.length} files to payload/items/`);
for (const w of written) console.log(`  ${w}`);
