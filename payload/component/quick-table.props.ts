import type { Field } from '@sitecore-content-sdk/nextjs';

/**
 * Structural prop types for QuickTable.
 *
 * These are declared locally rather than imported from `@/lib/component-props`
 * so the component compiles in any Content SDK app, not just the starter kits.
 * The shapes are structurally compatible with the kit's `ComponentProps`, so
 * passing a kit-typed prop object satisfies these without a cast.
 */

export interface QuickTableCellItem {
  id: string;
  name: string;
  /** Rich Text — an HTML string. */
  cellContent?: { jsonValue?: Field<string> };
}

export interface QuickTableRowItem {
  id: string;
  name: string;
  children?: { results?: QuickTableCellItem[] };
}

export interface QuickTableDatasource {
  id: string;
  title?: { jsonValue?: Field<string> };
  caption?: { jsonValue?: Field<string> };
  /** Row items. Cells hang off each row. */
  children?: { results?: QuickTableRowItem[] };
}

/**
 * Rendering parameters arrive as strings — Sitecore serialises a checked
 * Checkbox as "1" and an unchecked one as "" (not a boolean).
 */
export interface QuickTableParams {
  firstRowIsHeader?: string;
  striped?: string;
  disableRowLines?: string;
  disableColumnLines?: string;
  /** SXA styling params, present only if the org's params template supplies them. */
  Styles?: string;
  GridParameters?: string;
  RenderingIdentifier?: string;
  [key: string]: unknown;
}

export interface QuickTableProps {
  rendering?: { componentName?: string };
  params?: QuickTableParams;
  page?: { mode?: { isEditing?: boolean } };
  fields?: { data?: { datasource?: QuickTableDatasource } };
}
