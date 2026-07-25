// Explicit .ts extension so this module resolves both under Next and under
// `node --test`, which cannot resolve extensionless specifiers.
import { SMARTTABLE } from '../smarttable.ts';

/**
 * Resolving which SmartTable the author opened the field on.
 *
 * `pages.context.pageInfo` is the *page* item, not the component's datasource —
 * confirmed against a real tenant in the sibling add-items-to-multilist-field
 * app, where it stays the page even while a Custom Field is open for a
 * component elsewhere on that page. So the datasource has to come from
 * `pageInfo.presentationDetails`: the page's rendering tree, where each
 * rendering optionally carries a `dataSource` item id.
 *
 * SmartTable's rendering id is frozen and identical in every install, so the
 * right rendering can be picked out by id — no probing items to see which one
 * happens to have the field.
 *
 * Observed presentationDetails shape (not formally documented):
 *   { "devices": [ { "renderings": [ { "id", "instanceId", "dataSource" } ] } ] }
 */

export interface PageRendering {
  id: string;
  instanceId?: string;
  placeholderKey?: string;
  dataSource?: string;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null;

const bare = (id: string) => id.replace(/[{}]/g, '').toLowerCase();

export function parsePresentationDetails(raw: string | null | undefined): PageRendering[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }

  const devices = isRecord(parsed) && Array.isArray(parsed.devices) ? parsed.devices : [];
  const out: PageRendering[] = [];
  for (const device of devices) {
    const renderings =
      isRecord(device) && Array.isArray(device.renderings) ? device.renderings : [];
    for (const r of renderings) {
      if (isRecord(r) && typeof r.id === 'string') {
        out.push({
          id: r.id,
          instanceId: typeof r.instanceId === 'string' ? r.instanceId : undefined,
          placeholderKey: typeof r.placeholderKey === 'string' ? r.placeholderKey : undefined,
          dataSource: typeof r.dataSource === 'string' ? r.dataSource : undefined,
        });
      }
    }
  }
  return out;
}

/** Distinct datasource ids of the SmartTable renderings on this page, in placement order. */
export function smartTableDatasources(renderings: PageRendering[]): string[] {
  const target = bare(SMARTTABLE.rendering);
  const ids = renderings
    .filter((r) => bare(r.id) === target)
    .map((r) => r.dataSource)
    .filter((id): id is string => Boolean(id && id.trim()));
  // Raw values, not normalised: a datasource may be a path, where case matters.
  return [...new Set(ids)];
}

export interface PageContext {
  pageId: string;
  pagePath: string;
  language: string;
  version: number;
  renderings: PageRendering[];
}

/**
 * How an item is addressed in the Authoring API: by id, or by path.
 * A datasource is not always a GUID, so callers cannot assume either.
 */
export interface ItemRef {
  itemId?: string;
  path?: string;
}

const GUID = /^\{?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\}?$/i;

/**
 * Turn a rendering's raw `dataSource` value into something addressable.
 *
 * Sitecore stores three forms here, and only one is a GUID:
 *   {A1B2…}                     an item id
 *   /sitecore/content/…         an absolute path
 *   local:/Data/My Table        relative to the *page* item — the default when
 *                               an author creates a datasource from the canvas
 *
 * The `local:` form is why a paste attempt sent the literal string
 * "local:/data/new content item" as an item id and the API found nothing.
 */
export function toItemRef(dataSource: string, pagePath: string): ItemRef {
  const value = dataSource.trim();

  if (GUID.test(value)) return { itemId: bare(value) };

  if (/^local:/i.test(value)) {
    const relative = value.slice('local:'.length).replace(/^\/+/, '');
    const base = pagePath.replace(/\/+$/, '');
    return { path: `${base}/${relative}` };
  }

  if (value.startsWith('/')) return { path: value };

  // A bare name is still relative to the page.
  return { path: `${pagePath.replace(/\/+$/, '')}/${value}` };
}

/**
 * Read the current page. Takes the fetch as a function rather than the SDK
 * itself: the SDK's `query` is generically typed over its own key union, which
 * a structural parameter type cannot express, and this keeps the module free of
 * SDK imports so it runs under `node --test`.
 *
 * Throws with the raw payload attached, since a shape change here is otherwise
 * invisible.
 */
export async function getPageContext(
  fetchPageContext: () => Promise<{ data?: unknown }>
): Promise<PageContext> {
  const { data } = await fetchPageContext();
  const pageInfo = (data as { pageInfo?: Record<string, unknown> } | undefined)?.pageInfo;

  if (!pageInfo?.id) {
    throw new Error(
      'pages.context returned no pageInfo.id. Raw response: ' +
        JSON.stringify(data ?? null).slice(0, 400)
    );
  }

  return {
    pageId: String(pageInfo.id),
    pagePath: typeof pageInfo.path === 'string' ? pageInfo.path : '',
    language: typeof pageInfo.language === 'string' ? pageInfo.language : 'en',
    version: typeof pageInfo.version === 'number' ? pageInfo.version : 1,
    renderings: parsePresentationDetails(
      typeof pageInfo.presentationDetails === 'string' ? pageInfo.presentationDetails : null
    ),
  };
}
