import ids from '../../../../../tools/ids.json' with { type: 'json' };

/**
 * Lets tooling confirm the app is deployed and which SmartTable contract it
 * speaks, without opening the UI. Public on purpose: it exposes no secrets and
 * no tenant data, only version metadata.
 */
export const dynamic = 'force-dynamic';

export function GET() {
  return Response.json({
    ok: true,
    app: 'smarttable',
    templates: { table: ids.table.id, row: ids.row.id, cell: ids.cell.id },
  });
}
