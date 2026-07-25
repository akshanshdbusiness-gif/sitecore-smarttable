# sitecore-smarttable

A portable table component for SitecoreAI — Sitecore templates, a rendering,
and a Content SDK React component, installed into any project with one command.

Sitecore ships no table rendering out of the box (headless SXA gives you
ColumnSplitter/RowSplitter and RichText, nothing more), so every project builds
its own. SmartTable is that component, packaged so it can be installed rather
than rebuilt.

```bash
npx github:akshanshdbusiness-gif/sitecore-smarttable init
```

Run it from anywhere inside your SitecoreAI repo. If more than one rendering host
is enabled in `xmcloud.build.json`, name the one you want — the CLI will not
guess:

```bash
npx github:akshanshdbusiness-gif/sitecore-smarttable init --host=<your-rendering-host>
```

`<your-rendering-host>` is a key under `renderingHosts` in your own
`xmcloud.build.json`, not a fixed value. Omit the flag and the CLI lists the
names it found.

> Not published to npm yet, so the `github:` prefix is required. Once published,
> `npx sitecore-smarttable init` will work instead.

## What it installs

| Half | Lands in | How it reaches Sitecore |
|---|---|---|
| Items (SCS module) | `<moduleGlob>/smarttable/` | your normal deploy, or `ser push` |
| React component | `<renderingHost>/src/components/smart-table/` | your normal build |

Both halves must be present. Either one alone renders nothing — `smarttable doctor`
checks for exactly that.

### Sitecore items

```
/sitecore/templates/Feature/SmartTable
├── SmartTable              title, caption      (datasource; Insert Options → Row)
├── SmartTableRow                               (Insert Options → Cell)
├── SmartTableCell          cellContent [Rich Text]
├── SmartTable Folder                           (datasource container)
└── Rendering Parameters/SmartTableParameters
        firstRowIsHeader · striped · disableRowLines · disableColumnLines

/sitecore/layout/Renderings/Feature/SmartTable  (Json Rendering)
```

Item GUIDs are **frozen** — every install gets the same IDs, which is what lets
tooling recognise a SmartTable datasource without schema discovery. They live in
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
npx github:akshanshdbusiness-gif/sitecore-smarttable init [--host=<name>] [--force] [--dry-run]
npx github:akshanshdbusiness-gif/sitecore-smarttable doctor
```

| Option | |
|---|---|
| `--host=<name>` | Rendering host from `xmcloud.build.json`. Repeatable, or comma-separated. **Required when more than one host is enabled.** |
| `--force` | Overwrite an existing install. Without it, `init` skips what is already there. |
| `--dry-run` | Report what would be written, change nothing. |

Run from anywhere in the repo — the CLI walks up to `xmcloud.build.json`.

`init` derives the items destination from `sitecore.json`'s module globs rather
than assuming a path, because a `module.json` placed outside those globs is
pushed by nothing and **fails silently at deploy time**.

Verified against four repo layouts: head app under `examples/`, under `headapps/`,
at the repo root, and a non-default module glob.

`doctor` is read-only and exits non-zero on a blocking problem, so it works in CI.

## Requirements

- **Node 20+**
- A **SitecoreAI repo** — `xmcloud.build.json` with an `authoringPath`, and
  `sitecore.json` with module globs
- A **Content SDK** head app — the component imports `@sitecore-content-sdk/nextjs`
- **Tailwind** for styling; without it the table renders correctly but unstyled

## After installing

```
1. npm run sitecore-tools:generate-map      # or just start dev
2. commit + deploy                          # items pushed by the pipeline
3. publish the site
4. enable SmartTable on each site           # manual, see below
```

**Step 4, per site**, in Content Editor or Explorer:

- add the SmartTable rendering to the site's **Available Renderings**
  (`/sitecore/content/<site>/Presentation/Available Renderings/…`)
- create an item under `/sitecore/content/<site>/Data` using the
  **SmartTable Folder** template — the rendering's Datasource Location query
  looks for it, and without it authors get no datasource to pick

Neither ships in the module on purpose: both live in the site's own content tree,
so serialising them would overwrite the consuming project's items on first push.
`doctor` cannot verify them either — it only sees the filesystem, not Sitecore.

For a faster dev loop you can skip the deploy in step 2:

```bash
dotnet tool restore
dotnet sitecore cloud login
dotnet sitecore ser push -n <env> --include Feature.SmartTable
```

## Regenerating the items

The YAML under `payload/items/` is generated from the model in `tools/gen-items.mjs`:

```bash
npm run gen
```

Edit the model, regenerate, commit both. GUIDs are read from `tools/ids.json` and
reused, so regeneration is stable.

## Notes

- `allowedPushOperations` is `CreateUpdateAndDelete` on SmartTable's own paths, so
  a re-push **overwrites local edits** to these templates. Extend by inheriting a
  new template rather than editing SmartTable's.
- The two halves version together. Installing a newer component against older
  items (or vice versa) is the most likely cause of a blank or malformed table.
