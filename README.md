# sitecore-quicktable

A portable table component for Sitecore XM Cloud — Sitecore templates, a rendering,
and a Content SDK React component, installed into any project with one command.

Sitecore ships no table rendering out of the box (headless SXA gives you
ColumnSplitter/RowSplitter and RichText, nothing more), so every project builds
its own. QuickTable is that component, packaged so it can be installed rather
than rebuilt.

```bash
npx sitecore-quicktable init
```

## What it installs

| Half | Lands in | How it reaches Sitecore |
|---|---|---|
| Items (SCS module) | `<moduleGlob>/quicktable/` | your normal deploy, or `ser push` |
| React component | `<renderingHost>/src/components/quick-table/` | your normal build |

Both halves must be present. Either one alone renders nothing — `quicktable doctor`
checks for exactly that.

### Sitecore items

```
/sitecore/templates/Feature/QuickTable
├── QuickTable              title, caption      (datasource; Insert Options → Row)
├── QuickTableRow                               (Insert Options → Cell)
├── QuickTableCell          cellContent [Rich Text]
├── QuickTable Folder                           (datasource container)
└── Rendering Parameters/QuickTableParameters
        firstRowIsHeader · striped · disableRowLines · disableColumnLines

/sitecore/layout/Renderings/Feature/QuickTable  (Json Rendering)
```

Item GUIDs are **frozen** — every install gets the same IDs, which is what lets
tooling recognise a QuickTable datasource without schema discovery. They live in
`tools/ids.json`; never regenerate them.

Two deliberate design choices:

- **Row and column counts are derived from the child items.** No droplink lookup
  fields, so the module has no dependency on site content and stays purely
  Feature-layer.
- **Styling lives in rendering parameters, not the datasource template.** Styling
  is presentation, and parameters flow through the layout service automatically —
  no ComponentQuery edits and no Edge schema-cache wait when they change.

### Component

Renders each cell through the SDK's `<RichText>`, so cells carry Sitecore field
metadata and stay **editable inline in the Pages canvas**. Styling uses plain
Tailwind utilities rather than theme tokens, and prop types are declared locally,
so it compiles in any Content SDK app rather than only the starter kits.

## Commands

```bash
npx sitecore-quicktable init [--host=<name>] [--force] [--dry-run]
npx sitecore-quicktable doctor
```

Run from anywhere in the repo — the CLI walks up to `xmcloud.build.json`.

`--host` is required when more than one rendering host is enabled. `init` derives
the items destination from `sitecore.json`'s module globs rather than assuming a
path, because a `module.json` placed outside those globs is pushed by nothing and
**fails silently at deploy time**.

`doctor` is read-only and exits non-zero on a blocking problem, so it works in CI.

## After installing

```
1. npm run sitecore-tools:generate-map      # or just start dev
2. commit + deploy                          # items pushed by the pipeline
3. publish the site
4. enable QuickTable on each site           # from the QuickTable app
```

Step 4 covers two things the module deliberately does **not** ship: adding the
rendering to the site's Available Renderings, and creating the
`/Data/QuickTable Folder` item. Both live in the site's own content tree, so
serialising them would overwrite the consuming project's items on first push.

For a faster dev loop you can skip the deploy in step 2:

```bash
dotnet tool restore
dotnet sitecore cloud login
dotnet sitecore ser push -n <env> --include Feature.QuickTable
```

## Regenerating the items

The YAML under `payload/items/` is generated from the model in `tools/gen-items.mjs`:

```bash
npm run gen
```

Edit the model, regenerate, commit both. GUIDs are read from `tools/ids.json` and
reused, so regeneration is stable.

## Notes

- `allowedPushOperations` is `CreateUpdateAndDelete` on QuickTable's own paths, so
  a re-push **overwrites local edits** to these templates. Extend by inheriting a
  new template rather than editing QuickTable's.
- The two halves version together. Installing a newer component against older
  items (or vice versa) is the most likely cause of a blank or malformed table.
