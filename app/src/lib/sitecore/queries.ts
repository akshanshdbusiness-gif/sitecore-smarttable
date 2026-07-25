/**
 * Authoring & Management API operations for SmartTable.
 *
 * Shapes follow the ones proven against a real tenant in the sibling
 * add-items-to-multilist-field app: `createItem` takes a `fields` input and
 * needs `__Display Name` set explicitly (Sitecore sanitises `name` for the
 * system Name and would otherwise derive a differently-cased Display Name),
 * and `updateItem` needs `version` coerced to a real number because the SDK's
 * runtime payload does not always match its declared type.
 */

export interface GraphqlOperation {
  query: string;
  variables: Record<string, unknown>;
}

export interface CellNode {
  itemId: string;
  name: string;
}

export interface RowNode {
  itemId: string;
  name: string;
  cells: CellNode[];
}

/**
 * Read the existing Row/Cell tree under a datasource.
 *
 * NOTE: the `children { nodes { … } }` shape follows the Authoring API's
 * standard connection pattern, but has not been verified against a live
 * schema. If the first call fails, check the shape in the GraphQL IDE — this
 * is the single most likely place for a schema mismatch.
 */
export interface ItemRef {
  itemId?: string;
  path?: string;
}

/**
 * Read the existing Row/Cell tree under a datasource, addressed by id or path.
 *
 * A datasource is not always a GUID — Sitecore's default for a canvas-created
 * one is the relative token  — so this accepts either and
 * returns the resolved , which callers need as the parent for creates.
 */
export function buildGetTableQuery(params: {
  ref: ItemRef;
  database: string;
  language: string;
}): GraphqlOperation {
  const byId = Boolean(params.ref.itemId);
  const declaration = byId ? '$itemId: ID!' : '$path: String!';
  const selector = byId ? 'itemId: $itemId' : 'path: $path';

  const variables: Record<string, unknown> = {
    database: params.database,
    language: params.language,
  };
  if (byId) variables.itemId = params.ref.itemId;
  else variables.path = params.ref.path;

  return {
    query: `
      query GetSmartTable(${declaration}, $database: String!, $language: String!) {
        item(where: { ${selector}, database: $database, language: $language }) {
          itemId
          name
          children {
            nodes {
              itemId
              name
              children {
                nodes {
                  itemId
                  name
                }
              }
            }
          }
        }
      }
    `,
    variables,
  };
}

export function buildCreateItemMutation(params: {
  name: string;
  templateId: string;
  parentId: string;
  language: string;
}): GraphqlOperation {
  return {
    query: `
      mutation CreateItem($name: String!, $templateId: ID!, $parentId: ID!, $language: String!) {
        createItem(
          input: {
            name: $name
            templateId: $templateId
            parent: $parentId
            language: $language
            fields: [{ name: "__Display Name", value: $name }]
          }
        ) {
          item {
            itemId
            name
          }
        }
      }
    `,
    variables: params,
  };
}

export function buildUpdateFieldsMutation(params: {
  itemId: string;
  database: string;
  language: string;
  version: number;
  fields: Array<{ name: string; value: string }>;
}): GraphqlOperation {
  const declarations = params.fields
    .map((_, i) => `$fieldName${i}: String!, $fieldValue${i}: String!`)
    .join(', ');
  const inputs = params.fields
    .map((_, i) => `{ name: $fieldName${i}, value: $fieldValue${i}, reset: false }`)
    .join(', ');

  const variables: Record<string, unknown> = {
    itemId: params.itemId,
    database: params.database,
    language: params.language,
    // Int scalar rejects a string outright rather than coercing it.
    version: Number(params.version),
  };
  params.fields.forEach((field, i) => {
    variables[`fieldName${i}`] = field.name;
    variables[`fieldValue${i}`] = field.value;
  });

  return {
    query: `
      mutation UpdateFields(
        $itemId: ID!
        $database: String!
        $language: String!
        $version: Int!
        ${declarations}
      ) {
        updateItem(
          input: {
            itemId: $itemId
            database: $database
            language: $language
            version: $version
            fields: [${inputs}]
          }
        ) {
          item {
            itemId
          }
        }
      }
    `,
    variables,
  };
}

/** Normalise a raw/braced GUID to the bare lower-case form the API expects. */
export function normalizeGuid(id: string): string {
  return id.replace(/[{}]/g, '').toLowerCase();
}

/** Extract the Row/Cell tree from a GetSmartTable response. */
export interface TableStructure {
  /** Resolved id of the datasource — needed as the parent for created rows. */
  itemId: string;
  rows: RowNode[];
}

/**
 * Read the datasource and its Row/Cell tree.
 *
 * Returns the resolved `itemId` as well as the rows, because the datasource may
 * have been addressed by path and every subsequent create needs a real id.
 * Returns null when the item does not exist, which the caller must report —
 * silently treating it as an empty table would create rows under nothing.
 */
export function readTableStructure(data: unknown): TableStructure | null {
  const item = (
    data as { item?: { itemId?: string; children?: { nodes?: unknown[] } } } | null
  )?.item;
  if (!item?.itemId) return null;

  const rows = item.children?.nodes ?? [];
  return {
    itemId: item.itemId,
    rows: (
      rows as Array<{ itemId: string; name: string; children?: { nodes?: CellNode[] } }>
    ).map((row) => ({
      itemId: row.itemId,
      name: row.name,
      cells: row.children?.nodes ?? [],
    })),
  };
}

/**
 * Fetch names/paths for several items in one round trip. The Authoring API
 * exposes `item` as a single-id lookup, so this aliases one field per id —
 * used to label the chooser when a page holds more than one SmartTable.
 */
export function buildGetItemNamesQuery(params: {
  itemIds: string[];
  database: string;
  language: string;
}): GraphqlOperation {
  const declarations = params.itemIds.map((_, i) => `$id${i}: ID!`).join(', ');
  const selections = params.itemIds
    .map(
      (_, i) =>
        `i${i}: item(where: { itemId: $id${i}, database: $database, language: $language }) { itemId name path }`
    )
    .join('\n');

  const variables: Record<string, unknown> = {
    database: params.database,
    language: params.language,
  };
  params.itemIds.forEach((id, i) => {
    variables[`id${i}`] = id;
  });

  return {
    query: `
      query GetItemNames($database: String!, $language: String!, ${declarations}) {
        ${selections}
      }
    `,
    variables,
  };
}

export function readItemNames(
  data: unknown,
  count: number
): Array<{ itemId: string; name: string; path: string }> {
  const out: Array<{ itemId: string; name: string; path: string }> = [];
  const record = (data ?? {}) as Record<string, { itemId: string; name: string; path: string } | null>;
  for (let i = 0; i < count; i++) {
    const item = record[`i${i}`];
    if (item) out.push(item);
  }
  return out;
}
