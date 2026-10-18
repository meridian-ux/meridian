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

## Palette adoption

The MUI shell palette also uses normalized commands and the shared dispatcher.
Search still uses the Command title/subtitle/keywords, and renders its icon and
shortcut; those fields never replace explicit canonical intent. This shell's
legacy URL-state mode projects `deep_link` to a URI action only when canonical
Affordance presence is absent. Empty or denied canonical intent never revives
that hint or the old oneof. Unsafe URI/navigation destinations stay unavailable.
All targets require the same explicit host policy/capability wiring as panel
actions; the shell's routing seam and `hrefFor` are not automatic grants. Hosts
wanting focused panel steps must implement their granted `openPanel` capability,
not rely on a descriptor causing implicit mounting. Pure matching/focus does no
IO. Search reordering retains logical controls; filtering and close/reopen
invalidate their active scopes while retaining pending duplicate guards until
settlement. A shared palette guard also serializes different commands. The
retained footprint is bounded to 1,000 command occurrences, including defaults.

## Reference form adoption

HTML and Shadcn ordinary FormPanel submission now uses this dispatcher and the
actual bounded Rust submission builder. Canonical presence (including empty)
wins over the legacy save call and label. The existing collector validates
current fields/dynamic options before activation. Canonical submit description,
icon key, tone, and explicit emphasis remain visible without granting invocation;
description and live feedback are linked to the submit control. Only committed
activation and
current-scope checks read FormData, never paint, hydration, or focus. Collected
values replace the host form bag rather than merging undeclared data. Owned
FormField protos, the selected admitted call, explicit bindings, and automatic
field-ID mappings retain their own contracts. Raw false, zero, Unicode, and
binding precedence are preserved. A request-construction failure never falls
back to the legacy JavaScript interpreter or an old submit call.

Legacy denied-save controls keep their observed disabled/status UI. Canonical
denial is reachable and explained; pending submission is guarded with linked
busy status and cancel, retaining focus and duplicate protection until actual
settlement. Edits/unmount/context replacement suppress late status/refresh.
Failures are sanitized and input survives retry. Saved status belongs only to
its original scope; refresh failure remains distinct from effect failure.

The shared browser hook also enforces safe URI/navigation schemes before any
host capability, including intent produced by a semantic resolver. A permissive
host grant cannot enable executable/document-local schemes. Hosts still supply
and may further restrict all destination capabilities; no implicit opener exists.

## Still required

Remaining web-components row/resource actions and chat/TUI adoption
remain separate work.
Reference LRO inputs retain the existing complete start/poll/finalize workflow;
the ordinary FormPanel migration does not replace it with an acknowledged RPC.
The existing legacy shapes remain during the compatibility window; canonical
presence must win whole, including empty/false, when those sources migrate.
Private/public producer upgrades, external migration/removal prerequisites, and
the production cutover still require their own acceptance evidence. This focused
control adoption alone does not complete the renderer roadmap issue.

## MUI controlled form adoption

MUI FormPanel now uses the same normalized seven-target dispatcher and Rust
submission builder. Current values and resolved options publish only on commit;
validation precedes admission and typed effects. Canonical empty/denied intent
never falls back to the legacy save call. Metadata, linked sanitized feedback,
reachable pending/cancel controls, and appropriate focus return are retained.
Mutation policy denial is explained without executing host callbacks in paint.

Declared prefill settles before editable controls mount. Prefill is owned under
the existing JSON budget and projected through declared own fields, including
repeated object children; inherited-looking and undeclared properties never
become collected inputs. Projection caps value nodes at 1,000 and nesting at 64
before retaining prefill, as well as before submission. Failed/invalid prefill
remains nonfatal with descriptor defaults and an explicit generic warning,
never raw transport details. Changed descriptor/selection/transport scopes
cannot seed controls with obsolete replies.

Only blank, non-prefilled create-like forms reset after actual successful
settlement. Loaded-record edits retain their values; failed effects and refresh
failures never clear input. Pending duplicates remain guarded until even a
noncooperative capability settles, and context replacement/unmount suppresses
late reset/status/refresh. Prompt and LRO callback/operation workflows remain
separate and unchanged. The MUI form control slot is runtime React content,
not a new serialized descriptor or permission bit.

## Implicit MUI entity navigation

MUI table row clicks now normalize the semantic `open` action with the current
own scalar identifier and view subject, and use the same shared dispatcher as
authored controls. Hosts must supply a pure semantic resolver, capability, and
target policy; the old `onAction` callback is never a fallback. No subject means
no invented entity navigation. Missing/invalid identifiers render visibly inert.

A named native Open button gives each navigable row keyboard access without
changing table semantics. Links, menus, and nested controls keep their gestures.
Rows share the table's pending guard with authored actions, including through
noncooperative cancellation. Linked sanitized outcomes, reachable cancellation,
focus return, and committed context/unmount invalidation use the shared hook.
The optional presenter row slot is runtime React content, not serialized intent
or a permission grant. Its leading navigation cell matches the supplied header.

## Standalone Launchpad adoption

Standalone Launchpad normalizes canonical/legacy command intent through the
same dispatcher, including actual Rust RPC bindings. Canonical whole-presence
wins over legacy action/deep-link hints. No executing router, window location,
open-panel mount, open-view callback, or old action-handler fallback is inferred.
Deprecated callback prop types remain, but hosts must explicitly register typed
capabilities and policy. Search/shortcut/group metadata stays on Command.

Close and original-envelope `onRun` notification happen only after actual
successful settlement; denied/failed/canceled/stale actions and failed refresh
stay explained rather than appearing successful. Query/descriptor/resolver
replacement withdraws obsolete agent results; bounded owned agent descriptors
share the aggregate control ceiling. Native keyboard controls, linked sanitized
feedback, cancellation, focus return, and the palette-wide guard survive query
replacement and close/reopen through noncooperative settlement.

## Web-components authored controls

The imperative-DOM renderer now forwards explicit invocation capabilities through
the public mount and uses the shared dispatcher for ActionPanel/nested canonical
affordances and normalized view/slot controls. Canonical collection presence
wins whole; no-call legacy actions require pure semantic resolution. All seven
targets, Rust RPC bindings, safe destinations, mutation admission, bounded owned
current snapshots, cancellation, focus return, stale suppression, and distinct
refresh failure use this path. It has no URI-anchor, clipboard or legacy fallback.

Panel/view/slot disposal withdraws controls and aborts observation. Header and
slot controls count toward the existing composition ceiling. The DOM context
adapter is runtime-only, not a new serialized DTO or request interpreter. Form,
row/resource action and other modality adoption still need their own evidence;
this slice does not complete renderer-wide acceptance or authorize cutover.

## Web-components ordinary form adoption

Ordinary FormPanel now uses event-only validated DOM collection and the shared
Rust submission builder with canonical whole-presence precedence. It does not
import the ambient host form bag or call legacy host assembly. Prefill is owned,
bounded and projected through declared fields before repeated DOM expansion;
late responses cannot seed replacement forms, and failures keep defaults with
an explicit sanitized warning. Remote enum sources resolve through read-tier
admission, share a bounded option-expansion budget and remain closed on failure
with retry; forged static options cannot pass resolved declaration validation.

Input/policy/context currentness, pending fields, reachable cancel/focus return,
sanitized errors, retained edits and distinct refresh failure use the common
dispatcher. Read-only forms cannot prefill or submit through forced events.
Missing intent invents no Save action. LRO retains its complete existing
start/poll/finalize workflow and host-core capability checks; its request builder
must not be replaced with a single acknowledged action.
