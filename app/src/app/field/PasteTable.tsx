'use client';

import { useEffect, useRef, useState } from 'react';
import { parseClipboard, type Grid } from '../../../../payload/shared/clipboard';
import {
  createRunner,
  reloadPagesCanvas,
  useMarketplaceClient,
} from '../../lib/marketplace/client';
import { SMARTTABLE } from '../../lib/smarttable';
import { writeGrid, type PasteMode } from '../../lib/sitecore/engine';
import type { ItemRef } from '../../lib/marketplace/context';

type Phase = 'idle' | 'capturing' | 'preview' | 'saving' | 'done' | 'error';

interface Props {
  /** The datasource, by id or path — a canvas-created one is a path. */
  datasourceRef: ItemRef;
  language?: string;
  /** Enables the replace/append choice; pointless when the table is empty. */
  hasExistingContent?: boolean;
  onSaved?: () => void;
}

export default function PasteTable({
  datasourceRef,
  language = 'en',
  hasExistingContent = false,
  onSaved,
}: Props) {
  const { client, error: sdkError } = useMarketplaceClient();
  const [phase, setPhase] = useState<Phase>('idle');
  const [grid, setGrid] = useState<Grid>([]);
  const [firstRowIsHeader, setFirstRowIsHeader] = useState(true);
  const [mode, setMode] = useState<PasteMode>('replace');
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState('');
  const captureRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (phase === 'capturing') captureRef.current?.focus();
  }, [phase]);

  /**
   * preventDefault stops the browser inserting the pasted text, but the raw
   * ClipboardData is still readable — so both text/html and text/plain are
   * available with no permission prompt, inside the editor iframe.
   */
  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    e.preventDefault();
    const clipboard = e.nativeEvent.clipboardData;
    const parsed = parseClipboard({
      html: clipboard?.getData('text/html') ?? '',
      text: clipboard?.getData('text/plain') ?? '',
    });

    if (!parsed?.length) {
      setMessage('No table found on the clipboard. Copy one from Excel or a web page first.');
      setPhase('error');
      return;
    }
    setGrid(parsed);
    setPhase('preview');
  };

  const apply = async () => {
    if (!client) return;
    setPhase('saving');
    setProgress(0);
    setMessage('');

    try {
      // Append sends data rows only. Replace keeps a blank header row when the
      // author says the paste has none, so Sitecore's structural header slot
      // still exists — the component hides a blank header from visitors.
      const payload =
        mode === 'append'
          ? firstRowIsHeader
            ? grid.slice(1)
            : grid
          : firstRowIsHeader
            ? grid
            : [Array<string>(grid[0]?.length ?? 0).fill(''), ...grid];

      const result = await writeGrid({
        ref: datasourceRef,
        grid: payload,
        mode,
        language,
        rowTemplateId: SMARTTABLE.rowTemplate,
        cellTemplateId: SMARTTABLE.cellTemplate,
        cellField: SMARTTABLE.cellField,
        run: createRunner(client),
        onProgress: (done, total) => setProgress(total ? done / total : 1),
      });

      setMessage(
        `${result.rows} row${result.rows === 1 ? '' : 's'} × ${result.columns} column${
          result.columns === 1 ? '' : 's'
        } written.`
      );
      setPhase('done');
      onSaved?.();

      // Deliberately after the success state and inside its own catch: the
      // items are already written, so a failed canvas refresh must not present
      // itself as a failed paste. Worst case the author reloads Pages.
      try {
        await reloadPagesCanvas(client);
      } catch (reloadError) {
        console.warn('Canvas reload failed; the table was written.', reloadError);
      }
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
      setPhase('error');
    }
  };

  const reset = () => {
    setGrid([]);
    setMessage('');
    setPhase('idle');
  };

  if (sdkError) {
    return (
      <p className="note error">
        Could not reach Sitecore: {sdkError.message}. This app has to run inside
        Sitecore, not as a standalone page.
      </p>
    );
  }

  const dataRowCount = firstRowIsHeader ? Math.max(0, grid.length - 1) : grid.length;
  const colCount = grid[0]?.length ?? 0;

  return (
    <div className="paste">
      {phase === 'idle' && (
        <button type="button" className="primary" onClick={() => setPhase('capturing')}>
          Paste a table
        </button>
      )}

      {phase === 'capturing' && (
        <div>
          <textarea
            ref={captureRef}
            rows={3}
            onPaste={handlePaste}
            placeholder="Click here, then press Ctrl+V / ⌘V"
            aria-label="Paste target"
          />
          <button type="button" onClick={reset}>
            Cancel
          </button>
        </div>
      )}

      {phase === 'preview' && (
        <div>
          <p className="summary">
            {dataRowCount} data row{dataRowCount === 1 ? '' : 's'} × {colCount} column
            {colCount === 1 ? '' : 's'}
          </p>

          <label>
            <input
              type="checkbox"
              checked={firstRowIsHeader}
              onChange={(e) => setFirstRowIsHeader(e.target.checked)}
            />
            First row is a header
          </label>

          {hasExistingContent && (
            <fieldset>
              <legend>This table already has content</legend>
              {(['replace', 'append'] as const).map((m) => (
                <label key={m}>
                  <input
                    type="radio"
                    name="mode"
                    checked={mode === m}
                    onChange={() => setMode(m)}
                  />
                  {m === 'replace' ? 'Replace it' : 'Add these rows to the end'}
                </label>
              ))}
            </fieldset>
          )}

          <div className="preview" role="region" aria-label="Preview">
            <table>
              <tbody>
                {grid.slice(0, 6).map((row, r) => (
                  <tr key={r}>
                    {row.map((cell, c) => (
                      <td key={c} className={firstRowIsHeader && r === 0 ? 'header' : ''}>
                        {cell}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            {grid.length > 6 && <p className="note">…and {grid.length - 6} more rows</p>}
          </div>

          <button type="button" className="primary" onClick={apply} disabled={!client}>
            {client ? 'Apply' : 'Connecting…'}
          </button>
          <button type="button" onClick={reset}>
            Cancel
          </button>
        </div>
      )}

      {phase === 'saving' && (
        <div>
          <p>Writing to Sitecore… {Math.round(progress * 100)}%</p>
          <progress value={progress} max={1} />
        </div>
      )}

      {phase === 'done' && (
        <div>
          <p className="note">{message}</p>
          <button type="button" onClick={reset}>
            Paste another
          </button>
        </div>
      )}

      {phase === 'error' && (
        <div>
          <p className="note error">{message}</p>
          <button type="button" onClick={reset}>
            Try again
          </button>
        </div>
      )}
    </div>
  );
}
