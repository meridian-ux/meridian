# Affordance activation candidate

Canonical Affordance controls in the HTML, Shadcn, and MUI kits use the shared
host invocation dispatcher. This includes ActionPanel and nested catalog,
connection-flow, and walkthrough actions. URI targets are buttons, not links
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

## Context and lifecycle

Pass host identity/resource/form/signals through `invocation.context` (or the
mount's `context`). The ambient repeated-record context and active view selection
override the corresponding host row/selection values. Context uses the existing
bounded JSON host seam; authored descriptors remain protobuf.

Treat React commits as context updates: rerender the provider/control when data,
policy, capabilities, or identity changes. Do not mutate application state behind
React without a render. The adapter makes bounded owned descriptor/context
copies, detects changed values even when source objects are reused on rerender,
and publishes the new snapshot only at commit. Speculative renders do not
retarget a live control. Neither render, hydration, nor focus executes admission
callbacks or invocation capabilities.

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

Do not wire the old global `.mer-copy` handler to canonical Affordances: these
controls intentionally carry no command/copy payload data attributes. Dedicated
Snippet and CopyValue controls retain their separate existing copy contract.

## Still required

View/header/row actions, palette commands, form submission with automatic field
mapping and validation, and chat/launchpad/TUI adoption remain separate work.
The existing legacy shapes remain during the compatibility window; canonical
presence must win whole, including empty/false, when those sources migrate.
Private/public producer upgrades, external migration/removal prerequisites, and
the production cutover still require their own acceptance evidence. This focused
control adoption alone does not complete the renderer roadmap issue.
