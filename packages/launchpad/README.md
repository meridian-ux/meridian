# @savvifi/meridian-launchpad

The **command-palette / launchpad** renderer of the [meridian](https://github.com/meridian-ux)
renderer family. It renders a modality-neutral `meridian.ui.v1.Launchpad`
descriptor (`command_palette.proto` in `meridian-schemas`) as a ⌘K command
palette, dispatching each normalized command through the shared
`meridian-web-react` invocation admission boundary.

Like the rest of the family the **contract is renderer-neutral** — a TUI or
native renderer can consume the same `Launchpad` descriptor and the same pure
`filterLaunchpad()` — and this package is the **React tier**.

## Command actions

A present `Command.affordance` wins whole, even when its intent or label is
empty. It supports all seven canonical targets through explicit host capabilities.
Otherwise the existing `Command.action` is normalized:

| arm | effect |
| --- | --- |
| `rpc` | mutation admission and the actual Rust binding builder, then the host RPC capability/transport |
| `open_panel` | explicitly admitted `invocation.capabilities.openPanel`; no implicit panel mounting |
| `open_view_id` | explicitly admitted `invocation.capabilities.openView` |
| `navigate` | explicitly admitted `invocation.capabilities.navigate`; no router/window fallback |

`Command.deep_link` is an orthogonal hint for hosts whose palette state is
URL-driven (e.g. a studio console `?cmd=…`). Only legacy commands select it ahead
of their old action; it requires an explicit URI capability and policy. It never
overrides a present canonical affordance. Unsafe schemes remain rejected.

## Usage

```tsx
import { Launchpad } from "@savvifi/meridian-launchpad";
import { MeridianProvider } from "@savvifi/meridian-web-react";

// `descriptor` is a meridian.ui.v1.Launchpad (authored, or projected from an app
// model — see @savvifi/meridian-aion-projection projectLaunchpad()).
<MeridianProvider invoker={invoker} kit={muiKit} adhoc={{}} renderIcon={renderIcon}
  invocation={{
    capabilities: { navigate: async (target) => { router.push(target.route); } },
    admit: (intent) => intent.case === "navigate" && intent.value.route.startsWith("/builds"),
  }}>
  <Launchpad
    descriptor={descriptor}
    open={open}
    onClose={() => setOpen(false)}
  />
</MeridianProvider>
```

The host owns the open gesture — bind ⌘K to toggle `open`. `<Launchpad>` owns
filtering, keyboard navigation (↑/↓/↵/Esc), and dispatch. It must render inside a
`<MeridianProvider>`. Its `rpc` commands use the provider's mutation-tier
transport, so they are denied by default unless the host allows their exact
service/method in `admission.mutations`.

`onNavigate` and `onOpenView` remain type-compatible deprecated props, not
capability grants. Move their implementations into the provider's explicitly
registered capabilities and supply a restrictive target policy. There is no
`onAction` fallback. `onRun` now reports only actual successful settlement with
the original Command envelope, after `onClose`; denial, failure, cancellation,
stale scope, or failed refresh neither closes nor notifies. Failed refresh keeps
an explanation that the effect must not be repeated to refresh the view.

Pending effects retain a reachable Cancel action and a palette-wide duplicate
guard until even noncooperative work settles. Query/context replacement,
closing, and unmounting cancel local observation and suppress late completion.
Reopening does not release a still-pending guard. Native option buttons and the
search combobox preserve arrows/Enter, Tab-to-cancel, Escape, and focus return.
Search metadata, canonical label/description/icon/tone/emphasis, sanitized linked
feedback, and raw binding values remain separate from permission.

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

Returned descriptors are bounded and owned before retention; local/default and
agent commands share the 1,000-control ceiling. Excessive or malformed agent
results never become runnable. Duplicate suggestion entries retain distinct
keyboard identities.

Resolution does not execute a command. Returned commands use the existing
user-triggered dispatch and admission checks, including mutation denial by
default and navigation validation.

## Development

See the repository's [v1 API review](../../API_STABILITY.md) for callback ordering,
dispatch-versus-success semantics, exports, and declaration-consumer checks.

```bash
pnpm install
pnpm test
bazel test //packages/launchpad:all
bazel build //packages/launchpad:pkg
```
