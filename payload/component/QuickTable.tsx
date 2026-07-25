import React from 'react';
import { RichText, Text } from '@sitecore-content-sdk/nextjs';
import type {
  QuickTableCellItem,
  QuickTableProps,
  QuickTableRowItem,
} from './quick-table.props';

/**
 * QuickTable — renders a table stored as Row/Cell child items of the datasource.
 *
 * Cells are rendered with the SDK's <RichText> so each one carries Sitecore
 * field metadata; that is what makes a cell editable inline in the Pages canvas.
 * Do not swap it for dangerouslySetInnerHTML — inline editing would be lost.
 *
 * Styling uses plain Tailwind utilities rather than theme tokens (bg-primary,
 * text-muted-foreground, …) so the component looks correct in projects that
 * don't ship the starter kits' theme.
 */

/** Sitecore returns children in sort order; fall back to the Row-N / Cell-N suffix. */
function bySuffix<T extends { name: string }>(items: T[]): T[] {
  const suffix = (n: string) => {
    const m = /(\d+)\s*$/.exec(n);
    return m ? Number(m[1]) : Number.NaN;
  };
  if (items.some((i) => Number.isNaN(suffix(i.name)))) return items;
  return [...items].sort((a, b) => suffix(a.name) - suffix(b.name));
}

const isChecked = (v?: string): boolean => v === '1' || v === 'true';

const cellText = (cell: QuickTableCellItem): string => cell.cellContent?.jsonValue?.value ?? '';

function Cell({
  cell,
  header,
  className,
}: {
  cell: QuickTableCellItem;
  header: boolean;
  className: string;
}) {
  const Tag = header ? 'th' : 'td';
  return (
    <Tag className={className} scope={header ? 'col' : undefined}>
      <RichText field={cell.cellContent?.jsonValue} />
    </Tag>
  );
}

export const Default: React.FC<QuickTableProps> = (props) => {
  const { fields, params, page } = props;
  const isPageEditing = page?.mode?.isEditing ?? false;
  const datasource = fields?.data?.datasource;

  if (!datasource) {
    return isPageEditing ? (
      <div className="rounded border border-dashed border-gray-300 p-6 text-center text-sm text-gray-500">
        QuickTable: no datasource selected. Choose or create one in the component
        properties.
      </div>
    ) : null;
  }

  const allRows = bySuffix(datasource.children?.results ?? []);
  const firstRowIsHeader = isChecked(params?.firstRowIsHeader);
  const striped = isChecked(params?.striped);
  const noRowLines = isChecked(params?.disableRowLines);
  const noColLines = isChecked(params?.disableColumnLines);

  if (allRows.length === 0) {
    return isPageEditing ? (
      <div className="rounded border border-dashed border-gray-300 p-6 text-center text-sm text-gray-500">
        QuickTable is empty. In Content Editor, insert <strong>QuickTableRow</strong>{' '}
        items under this datasource, then <strong>QuickTableCell</strong> items
        inside each row.
      </div>
    ) : null;
  }

  const headerRow = firstRowIsHeader ? allRows[0] : undefined;
  const bodyRows = firstRowIsHeader ? allRows.slice(1) : allRows;

  // A header of entirely blank cells is a structural placeholder — hide it from
  // visitors, but keep it visible while editing so authors can fill it in.
  const headerCells = bySuffix(headerRow?.children?.results ?? []);
  const headerIsBlank = headerCells.every((c) => !cellText(c).replace(/<[^>]*>/g, '').trim());
  const showHeader = Boolean(headerRow) && (isPageEditing || !headerIsBlank);

  const cellBase = ['px-4 py-2 align-top text-left', noColLines ? '' : 'border-r last:border-r-0']
    .filter(Boolean)
    .join(' ');
  const rowBorder = noRowLines ? '' : 'border-b last:border-b-0';

  const renderRow = (row: QuickTableRowItem, index: number, header: boolean) => {
    const cells = bySuffix(row.children?.results ?? []);
    const zebra = !header && striped && index % 2 === 1 ? 'bg-gray-50' : '';
    return (
      <tr key={row.id} className={[rowBorder, zebra].filter(Boolean).join(' ')}>
        {cells.map((cell) => (
          <Cell
            key={cell.id}
            cell={cell}
            header={header}
            className={[cellBase, header ? 'font-semibold' : ''].filter(Boolean).join(' ')}
          />
        ))}
      </tr>
    );
  };

  return (
    <div className={['quick-table', params?.GridParameters, params?.Styles].filter(Boolean).join(' ')}>
      {datasource.title?.jsonValue?.value || isPageEditing ? (
        <h2 className="mb-3 text-2xl font-semibold">
          <Text field={datasource.title?.jsonValue} />
        </h2>
      ) : null}

      {/* Horizontal scroll must live on a wrapper so the page body never scrolls. */}
      <div className="w-full overflow-x-auto">
        <table className="w-full border-collapse border-gray-200 text-sm [&_td]:border-gray-200 [&_th]:border-gray-200 [&_tr]:border-gray-200">
          {datasource.caption?.jsonValue?.value ? (
            <caption className="caption-bottom pt-2 text-xs text-gray-500">
              <Text field={datasource.caption?.jsonValue} />
            </caption>
          ) : null}
          {showHeader && headerRow ? <thead>{renderRow(headerRow, 0, true)}</thead> : null}
          <tbody>{bodyRows.map((row, i) => renderRow(row, i, false))}</tbody>
        </table>
      </div>
    </div>
  );
};

export default Default;
