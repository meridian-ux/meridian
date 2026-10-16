# @savvifi/meridian-launchpad

The **command-palette / launchpad** renderer of the [meridian](https://github.com/meridian-ux)
renderer family. It renders a modality-neutral `meridian.ui.v1.Launchpad`
descriptor (`command_palette.proto` in `meridian-schemas`) as a ⌘K command
palette, dispatching each `Command`'s action through the same
`meridian-web-react` `ComponentKit` / `RpcInvoker` / `PanelRenderer` seam every
panel uses.

Like the rest of the family the **contract is renderer-neutral** — a TUI or
native renderer can consume the same `Launchpad` descriptor and the same pure
`filterLaunchpad()` — and this package is the **React tier**.

## Command actions

A `Command.action` is one of:

| arm | effect |
| --- | --- |
| `rpc` | `invoker.invoke(service, method)` — fire an RPC (delete/export/re-run) |
| `open_panel` | a focused step rendering the `PanelDescriptor` (a create/edit `FormPanel`) through the host's kit |
| `open_view_id` | `onOpenView(viewId)` (or the provider's action handler) |
| `navigate` | `onNavigate(route)` (or `window.location`) |

`Command.deep_link` is an orthogonal hint for hosts whose palette state is
URL-driven (e.g. a studio console `?cmd=…`).

## Usage

```tsx
import { Launchpad } from "@savvifi/meridian-launchpad";
import { MeridianProvider } from "@savvifi/meridian-web-react";

// `descriptor` is a meridian.ui.v1.Launchpad (authored, or projected from an app
// model — see @savvifi/meridian-aion-projection projectLaunchpad()).
<MeridianProvider invoker={invoker} kit={muiKit} adhoc={{}} renderIcon={renderIcon}>
  <Launchpad
    descriptor={descriptor}
    open={open}
    onClose={() => setOpen(false)}
    onNavigate={(route) => router.push(route)}
  />
</MeridianProvider>
```

The host owns the open gesture — bind ⌘K to toggle `open`. `<Launchpad>` owns
filtering, keyboard navigation (↑/↓/↵/Esc), and dispatch. It must render inside a
`<MeridianProvider>`. Its `rpc` commands use the provider's mutation-tier
transport, so they are denied by default unless the host allows their exact
service/method in `admission.mutations`.

## Query resolver lifecycle

`onResolveQuery?: (query: string) => Promise<Command[]>` optionally supplies
agent-resolved commands under `agentGroupTitle` (default `Ask the agent`). The
callback receives the trimmed, nonempty query after a 250 ms debounce, only
while the palette is open. Memoize the callback to avoid unnecessary restarts.

Changing the query, replacing/removing the callback, closing, or unmounting
invalidates previous results and cancels pending debounce work. Old commands
are withdrawn while the current query is pending; late responses cannot restore
them. Already-started host work is not aborted by this API: hosts must manage
their own transport cancellation if needed. Synchronous throws and rejected
promises clear the pending state and leave local commands available.

Resolution does not execute a command. Returned commands use the existing
user-triggered dispatch and admission checks, including mutation denial by
default and navigation validation.

## Development

See the repository's [v1 API review](../../API_STABILITY.md) for callback ordering,
dispatch-versus-success semantics, exports, and declaration-consumer checks.

```bash
pnpm install
pnpm test        # vitest: the pure filter + a react-dom/server render smoke
bazel build //:pkg   # the publishable npm package (CI publishes on a v* tag)
```
