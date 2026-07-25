import { cpSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findRepoRoot, inspect, rel, resolveHosts } from './detect.js';

const PKG_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PAYLOAD_ITEMS = join(PKG_ROOT, 'payload', 'items');
const PAYLOAD_COMPONENT = join(PKG_ROOT, 'payload', 'component');
const COMPONENT_DIR = join('src', 'components', 'quick-table');

const ok = (m) => console.log(`  [32mok[0m    ${m}`);
const bad = (m) => console.log(`  [31mfail[0m  ${m}`);
const warn = (m) => console.log(`  [33mwarn[0m  ${m}`);
const note = (m) => console.log(`        ${m}`);

function locate() {
  const root = findRepoRoot();
  if (!root) {
    console.error(
      'Not inside a SitecoreAI repo: no xmcloud.build.json found in this directory or any parent.'
    );
    process.exit(1);
  }
  return { root, info: inspect(root) };
}

/** Shared preflight. Returns the list of failed check names. */
function checks(info) {
  const failed = [];

  if (info.authoringPath) ok(`authoringPath = "${info.authoringPath}"`);
  else {
    bad('xmcloud.build.json has no "authoringPath"');
    note('Deploys will push no items at all. Add e.g. "authoringPath": "./authoring".');
    failed.push('authoringPath');
  }

  if (info.moduleGlobs.length) ok(`sitecore.json modules: ${info.moduleGlobs.join(', ')}`);
  else {
    bad('sitecore.json declares no "modules" globs');
    failed.push('modules');
  }

  if (info.itemsDestRel) ok(`items destination = ${info.itemsDestRel}`);
  else {
    bad('could not derive a module destination matching any glob');
    failed.push('itemsDest');
  }

  if (info.hasSerializationPlugin) ok('Serialization plugin present');
  else {
    warn('no Sitecore.DevEx.Extensibility.Serialization plugin in sitecore.json');
    note('`dotnet sitecore ser push` will not be available.');
  }

  const enabled = info.hosts.filter((h) => h.enabled && h.path);
  if (enabled.length) ok(`rendering hosts: ${enabled.map((h) => h.name).join(', ')}`);
  else {
    bad('no enabled rendering hosts in xmcloud.build.json');
    failed.push('hosts');
  }

  return failed;
}

export function doctor() {
  const { root, info } = locate();
  console.log(`\nQuickTable doctor — ${root}\n`);
  const failed = checks(info);

  const itemsInstalled = info.itemsDest && existsSync(join(info.itemsDest, 'quicktable.module.json'));
  if (itemsInstalled) ok('QuickTable items installed');
  else warn('QuickTable items not installed yet');

  const withComponent = [];
  for (const h of info.hosts.filter((x) => x.path)) {
    const dir = join(root, ...h.path.split('/'), COMPONENT_DIR);
    if (existsSync(join(dir, 'QuickTable.tsx'))) withComponent.push(h.name);
  }
  if (withComponent.length) ok(`component installed in: ${withComponent.join(', ')}`);
  else warn('QuickTable component not installed in any rendering host');

  // The two halves must ship together; either one alone renders nothing.
  if (itemsInstalled && !withComponent.length) {
    bad('items present but no component — QuickTable will render blank in Pages');
    failed.push('lockstep');
  }
  if (!itemsInstalled && withComponent.length) {
    bad('component present but no items — the rendering will not exist in Sitecore');
    failed.push('lockstep');
  }

  console.log(failed.length ? `\n${failed.length} blocking issue(s).\n` : '\nAll good.\n');
  process.exit(failed.length ? 1 : 0);
}

export function init(argv) {
  const { root, info } = locate();
  const dryRun = argv.includes('--dry-run');
  const force = argv.includes('--force');
  const requested = argv
    .filter((a) => a.startsWith('--host='))
    .flatMap((a) => a.slice('--host='.length).split(','))
    .filter(Boolean);

  console.log(`\nQuickTable init — ${root}${dryRun ? '  (dry run)' : ''}\n`);
  const failed = checks(info);
  if (failed.length) {
    console.log('\nFix the failures above, then re-run.\n');
    process.exit(1);
  }

  const { picked, missing } = resolveHosts(info, requested);
  if (missing.length) {
    bad(`unknown rendering host(s): ${missing.join(', ')}`);
    note(`known: ${info.hosts.map((h) => h.name).join(', ')}`);
    process.exit(1);
  }
  if (!picked.length) {
    bad('several rendering hosts are enabled — pick one explicitly');
    note(`--host=${info.hosts.filter((h) => h.enabled && h.path).map((h) => h.name).join(' --host=')}`);
    process.exit(1);
  }

  console.log('');

  // ── items ────────────────────────────────────────────────────────────────
  const itemsExisting = existsSync(info.itemsDest) && readdirSync(info.itemsDest).length > 0;
  if (itemsExisting && !force) {
    warn(`${info.itemsDestRel} already exists — skipping (use --force to overwrite)`);
  } else if (dryRun) {
    ok(`would write items to ${info.itemsDestRel}`);
  } else {
    mkdirSync(info.itemsDest, { recursive: true });
    cpSync(PAYLOAD_ITEMS, info.itemsDest, { recursive: true });
    ok(`items  -> ${info.itemsDestRel}`);
  }

  // ── component ────────────────────────────────────────────────────────────
  for (const host of picked) {
    const dest = join(root, ...host.path.split('/'), COMPONENT_DIR);
    const destRel = rel(root, dest);
    if (existsSync(join(dest, 'QuickTable.tsx')) && !force) {
      warn(`${destRel} already exists — skipping (use --force to overwrite)`);
      continue;
    }
    if (dryRun) {
      ok(`would write component to ${destRel}`);
      continue;
    }
    mkdirSync(dest, { recursive: true });
    cpSync(PAYLOAD_COMPONENT, dest, { recursive: true });
    ok(`component -> ${destRel}`);
  }

  console.log(`
Next:

  1. Regenerate the component map (or just start dev, which does it):
       npm run sitecore-tools:generate-map

  2. Get the items into Sitecore — either
       commit + deploy            (normal org path, no CLI auth needed)
     or, for a faster dev loop,
       dotnet tool restore
       dotnet sitecore ser push -n <env> --include Feature.QuickTable

  3. Publish the site so the templates and rendering reach the delivery layer.

  4. Enable QuickTable on each site, in Content Editor:
       - add the QuickTable rendering to the site's Available Renderings
       - create an item under /sitecore/content/<site>/Data using the
         "QuickTable Folder" template
     Both are site content, so they deliberately ship with no serialised item —
     including them would overwrite your own items on the first push.
`);
}
