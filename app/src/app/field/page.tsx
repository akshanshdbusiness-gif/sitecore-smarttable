'use client';

import { useCallback, useEffect, useState } from 'react';
import PasteTable from './PasteTable';
import { createRunner, useMarketplaceClient } from '../../lib/marketplace/client';
import { getPageContext, smartTableDatasources, toItemRef } from '../../lib/marketplace/context';
import { buildGetItemNamesQuery, readItemNames } from '../../lib/sitecore/queries';

/**
 * Custom field entry point.
 *
 * The datasource is resolved from the page's rendering tree rather than from
 * pages.context directly: pageInfo is the *page* item even while this field is
 * open for a component, so its id is the wrong target. SmartTable's rendering
 * id is frozen and identical in every install, which makes picking the right
 * rendering out of that tree exact rather than a guess.
 */

interface Candidate {
  /** Raw dataSource value from the rendering tree. */
  value: string;
  label: string;
}

export default function FieldPage() {
  const { client, error: sdkError } = useMarketplaceClient();
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [pagePath, setPagePath] = useState('');
  const [language, setLanguage] = useState('en');
  const [problem, setProblem] = useState<string | null>(null);

  const resolve = useCallback(async () => {
    if (!client) return;
    setProblem(null);
    try {
      const context = await getPageContext(() => client.query('pages.context'));
      setLanguage(context.language);
      setPagePath(context.pagePath);

      const ids = smartTableDatasources(context.renderings);

      if (ids.length === 0) {
        setProblem(
          context.renderings.length === 0
            ? 'This page has no rendering tree yet. Add a SmartTable component to the page first.'
            : 'No SmartTable component found on this page. This field only works alongside a SmartTable.'
        );
        setCandidates([]);
        return;
      }

      // One table is the common case — skip the chooser entirely.
      if (ids.length === 1) {
        setCandidates([{ value: ids[0], label: '' }]);
        setSelected(ids[0]);
        return;
      }

      // Several on one page: label them so the author can tell them apart.
      // A path-shaped datasource already carries a readable name in its last
      // segment; only the GUID-shaped ones need a round trip to name.
      const refs = ids.map((value) => ({ value, ref: toItemRef(value, context.pagePath) }));
      const labelFromPath = (path: string) => path.split('/').filter(Boolean).pop() ?? path;

      let labelled: Candidate[] = refs.map(({ value, ref }) => ({
        value,
        label: ref.path ? labelFromPath(ref.path) : (ref.itemId ?? value),
      }));

      const idRefs = refs.filter((r) => r.ref.itemId);
      if (idRefs.length) {
        try {
          const run = createRunner(client);
          const data = await run(
            buildGetItemNamesQuery({
              itemIds: idRefs.map((r) => r.ref.itemId as string),
              database: 'master',
              language: context.language,
            })
          );
          const named = readItemNames(data, idRefs.length);
          labelled = labelled.map((candidate, i) => {
            const ref = refs[i].ref;
            if (!ref.itemId) return candidate;
            const hit = named.find(
              (n) => n.itemId.replace(/[{}]/g, '').toLowerCase() === ref.itemId
            );
            return hit ? { ...candidate, label: hit.name } : candidate;
          });
        } catch {
          // Names are a nicety; the id fallback above still identifies the item.
        }
      }
      setCandidates(labelled);
    } catch (err) {
      setProblem(err instanceof Error ? err.message : String(err));
      setCandidates([]);
    }
  }, [client]);

  useEffect(() => {
    void resolve();
  }, [resolve]);

  if (sdkError) {
    return (
      <main>
        <h1>SmartTable</h1>
        <p className="note error">
          Could not reach Sitecore: {sdkError.message}. This app has to run inside
          Sitecore, not as a standalone page.
        </p>
      </main>
    );
  }

  if (!client || candidates === null) {
    return (
      <main>
        <h1>SmartTable</h1>
        <p className="note">Connecting to Sitecore…</p>
      </main>
    );
  }

  if (problem) {
    return (
      <main>
        <h1>SmartTable</h1>
        <p className="note error">{problem}</p>
        <button type="button" onClick={() => void resolve()}>
          Retry
        </button>
      </main>
    );
  }

  if (!selected) {
    return (
      <main>
        <h1>SmartTable</h1>
        <p className="note">This page has more than one table. Which one?</p>
        {candidates.map((c) => (
          <button key={c.value} type="button" onClick={() => setSelected(c.value)}>
            {c.label || c.value}
          </button>
        ))}
      </main>
    );
  }

  return (
    <main>
      <h1>SmartTable</h1>
      <p className="note">Paste a table from Excel or a web page.</p>
      <PasteTable
        datasourceRef={toItemRef(selected, pagePath)}
        language={language}
        hasExistingContent
      />
      {candidates.length > 1 && (
        <button type="button" onClick={() => setSelected(null)}>
          Choose a different table
        </button>
      )}
    </main>
  );
}
