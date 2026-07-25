# Paste an Excel table straight into Sitecore

Sitecore ships no table component. Headless SXA gives you ColumnSplitter,
RowSplitter, RichText and a handful of others — no table. So every project
builds its own, and authors end up either fighting a Rich Text editor or
hand-creating one item per cell.

SmartTable is that component, packaged so it can be installed instead of
rebuilt, plus a Marketplace app that turns a copied Excel range into Sitecore
items in one paste.

![SmartTable logo](images/smarttable-logo.png)

---

## The three pieces, and how they connect

This is the part worth understanding before any code. There are three
deployables, they run in different places, and nothing links them at build time.

```
┌──────────────────────────┐
│  npx sitecore-smarttable │  installer (npm package)
│         init             │
└────────────┬─────────────┘
             │ copies two folders into the customer's repo
             ▼
┌─────────────────────────────────────────────────────────┐
│  Customer's SitecoreAI repo                             │
│                                                         │
│   authoring/items/smarttable/**   ──deploy──►  Sitecore │
│      (templates + rendering)                    (CM)    │
│                                                         │
│   src/components/smart-table/**   ──build──►   Editing  │
│      (React component)                          host    │
└─────────────────────────────────────────────────────────┘
                                                    ▲
                     renders the table, and the     │
                     canvas the author edits in ────┘
                                                    │
┌──────────────────────────┐                        │
│  SmartTable app          │  Marketplace app       │
│  (Next.js, on Vercel)    │                        │
│                          │                        │
│  runs inside Pages ──────┼── writes items ───► Sitecore
│  as a Custom Field       │   (Authoring API,      │
│                          │    author's session)   │
└──────────────────────────┘                        │
             │                                      │
             └──── pages.reloadCanvas ──────────────┘
```

The important properties:

- **The installer never talks to Sitecore.** It is a file copy. The items reach
  the CM through the customer's normal deploy; the component through their
  normal build.
- **The app never touches the customer's repo.** It writes items over the
  Authoring API, in the browser, inside the Pages iframe.
- **They meet only in Sitecore** — the app writes Row/Cell items that the
  component reads. What keeps them in agreement is that the template GUIDs are
  frozen and identical in every install.
- **No secrets anywhere.** Writes travel on the signed-in author's session, so
  Sitecore's own item permissions apply. There is no application secret for a
  consuming project to store, and no public write endpoint in the head app.

That last point drove the whole design. The obvious alternative — an API route
in the Next.js app that writes items with automation credentials — needs a
client secret in every consuming project and exposes an endpoint that can
overwrite arbitrary items. The Custom Field extension point avoids both.

---

## Step 1 — Install

```bash
npx github:akshanshdbusiness-gif/sitecore-smarttable init --host=<your-rendering-host>
```

The installer reads `xmcloud.build.json` and `sitecore.json` to work out where
things go, rather than assuming a layout:

```js
// derive the items destination from the customer's own module glob —
// a module.json placed outside those globs is pushed by nothing
// and fails silently at deploy time
const bases = sitecore.modules.map(globBase);          // "authoring/items/**/*.module.json" → "authoring/items"
const preferred = bases.find((b) => b.startsWith(authoringPath)) ?? bases[0];
const itemsDest = join(root, preferred, 'smarttable');
```

Then commit, deploy, and publish. Two steps stay manual, per site: adding the
rendering to **Available Renderings**, and creating a `SmartTable Folder` item
under the site's `/Data`. Both live in the customer's own content tree, so
shipping them in the module would overwrite their items on first push.

---

## Step 2 — The content model

Twenty-one serialized items, generated from a single script so a field change is
a one-line edit rather than hand-patching twenty files.

```
/sitecore/templates/Feature/SmartTable
├── SmartTable          title, caption     (datasource; Insert Options → Row)
├── SmartTableRow                          (Insert Options → Cell)
├── SmartTableCell      cellContent [Rich Text]
├── SmartTable Folder                      (datasource container)
└── Rendering Parameters/SmartTableParameters
        firstRowIsHeader · striped · disableRowLines · disableColumnLines
```

Two decisions that matter:

**Row and column counts are derived from the child items.** No droplink lookup
fields pointing at "1, 2, 3…" items. Those lookups live in site content, which
would tie a Feature-layer module to a particular site's tree — and they cap how
large a table can be.

**Styling lives in rendering parameters, not the datasource template.** Styling
is presentation, and the datasource may be shared across placements. Parameters
also flow through the layout service automatically, so adding one needs no
ComponentQuery edit and no Edge schema-cache wait.

![Row and Cell items in the content tree](images/content-tree.png)

---

## Step 3 — The component

Each cell renders through the SDK's `<RichText>`. That is what carries Sitecore
field metadata, and field metadata is what makes a cell editable inline in the
canvas:

```tsx
<Tag
  className={className}
  scope={header ? 'col' : undefined}
  // Sitecore's editing chrome is not focusable on its own, so Tab skips past
  // the table. A tab stop per cell gives left-to-right then wrap-to-next-row
  // for free — document order is already exactly that.
  tabIndex={editable ? 0 : undefined}
>
  <RichText field={cell.cellContent?.jsonValue} />
</Tag>
```

Swapping `<RichText>` for `dangerouslySetInnerHTML` would render the same HTML
and silently lose inline editing.

---

## Step 4 — The Marketplace app

Register it as a **Page Builder Custom Field** with **Authoring & Management
API** access, pointed at `/field`. Then add a field to the SmartTable template
with Type `Marketplace Types > Plugin` and Source set to the app id.

### Finding out which table the author is on

The first real obstacle. `pages.context` returns the **page** item, not the
datasource of the component whose field is open — it stays the page even while
the field is open elsewhere on that page.

The datasource has to come from the page's rendering tree. And because
SmartTable's rendering GUID is frozen and identical everywhere, the right
rendering can be matched by id rather than guessed at:

```ts
export function smartTableDatasources(renderings: PageRendering[]): string[] {
  const target = bare(SMARTTABLE.rendering);      // frozen: 38dd112f-…
  return [...new Set(
    renderings
      .filter((r) => bare(r.id) === target)
      .map((r) => r.dataSource)
      .filter((ds): ds is string => Boolean(ds?.trim()))
  )];
}
```

A second trap follows immediately: **a datasource is not always a GUID.** The
default for one created from the canvas is a relative token, and sending it
verbatim as an item id produces a 404:

```ts
// {A1B2…}                → an item id
// /sitecore/content/…    → an absolute path
// local:/Data/My Table   → relative to the *page* item
export function toItemRef(dataSource: string, pagePath: string): ItemRef {
  if (GUID.test(value)) return { itemId: bare(value) };
  if (/^local:/i.test(value)) return { path: `${pagePath}/${value.slice(6).replace(/^\/+/, '')}` };
  if (value.startsWith('/')) return { path: value };
  return { path: `${pagePath}/${value}` };
}
```

### Parsing the clipboard

Excel puts both `text/html` and `text/plain` on the clipboard; a browser copying
a `<table>` puts only HTML. Prefer HTML — the TSV fallback cannot represent
merged cells.

Two things the naive version gets wrong. Merged cells: treating every `<td>` as
one cell silently shifts every column after a `colspan`. And Excel quotes any
cell containing a newline, so splitting `text/plain` on `\n` tears one row into
two. Both are handled by expanding spans into a dense grid and by a
quote-aware TSV reader.

### Writing the items

```ts
const result = await writeGrid({
  ref: datasourceRef,
  grid,
  mode,                                  // 'replace' | 'append'
  rowTemplateId: SMARTTABLE.rowTemplate, // frozen ids again
  cellTemplateId: SMARTTABLE.cellTemplate,
  run: createRunner(client),             // author's session, not a secret
  onProgress: (done, total) => setProgress(done / total),
});
```

Four rules the engine follows, each of which came from an actual failure:

1. **Reuse existing items rather than delete-and-recreate.** Item ids survive,
   so links and personalisation keep working, and a repeat paste over the same
   shape issues no creates at all.
2. **Creates are sequential; content writes are batched small.** Sitecore
   derives ordering from creation, so a parallel burst risks colliding names.
   The Authoring API rate limit is shared across every pipeline and editor
   session in the environment, so the batch size stays low.
3. **Delete surplus rows, do not blank them.** Blanking preserves item ids, but
   the items still exist — so the component still renders them, as empty rows on
   the page. A visible empty row is worse than a lost id.
4. **Deletes run last.** If a delete fails the table already reads correctly.
   The reverse order could remove structure and then fail to write its
   replacement.

Names are zero-padded (`Row-007`), because Sitecore sorts children by name and
`Row-10` would otherwise come before `Row-2`.

![Writing to Sitecore](images/writing-progress.png)

### Finishing the round trip

Because the app writes through the Authoring API, it bypasses Sitecore's own
field-editing flow entirely — the canvas has no reason to know anything changed:

```ts
setPhase('reloading');
try {
  await reloadPagesCanvas(client);   // client.mutate('pages.reloadCanvas')
} catch (e) {
  console.warn('Canvas reload failed; the table was written.', e);
}
setPhase('done');
await closeApp(client);              // a direct method, not a mutation key
```

Both are wrapped separately and run only on success. By that point the items are
already written, so a failed refresh must not present itself as a failed paste —
an author who retries would double their rows in append mode.

![The app inside Pages](images/app-in-pages.png)

---

## Testing without a tenant

The GraphQL transport is injected rather than imported, so the whole write
engine runs under `node --test` against a fake tenant — no credentials, no
browser, no test framework:

```ts
const t = fakeTenant([/* three existing rows */]);
await writeGrid({ ref: { itemId: 'ds-1' }, grid: [['H'], ['A']], run: t.run, ...templates });

assert.deepEqual(t.deleted(), ['r2']);          // surplus row removed, not blanked
assert.equal(t.updates().filter((u) => !u.value).length, 0);
```

Forty tests across the parser and the engine. Two of them found real bugs before
deployment: surplus rows below the pasted range were never being visited, and
the ordering guarantees were not what the code actually did.

---

## What it does not do

- **Merged cells are flattened.** A `colspan` cell is repeated across the
  columns it covered, which keeps the grid aligned but loses the span.
- **Source formatting is dropped.** Cell content is stored as plain text wrapped
  in `<p>`. Authors can format afterwards in the editor.
- **No undo.** Deletes go to the recycle bin rather than being permanent, so a
  mistaken paste is recoverable, but there is no rollback button.
- **Two manual wiring steps per site**, as above.

---

## Try it

```bash
npx github:akshanshdbusiness-gif/sitecore-smarttable init --host=<your-rendering-host>
```

Source: [github.com/akshanshdbusiness-gif/sitecore-smarttable](https://github.com/akshanshdbusiness-gif/sitecore-smarttable)
