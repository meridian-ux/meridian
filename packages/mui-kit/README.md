# @savvifi/meridian-mui-kit

The **MUI ComponentKit** for the [meridian](https://github.com/meridian-ux) React
renderer. It paints framework-neutral `meridian.ui.v1` **PanelDescriptor**s and
**ViewDescriptor**s with the aion [`@aion/ui`](https://gitlab.savvifi.com/aion/ui)
MUI component set — the same MUI tables, forms, reducers, and hooks the aion app
already uses — over the `@savvifi/meridian-web-react` `WebRenderer` seam.

It is one implementation of the `ComponentKit` interface, a peer of `htmlKit` and
`shadcnKit`: the kit-agnostic `PanelRenderer` / `ViewRenderer` dispatch the
descriptor shapes to these components, so a single ViewDescriptor renders here as
MUI (with aion's built-in table pagination) instead of plain HTML.

> The point: the aion app can emit its compositions as **protos** (ViewDescriptor)
> and render them with its **existing React/MUI components** — making those
> patterns reusable by any meridian host, not just aion/studio.

## How it fits

```
ViewDescriptor / PanelDescriptor  (meridian-schemas, neutral protos)
        │
        ▼
ViewRenderer / PanelRenderer      (@savvifi/meridian-web-react, kit-agnostic)
        │  dispatches each shape to →
        ▼
aionMuiKit                        (this package: Table→DataTableView, Form→FormView, …)
        │  wraps →
        ▼
@aion/ui  (MUI)                   (DataTableView, FormView, createStudioTheme, …)
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
`aionMuiKit` — so view/slot actions are themed too.

For a single panel (no layout tier), use the kit as a `WebRenderer`:

```ts
import { reactWebRenderer } from "@savvifi/meridian-web-react";
import { aionMuiKit } from "@savvifi/meridian-mui-kit";

const renderer = reactWebRenderer(aionMuiKit);
const handle = renderer.mount({ container, descriptor, theme, invoker, adhoc });
```

## Exports

- `aionMuiKit` — the `ComponentKit` (Table · Form · Prompt · Lro · Fallback · ActionBar · Chrome · themeToStyle).
- `MeridianMuiProvider` — the one-line host wrapper (theme + provider + kit).
- `themeProtoToStudioConfig(theme, mode?)` / `themeProtoToMuiTheme(theme, mode?)` — bind a meridian `Theme` to the aion MUI theme.

## Shape → aion component

| meridian shape | rendered with |
| --- | --- |
| `TablePanel` | `@aion/ui` `DataTableView` (columns from `TableColumn`, rows from the `populate` RPC via the invoker, client pagination built in) |
| `FormPanel` | `@aion/ui` `FormView` (READONLY → disabled card, EDIT → editable + `submit` RPC) |
| `PromptPanel` | `FormView` (standalone input collector) |
| `LroPanel` | inputs `FormView` + a run button firing `start` |
| `Action` (view/slot) | MUI `Button`s (`ActionBar`) firing `call` via the invoker |
| `AdhocPanel` | host-supplied handler (meridian-web-react adhoc registry) |

## Status: wrap → lift

**Now (wrap):** the kit wraps published `@aion/ui` components verbatim, so the MUI
look and the reducers/hooks are reused. **Next (lift):** the genuinely-general
table/reducer/hook primitives migrate into this package so it no longer depends on
`@aion/ui`, and any host can adopt the patterns standalone.

See [PAGINATION.md](./PAGINATION.md) for the planned meridian contract-level
pagination (next major).

## Develop

```bash
pnpm install     # @aion/* resolves from the GitLab registry (see .npmrc), meridian from npmjs
pnpm typecheck
pnpm test        # jsdom round-trip of the two real studio views through aionMuiKit
pnpm build       # dist/ (tsc)
```

`@aion/*` requires GitLab package-registry access; inherited from your `~/.npmrc`.
