'use client';

import { useEffect, useState } from 'react';
import PasteTable from './PasteTable';
import { useMarketplaceClient } from '../../lib/marketplace/client';

/**
 * Custom field entry point.
 *
 * Sitecore renders this inside the field editor and supplies the item context,
 * so there is no item picker and no guessing which table the author selected —
 * the reason this is a custom field rather than a standalone panel.
 *
 * The exact shape of `pages.context` is not yet verified against a live tenant;
 * until it is, the datasource id falls back to the `itemId` query parameter
 * Sitecore appends when hosting the field.
 */
export default function FieldPage() {
  const { client } = useMarketplaceClient();
  const [datasourceId, setDatasourceId] = useState<string | null>(null);
  const [language, setLanguage] = useState('en');

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const fromQuery = params.get('itemId') ?? params.get('sc_itemid');
    if (fromQuery) setDatasourceId(fromQuery);
    const lang = params.get('language') ?? params.get('sc_lang');
    if (lang) setLanguage(lang);
  }, []);

  useEffect(() => {
    if (!client || datasourceId) return;
    client
      .query('pages.context')
      .then((res) => {
        const ctx = res?.data as { itemContext?: { id?: string; language?: string } } | undefined;
        if (ctx?.itemContext?.id) setDatasourceId(ctx.itemContext.id);
        if (ctx?.itemContext?.language) setLanguage(ctx.itemContext.language);
      })
      .catch(() => {
        /* fall back to the query parameter */
      });
  }, [client, datasourceId]);

  if (!datasourceId) {
    return (
      <main>
        <h1>QuickTable</h1>
        <p className="note">
          Waiting for the item context. Open this from a QuickTable datasource in
          Sitecore.
        </p>
      </main>
    );
  }

  return (
    <main>
      <h1>QuickTable</h1>
      <p className="note">Paste a table from Excel or a web page.</p>
      <PasteTable datasourceId={datasourceId} language={language} hasExistingContent />
    </main>
  );
}
