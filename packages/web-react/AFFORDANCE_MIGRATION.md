# Affordance activation candidate

Canonical and normalized header/slot/row controls in the HTML, Shadcn, and MUI
kits use the shared host invocation dispatcher. This includes ActionPanel and
nested catalog, connection-flow, and walkthrough actions. URI targets are buttons, not links
that can bypass admission through a context menu or a new tab. Command targets
do not copy text. Clipboard intent requires the explicit `copy` arm.

This document describes the canonical-only [removal candidate](../../schemas/migration/REMOVAL.md),
not an activated production baseline. Frozen additive compatibility evidence is
separate; it does not restore removed APIs in this checkout. Full integration,
external producer upgrades, and cutover approval remain outstanding.

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
never waive mutation admission. The deprecated `onAction` callback is not an
invocation fallback or permission grant.

The removed Action/RowAction DTOs and `resolveSemantic` API are unavailable.
Author a complete typed Affordance; IDs and labels are metadata, not destinations.
Optional `invocation.confirm` receives the canonical affordance, current context,
and header/row subject identity (including zero row IDs). Consent grants no
permission. Only canonical collections are read, including explicit-empty
collections; absent collections and historical wire never revive old controls.
Product header/row mutations must navigate to actual served request views;
only explicit form submission carries the mutation RPC and declared inputs.

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
Neither render, hydration, nor focus executes host policy/consent callbacks or
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

Row RPCs use only their explicit declared bindings; no kit invents an `{id}`
request from the selected record. Refresh is explicitly authored, and false is
authoritative. Shared Rust request construction omits
unset empty-string selections and synthesized empty nested envelopes, but keeps
raw empty objects, literals, zero, false, and whitespace unchanged.

Do not wire the old global `.mer-copy` handler to canonical Affordances: these
controls intentionally carry no command/copy payload data attributes. Dedicated
Snippet and CopyValue controls retain their separate existing copy contract.

## Palette adoption

The MUI shell palette also uses normalized commands and the shared dispatcher.
Search still uses the Command title/subtitle/keywords, and renders its icon and
shortcut; those fields never replace explicit canonical intent. `deep_link`
is metadata only, not a URI target or old-oneof fallback. Missing canonical
intent stays inert and visibly unavailable. Unsafe URI/navigation destinations
stay unavailable.
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
actual bounded Rust submission builder. Only `submit_affordance` can supply
submission intent; an empty or absent target invents no save call. The collector validates
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

Canonical policy denial is reachable and explained; pending submission is guarded with linked
busy status and cancel, retaining focus and duplicate protection until actual
settlement. Edits/unmount/context replacement suppress late status/refresh.
Failures are sanitized and input survives retry. Saved status belongs only to
its original scope; refresh failure remains distinct from effect failure.

The shared browser hook also enforces safe URI/navigation schemes before any
host capability. A permissive
host grant cannot enable executable/document-local schemes. Hosts still supply
and may further restrict all destination capabilities; no implicit opener exists.

## Still required

The canonical-only web-components, React kits, chat, launchpad, and TUI paths
have targeted removal evidence. Complete integration and the external Studio
producer migration are still required; targeted checks alone are not release acceptance.
Reference LRO inputs retain the existing complete start/poll/finalize workflow;
the ordinary FormPanel migration does not replace it with an acknowledged RPC.
Retired shapes remain only in frozen historical test inputs, not runtime APIs.
Coordinated private/public producer upgrades, external migration prerequisites, and
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

## Host-resolved MUI entity navigation

MUI table row clicks use the host's pure `resolveHref(subjectKind, String(id))`
to construct a canonical navigate target with the current own scalar identifier
and view subject. Navigation still requires an explicit navigate capability and
target policy; `resolveHref` is not a grant, and `onAction` is never a fallback. No subject means
no invented entity navigation. Missing/invalid identifiers render visibly inert.

A named native Open button gives each navigable row keyboard access without
changing table semantics. Links, menus, and nested controls keep their gestures.
Rows share the table's pending guard with authored actions, including through
noncooperative cancellation. Linked sanitized outcomes, reachable cancellation,
focus return, and committed context/unmount invalidation use the shared hook.
The optional presenter row slot is runtime React content, not serialized intent
or a permission grant. Its leading navigation cell matches the supplied header.

## Standalone Launchpad adoption

Standalone Launchpad dispatches only `Command.affordance` through the
same dispatcher, including actual Rust RPC bindings. Absent or empty intent
does not fall back to retired action/deep-link hints. No executing router, window location,
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
affordances and canonical view/slot controls. Historical header/slot wire fields
are inert; metadata does not trigger semantic target resolution. All seven
targets, Rust RPC bindings, safe destinations, mutation admission, bounded owned
current snapshots, cancellation, focus return, stale suppression, and distinct
refresh failure use this path. It has no URI-anchor, clipboard or legacy fallback.

Panel/view/slot disposal withdraws controls and aborts observation. Header and
slot controls count toward the existing composition ceiling. The DOM context
adapter is runtime-only, not a new serialized DTO or request interpreter. The
form/table/resource slices below provide their own evidence; other modalities
and complete renderer-wide acceptance remain separate and cutover-gated.

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

## Web-components table adoption

Canonical table collections use the same bounded
adapter and actual Rust request builder. The panel-local selection overrides
ambient row context, with native Enter/Space selection and enabledWhen filtering.
Historical row wire is inert, including when canonical collections are absent;
explicit false suppresses refresh, and unbound calls do not synthesize IDs.
Panel-wide pending guards cover reentrant host callbacks and noncooperative
cancellation. The origin and cancellation stay reachable, and changed rows or
replacement scopes cannot own late feedback/refresh. Failed refresh retains the
selected table and is distinct from a failed effect. Resource-card confirmation
is covered below; other modalities and complete acceptance remain separate work.

## Web-components resource-card adoption

Existing ResourceAction RPCs now project into the common dispatcher, preserving
visibility/styles and explicit bindings without inventing ID/refresh behavior.
The shared snapshot has an optional runtime-only consent hook: admission comes
first, then consent, then the same-scope check before actual Rust assembly and
transport. It is not a serialized capability or grant. Other hosts that omit it
keep their existing behavior, including their separate ResourceAction resolver consent.

Resource confirmation owns a bounded protobuf ConfirmSpec snapshot, displays
literal named/described text, focuses Cancel, cycles Tab/Shift+Tab and handles
Escape. Per-card pending guards cover reentrant callbacks and noncooperative
settlement. A changed row/context/policy/target/spec cannot execute old consent;
complete declaration changes withdraw the old projection until remount (including
removed/replaced target/confirmation objects). A no-longer-visible record cannot
dispatch through a retained button. Disposal removes consent without stealing focus, and failures require fresh consent
on retry. Late populate and effect completion cannot update replacement cards.
Complete cross-repository integration and approved cutover remain outstanding.
