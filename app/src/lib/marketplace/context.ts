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
    .filter((id): id is string => Boolean(id && id.trim()))
    .map(bare);
  return [...new Set(ids)];
}

export interface PageContext {
  pageId: string;
  language: string;
  version: number;
  renderings: PageRendering[];
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
    language: typeof pageInfo.language === 'string' ? pageInfo.language : 'en',
    version: typeof pageInfo.version === 'number' ? pageInfo.version : 1,
    renderings: parsePresentationDetails(
      typeof pageInfo.presentationDetails === 'string' ? pageInfo.presentationDetails : null
    ),
  };
}
