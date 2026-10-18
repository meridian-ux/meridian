# Affordance activation candidate

Canonical and normalized header/slot/row controls in the HTML, Shadcn, and MUI
kits use the shared host invocation dispatcher. This includes ActionPanel and
nested catalog, connection-flow, and walkthrough actions. URI targets are buttons, not links
that can bypass admission through a context menu or a new tab. Command targets
do not copy text. Clipboard intent requires the explicit `copy` arm.

This candidate is part of the coordinated Affordance migration, not an activated
production baseline or a claim that all renderer action sources have migrated.

## Host wiring

`MeridianProvider`, `MeridianMuiProvider`, and the framework-neutral React
renderer mount accept `invocation`. Supply explicit typed capabilities and a
target policy. For example, an application can allow only its own help route:

```tsx
<MeridianProvider
  kit={htmlKit}
  adhoc={{}}
  invoker={transport}
  invocation={{
    admit: intent => intent.case === "uri" && intent.value === "/help",
    capabilities: { uri: async path => { await applicationRouter.open(path); } },
  }}
>
  <PanelRenderer descriptor={descriptor} />
</MeridianProvider>
```

There is no implicit router, clipboard, shell, or panel/view mount. Missing
capabilities and policies visibly deny. A capability is not a policy grant.
Every RPC Affordance separately uses the provider's existing mutation policy,
including Get/List, with the original authenticated transport and the shared
bounded Rust request builder. Optional target policy can further restrict RPCs,
never waive mutation admission. Do not pass an executing `onAction` callback as
the pure semantic resolver.

Legacy no-call Action IDs remain semantic keys. `resolveSemantic` must return
typed intent without executing an old callback, and may return an explicit
confirmation callback. Accepting confirmation is not a permission grant. The
resolver receives the original semantic fields, current context, and header/row
subject identity (including zero row IDs). Canonical collections win whole,
including explicit empty collections; denial never revives legacy intent.

The default `RpcInvoker` still receives exactly its original three arguments.
Hosts with cancellation-aware transport can explicitly provide
`invocation.capabilities.rpc.invoke(service, method, request, signal)`. This
capability still requires mutation admission and never falls back to the default
transport after denial or failure.

## Context and lifecycle

Pass host identity/resource/form/signals through `invocation.context` (or the
mount's `context`). The ambient repeated-record context and active view selection
override the corresponding host row/selection values. Context uses the existing
bounded JSON host seam; authored descriptors remain protobuf.

Rerender the provider/control when replacing descriptors, policies, capabilities,
or identity handles. New source handles publish only on commit: a speculative
replacement render cannot retarget the live control. The existing mutable
selection bag and committed runtime data remain live. At activation and after
confirmation/admission callbacks, a bounded reader refreshes owned snapshots and
invalidates stale consent even when the bag changed without a React render.
Neither render, hydration, nor focus executes host policy/resolver callbacks or
invocation capabilities.

Pending actions expose busy state and a cancel control. Cancellation is best
effort, not rollback of a request already sent; duplicate activation remains
blocked until it settles. Cancellation returns focus to the originating control
only if focus is still on its cancel button. A changed scope or unmount aborts
and suppresses late results/refresh; it does not steal focus in a replacement
view. Retry reads the newly committed descriptor, context, and policy.

Static, linked live-status feedback reports denial/failure without raw errors,
clipboard payloads, or bound secrets. Only a successful effect can refresh;
explicit false suppresses refresh. A refresh failure is reported as completed
with refresh unavailable, not as a failed effect to retry.

Bars and tables retain their group-wide pending guard. Closing/reopening an
overflow keeps the dispatcher lifetime and cannot replay an operation that
ignores abort. A failed action stays in its menu with sanitized feedback and a
reachable retry. Closing disables that retained control; it is not an active
hidden invocation path. Menus retain placement and keyboard focus/navigation.

Legacy row request adaptation is explicit, not a descriptor grant: MUI retains
its observed bare `{id}` default only for unbound legacy row calls; reference
kits retain `{}`. Canonical calls never receive either invented bindings or
legacy refresh behavior. Legacy RowAction refresh remains always-on as observed,
while canonical false is authoritative. Shared Rust request construction omits
unset empty-string selections and synthesized empty nested envelopes, but keeps
raw empty objects, literals, zero, false, and whitespace unchanged.

Do not wire the old global `.mer-copy` handler to canonical Affordances: these
controls intentionally carry no command/copy payload data attributes. Dedicated
Snippet and CopyValue controls retain their separate existing copy contract.

## Still required

Palette commands, form submission with automatic field mapping and validation,
implicit row-click navigation, web-components, and chat/launchpad/TUI adoption
remain separate work.
The existing legacy shapes remain during the compatibility window; canonical
presence must win whole, including empty/false, when those sources migrate.
Private/public producer upgrades, external migration/removal prerequisites, and
the production cutover still require their own acceptance evidence. This focused
control adoption alone does not complete the renderer roadmap issue.
