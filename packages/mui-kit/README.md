# @savvifi/meridian-mui-kit

The **MUI ComponentKit** for the [meridian](https://github.com/meridian-ux) React
renderer. It paints framework-neutral `meridian.ui.v1` **PanelDescriptor**s and
**ViewDescriptor**s with **MUI** — its own table + form components (with
CLIENT/OFFSET/CURSOR pagination) — over the `@savvifi/meridian-web-react`
`WebRenderer` seam.

It is one implementation of the `ComponentKit` interface, a peer of `htmlKit` and
`shadcnKit`: the kit-agnostic `PanelRenderer` / `ViewRenderer` dispatch the
descriptor shapes to these components, so a single ViewDescriptor renders here as
MUI instead of plain HTML.

> **Standalone.** The kit owns its components — `MeridianTable` / `MeridianForm`,
> lifted and generalized from a graph-backed host's `a host's internal MUI component library` patterns (the MUI table +
> pagination, the typed form fields) — so it has **no `a host's internal MUI component library` dependency**. Any
> meridian host can reuse the patterns, not just a studio console. Its only runtime
> peers are React, MUI, and the meridian packages.

## How it fits

Media playback failures degrade to a safe poster, then alt text. Caption,
duration, chapter contents, and safe source links remain available; seek
controls disable without a player. Unknown media kinds use recognized source
extensions or degrade. IMAGE ignores a separate poster. Asset replacement
resets failure state; a caption-track error does not discard working playback.

`LlmPromptPanel` supports local parameter fill and preview with the kit's own
typed controls, including multiline slot editors. Preview validates input and
preserves the last valid output after invalid edits. Remote enum choices use
read admission and offer retry on failure; descriptor replacement isolates late
replies and resets edits. Model metadata, templates, and output schema are text,
never HTML. The shared browser template helper substitutes original tokens once,
leaves unresolved tokens visible, and keeps token-shaped slot values literal.
This surface does not execute a model or invoke a provider API.

Multiline masked slots use native password inputs per line, retaining exact
line separators and trailing blank lines. Enter splits a line; boundary
Backspace/Delete joins lines. Multiline paste is supported, and long values are
paged without truncation. Masked slots and aggregates containing masked fields
stay concealed in preview until **Show masked values in preview** is selected;
each successful new preview resets concealment. Masking is visual protection,
not encryption or isolation from host-page code.

`MeridianMuiProvider` forwards the shared `onPromptResponse(panelId, values)`
callback for standalone prompts. `values` is a protobuf `Struct` keyed by field
ID (or by panel ID for a boolean confirmation); `null` means cancellation.
Pending callbacks block duplicates; failures preserve typed edits for retry.
Numeric edits are validated before callbacks/RPCs: empty input is not zero,
integer fractions are not truncated, and unsafe integers are rejected.

```
ViewDescriptor / PanelDescriptor  (meridian-schemas, neutral protos)
        │
        ▼
ViewRenderer / PanelRenderer      (@savvifi/meridian-web-react, kit-agnostic)
        │  dispatches each shape to →
        ▼
muiKit                            (this package: Table→MeridianTable, Form→MeridianForm, …)
        │  built on →
        ▼
@mui/material                     (Table, TablePagination, TextField, …)
```

## Usage

```tsx
import { MeridianMuiProvider } from "@savvifi/meridian-mui-kit";
import { ViewRenderer } from "@savvifi/meridian-web-react";

<MeridianMuiProvider invoker={rpcInvoker} theme={skin} adhoc={handlers}>
  <ViewRenderer view={viewDescriptor} />
</MeridianMuiProvider>;
```

`MeridianMuiProvider` sets up one MUI `ThemeProvider` (bound to the meridian
`Theme`) + `CssBaseline` over the subtree, then a `MeridianProvider` wired to
`muiKit` — so view/slot actions are themed too.

Mutations from descriptor actions, form submits, table row actions, and LRO
starts are denied by default. Allow only the methods this host expects:

```tsx
<MeridianMuiProvider
  invoker={rpcInvoker}
  admission={{ mutations: ["demo.catalog.v1.Product/DeleteProduct"] }}
>
  <ViewRenderer view={viewDescriptor} />
</MeridianMuiProvider>
```

Reads remain open by default; `onDenied` can be supplied on the policy for
logging or host-side feedback. `admission: "unrestricted"` is an explicit
opt-out for first-party-only descriptor sources.

For a single panel (no layout tier), use the kit as a `WebRenderer`:

```ts
import { reactWebRenderer } from "@savvifi/meridian-web-react";
import { muiKit } from "@savvifi/meridian-mui-kit";

const renderer = reactWebRenderer(muiKit);
const handle = renderer.mount({ container, descriptor, theme, invoker, adhoc });
```

## Exports

- `muiKit` — the `ComponentKit` (Table · Form · Prompt · Lro · Fallback · ActionBar · Chrome · themeToStyle).
- `MeridianMuiProvider` — the one-line host wrapper (theme + provider + kit).
- `MeridianTable` / `MeridianForm` — the standalone MUI components, reusable directly.
- `themeProtoToThemeConfig` / `createMuiThemeFromConfig` / `themeProtoToMuiTheme` — bind a meridian `Theme` to MUI.

## Shape → component

| meridian shape | rendered with |
| --- | --- |
| `TablePanel` | `MeridianTable` (columns from `TableColumn`, rows from the `populate` RPC via `usePagedRows`, MUI `TablePagination`) |
| `FormPanel` | `MeridianForm` (READONLY → disabled card, EDIT → editable + `submit` RPC) |
| `PromptPanel` | `MeridianForm` (standalone input collector) |
| `LroPanel` | inputs form + a run button firing `start` |
| `Action` (view/slot) | MUI `Button`s (`ActionBar`) firing `call` via the invoker |
| `AdhocPanel` | host-supplied handler (meridian-web-react adhoc registry) |

## Pagination

The Table drives all three `TablePanel.pagination` modes through
meridian-web-react's `usePagedRows`:

- **CLIENT** — fetch once, paginate the rows locally (small lists).
- **OFFSET** — re-fetch per page via offset/limit request fields + a total count.
- **CURSOR** — cursor / next-cursor per page. **a graph-backed host's preferred paradigm** (tRPC
  infinite-query shape: input `{ cursor }`, output `{ items, nextCursor }`).

## Develop

```bash
pnpm install     # everything resolves from npmjs (React, MUI, emotion, meridian-*)
pnpm typecheck
pnpm test        # fast jsdom round-trip (inner loop): CLIENT/OFFSET/CURSOR pagination
pnpm build       # dist/ (tsc)
```

## Real-browser tests + visual catalog (Bazel)

jsdom is the fast inner loop; the confidence loop runs in **real, hermetic Chrome
for Testing** (`rules_chrome` + Playwright) — 0 tolerance for UI mishaps. One
fixture harness (`harness/entry.tsx`, every primitive + layout) is esbuild-bundled
and driven in the browser; the *same* fixtures produce the screenshot catalog, so
the doc can never drift from what the kit renders.

```bash
bazel test  //:browser_test     # renders every fixture in real Chrome + asserts
                                #   real interactions: pagination clicks re-fetch
                                #   (offset + cursor), tabs switch, forms edit,
                                #   header-above-form ordering, actions render.
bazel build //:catalog_figures  # a labeled PNG per primitive/layout (build artifact)
bazel build //:catalog          # → bazel-bin/catalog.pdf — the visual catalog
                                #   (rules_tectonic), every primitive + layout.
```

`FIXTURES` in `BUILD.bazel` must match `window.meridianHarness.list()`.
