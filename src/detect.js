import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';

/**
 * Everything the CLI needs is discoverable from files a SitecoreAI repo already
 * has — xmcloud.build.json and sitecore.json. Nothing is assumed about the
 * project layout, because the destination that actually works differs per repo:
 * a module.json placed outside sitecore.json's glob is pushed by nothing and
 * fails silently at deploy time.
 */

/** Walk up from `start` looking for the repo's xmcloud.build.json. */
export function findRepoRoot(start = process.cwd()) {
  let dir = resolve(start);
  for (;;) {
    if (existsSync(join(dir, 'xmcloud.build.json'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function readJson(file) {
  try {
    // SitecoreAI config files are frequently saved with a UTF-8 BOM.
    return JSON.parse(readFileSync(file, 'utf8').replace(/^﻿/, ''));
  } catch {
    return null;
  }
}

/**
 * Derive the literal directory prefix of a glob — "authoring/items/**\/*.module.json"
 * yields "authoring/items". That prefix is where a module folder must live for
 * the glob to pick it up.
 */
function globBase(pattern) {
  const parts = pattern.split('/');
  const literal = [];
  for (const p of parts) {
    if (p.includes('*') || p.includes('?')) break;
    literal.push(p);
  }
  return literal.join('/');
}

export function inspect(root) {
  const build = readJson(join(root, 'xmcloud.build.json'));
  const sitecore = readJson(join(root, 'sitecore.json'));

  const authoringPath = build?.authoringPath
    ? build.authoringPath.replace(/^\.\//, '').replace(/\/$/, '')
    : null;

  // "./", ".", "" and "./apps/web" all appear in the wild. Normalise to a
  // repo-relative path, where the repo root itself is "." — not "", which would
  // otherwise read as "no path" and silently drop a single-app repo's only host.
  const normalizeHostPath = (p) => {
    const trimmed = String(p ?? '')
      .replace(/\\/g, '/')
      .replace(/^\.\//, '')
      .replace(/\/+$/, '');
    return trimmed === '' ? '.' : trimmed;
  };

  const hosts = Object.entries(build?.renderingHosts ?? {}).map(([name, cfg]) => ({
    name,
    path: normalizeHostPath(cfg?.path),
    enabled: cfg?.enabled !== false,
  }));

  const globs = Array.isArray(sitecore?.modules) ? sitecore.modules : [];
  const bases = globs.map(globBase).filter(Boolean);

  // Prefer a module glob that sits under authoringPath — that is the one the
  // SitecoreAI deploy pipeline serialises.
  const preferred =
    bases.find((b) => authoringPath && (b === authoringPath || b.startsWith(authoringPath + '/'))) ??
    bases[0] ??
    null;

  const plugins = Array.isArray(sitecore?.plugins) ? sitecore.plugins : [];
  const hasSerializationPlugin = plugins.some((p) => /Serialization/i.test(p));

  return {
    root,
    build,
    sitecore,
    authoringPath,
    hosts,
    moduleGlobs: globs,
    moduleBases: bases,
    itemsDest: preferred ? join(root, ...preferred.split('/'), 'smarttable') : null,
    itemsDestRel: preferred ? `${preferred}/smarttable` : null,
    hasSerializationPlugin,
  };
}

/** Resolve which rendering host(s) get the React component. */
export function resolveHosts(info, requested) {
  const enabled = info.hosts.filter((h) => h.enabled && h.path);
  if (requested?.length) {
    const picked = [];
    const missing = [];
    for (const name of requested) {
      const hit = info.hosts.find((h) => h.name === name);
      if (hit) picked.push(hit);
      else missing.push(name);
    }
    return { picked, missing };
  }
  return { picked: enabled.length === 1 ? enabled : [], missing: [] };
}

export const rel = (root, p) => relative(root, p).split(sep).join('/');
