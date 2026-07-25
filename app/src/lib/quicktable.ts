import ids from '../../../tools/ids.json' with { type: 'json' };

/**
 * QuickTable's frozen template ids.
 *
 * Read from the same tools/ids.json the item YAML is generated from, rather
 * than copied: every install shares these GUIDs, so a hand-copied list would
 * drift without erroring — the app would simply stop recognising QuickTable
 * datasources. This import is the reason the app lives in the same repo as the
 * payload.
 */
export const QUICKTABLE = {
  tableTemplate: ids.table.id,
  rowTemplate: ids.row.id,
  cellTemplate: ids.cell.id,
  folderTemplate: ids.folderTemplate.id,
  rendering: ids.rendering.id,
  cellField: 'cellContent',
} as const;

export function isQuickTableTemplate(templateId: string | undefined): boolean {
  if (!templateId) return false;
  return templateId.replace(/[{}]/g, '').toLowerCase() === QUICKTABLE.tableTemplate;
}
