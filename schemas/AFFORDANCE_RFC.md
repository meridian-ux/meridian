# RFC: one Affordance contract

Status: proposed implementation contract for roadmap [#46](https://github.com/meridian-ux/meridian/issues/46).
This document does not introduce schema fields, grant host permissions, or claim
renderer adoption. Schema/migration work is [#47](https://github.com/meridian-ux/meridian/issues/47);
renderer/host adoption is [#48](https://github.com/meridian-ux/meridian/issues/48).

## Problem and existing contracts

The same user intent has several descriptor and runtime representations:

| Existing source | Invocation | Information that must survive migration |
|---|---|---|
| `affordance.proto`: `Affordance` | `uri` tag 5 / `command` tag 6 | ID, label, description, icon, legacy style tag 7 |
| `view.proto`: `Action` | `call` tag 3 | ID, label, placement tag 4 |
| `table.proto`: `RowAction` | `rpc` tag 2 | Label, row predicate tag 3, refresh behavior tag 4 |
| `command_palette.proto`: `Command` | `rpc` 8 / `open_panel` 9 / `open_view_id` 10 / `navigate` 11 | ID, title/subtitle, keywords, icon, shortcut, deep link |
| React `ComponentKit.ActionBar` | Runtime callbacks supplied by the host adapter | Layout, disabled state, pending/error feedback, callback identity |

The canonical action must not erase palette search metadata, row predicates,
refresh policy, or panel payloads to make the union smaller. Presentation must
not decide authorization. A command named “List” can still be a user-triggered
mutation-tier invocation; a danger tone cannot grant or revoke permission.

## Canonical shape

Extend the existing `meridian.ui.v1.Affordance`, retaining its full name and all
existing fields/tags. Do not replace old oneof arms with a differently numbered
wrapper. The target shape is:

```text
Affordance
  id, label, description, icon
  optional Tone tone
  optional Emphasis emphasis
  placement
  enabled_when
  optional refresh_on_success
  invoke: oneof(rpc | navigate | open_panel | open_view | command | uri | copy)
```

This is a shape diagram, not a compilable replacement proto. #47 must allocate
unused tags from the actual descriptors and assert them in compatibility tests.
Existing `uri = 5`, `command = 6`, and `style = 7` remain untouched.
The additive presentation fields now occupy optional `tone = 8` and
`emphasis = 9`; future invocation work must not reuse those tags. This does not
implement or approve the full invocation union or declaration-file migration.
New RPC targets carry the existing `RpcCall`, including bindings; `navigate` carries
the existing route semantics; `open_panel` carries a typed `PanelDescriptor`;
`open_view` identifies a host-resolved view; `copy` carries literal text, not a
shell command or a synthesized URI. Empty copy text is a valid payload.

`Command` remains a search/menu envelope. It gains the canonical affordance
alongside its legacy action, retaining keywords, shortcut, and deep-link
metadata. Groups and filtering are not invocation types. Likewise, table row
and view action collections gain additive canonical entries rather than
changing an existing repeated field's element type in place. `ActionPanel`
continues to wrap an Affordance; no duplicate “unified action panel” is needed.

### Tone, emphasis, and placement

- Tone uses the existing six-role `Tone` enum. Explicit neutral is meaningful;
  it must not be mistaken for absence or replaced by a legacy danger hint.
- Emphasis initially models the existing primary/secondary prominence, plus
  unspecified. It does not encode danger, running state, permission, or layout.
- Placement preserves existing row/header/overflow locations. Legacy
  `ActionPlacement.PRIMARY` mixes placement and emphasis; retain it as a
  compatibility alias for the old primary-action region. Do not silently move
  an old primary action to a different region. New producers express location
  separately from primary emphasis.
- Optional scalar presence distinguishes an absent new field (use the legacy
  adapter) from an explicit new declaration. Explicit unspecified selects the
  surface default; it does not resurrect legacy prominence. Unknown enum values
  degrade to the surface default, never permission or automatic execution.

An action's operational state belongs to runtime execution: available, disabled,
pending, denied, failed, or completed. Tone does not replace those states.

## Typed schema dependency plan

The [tested migration proposal](AFFORDANCE_MIGRATION.md) now recomputes the
current prospective graph, exercises old import facades in both protobuf-es
generation modes, and records the separate approval required for cutover.
Its nine-file boundary supersedes the preliminary seven-file sketch below;
production declaration ownership and the FILE policy remain unchanged.

The union cannot be implemented by adding imports to `affordance.proto` alone.
Today `command_palette.proto` imports `panel.proto`, which imports
`affordance.proto` and several messages that themselves contain Affordances.
`view.proto` also imports `panel.proto`. Adding the two imports to reuse the
typed targets/placement creates this strongly connected file component:

```text
affordance -> command_palette -> panel -> affordance
affordance -> view -> panel
panel -> catalog / connect_flow / steps -> affordance
```

Candidate, not an approved additive migration: co-locate the mutually recursive
message definitions in one canonical proto compilation unit, with leaf types
kept separate where possible.
Recompute the component after adding table/form adoption edges; the seven-file
baseline is not proof that the future graph is complete. Preserve package/full
message names, field tags, oneof membership, and enum numbers. Keep old proto
paths as public-import compatibility facades, not duplicate message definitions.

Generated language/module compatibility needs explicit work, not an assumption
that `import public` preserves every API. Keep old TypeScript module exports via
the existing generation/package pipeline; test Java descriptor-holder accessors,
Rust module paths, Bazel labels, and descriptor consumers. Moving declarations
changes file-descriptor metadata even when message wire bytes stay compatible.
Inventory those consumers before choosing the final compilation-unit boundary.

### Compatibility probe: public imports are insufficient

A minimal before/after generator probe moved two messages, with their full names,
fields, and tags unchanged, into a shared `interaction.proto`. The old files
remained as `import public` facades. This is analogous to the proposed cycle
refactor, not evidence that the complete production graph has been solved.

- The repository's pinned protobuf-es 2.12.1 generator emitted only the old
  file descriptor from the facade module, not the moved message type or schema
  exports. The old-path TypeScript consumer compiled before the move and failed
  afterward with TS2305 for both exports. Explicit tested compatibility exports
  are necessary in both the Bazel and development generation/package paths.
- The unchanged `buf breaking` `FILE` policy rejected both moved messages as
  deleted from their original files. Preserving wire names and tags does not
  satisfy this policy; a successful wire round trip cannot substitute for it.
- An exploratory Java generation with protoc 36.1 retained the public message
  class name but changed its descriptor-holder reference to the new file's
  holder. This was a generated-source inspection, not a compiled Java consumer
  or proof of compatibility with every shipped Java toolchain.

Therefore, public-import facades alone are not an additive compatibility plan.
The compilation-unit boundary and any v1 descriptor-file migration require an
explicit consumer inventory and reviewed migration contract before production
declarations move. Keep the existing compatibility gate in force; do not switch
it to wire-only checking or suppress its findings to make this proposal pass.
If descriptor file ownership must remain unchanged, revise the typed graph
design and demonstrate that alternative rather than silently using untyped
payloads or claiming this prerequisite complete.

Do not hide the cycle with JSON strings, untyped bytes, or a renderer-specific
DTO. A general `Any` panel payload would also weaken static target typing and
require a new type-URL security policy; it is not the default design. A tested
typed graph refactor is an explicit prerequisite to #47's full union.

## One host admission and dispatch seam

Every arm, from every surface, goes through the same host-owned invocation
entry point. Normalize old descriptors into canonical intent before admission;
renderers do not execute a second “legacy” path. The dispatcher selects a typed
capability after admission, not before. Normalization and rendering are pure:
mounting, hydration, previewing, filtering, and focusing never execute actions.

| Arm | Required policy and capability |
|---|---|
| `rpc` | Existing RpcCall mutation admission, then authenticated invoker |
| `navigate` / `uri` | Host destination/scheme policy, then router or opener |
| `open_panel` / `open_view` | Host target policy/resolver and supported renderer |
| `command` | Explicit host command capability and command policy; never implicit shell execution |
| `copy` | Explicit host clipboard capability/policy; raw literal payload |

This generalizes the existing admission seam; it must not pretend a URI is an
RPC with a dummy service/method. Keep `RpcAdmission` matching and its mutation
deny-by-default behavior intact. Non-RPC rules are host-authored too, not grants
in descriptor data. Missing capabilities and unknown invoke arms deny execution
with an actionable reason. No fallback to another arm, command, or clipboard is
allowed after denial. Offer a distinct copy action when copying is intended.

Callsite tier remains structural. All user-triggered `rpc` arms use mutation
admission, even if their method name resembles a read. Opening a panel does not
authorize its future RPCs: populate still uses read admission, while submit,
row actions, and LRO start independently require mutation admission. Recheck
at activation with the current descriptor, bindings, selection, and policy;
disabled paint is not a security boundary. Retry must not replay a stale target.

Use the canonical proto when an invocation/request/result or audit record is
serialized. Host callbacks and in-process execution state may remain runtime
types. Do not log clipboard text, command arguments, or bound secrets by default.

## Compatibility and migration

1. Inventory producers/consumers in both repositories, generated modules, and
   published registry clients. Snapshot full names/tags, old binary/JSON fixtures,
   and observed row-refresh behavior (the old bool has no presence despite a
   “default true” comment). Preserve observed legacy semantics in adapters.
2. Resolve the typed import graph and compatibility exports. Add fields and
   canonical siblings without removing old fields or changing their types.
3. Normalize each legacy source: Action.call to rpc with placement; RowAction
   to rpc with predicate/refresh; Command action to the same typed arm while
   preserving the search envelope; legacy Affordance uri/command unchanged.
4. A present canonical entry wins as a unit. Do not combine a new target with
   old bindings, permissions, or a different legacy action after denial. A
   missing target remains disabled. Presence, not a nonempty label, selects it.
5. Adopt the single dispatcher across table rows, view headers, palette,
   conversation blocks, forms, and ActionPanel in every advertised renderer.
   Keep old shapes deprecated throughout the 0.x compatibility window.
6. Before the 1.0 removal required by the roadmap, prove all first-party
   producers migrated, document external migration, and run old-reader/new-reader
   compatibility tests. Removed tags/names are reserved, never reused. If a
   removal prerequisite is unmet, report a v1 blocker rather than silently
   changing the compatibility requirement or declaring the API stable.

## Rendering and accessibility contract

Web destinations use links only after destination policy permits a usable href;
other actions use buttons. Denial is visible and announced, not a dead click.
Preserve label, icon fallback, accessible name, focus order, keyboard activation,
and pending/error feedback. A button's tone cannot be the only indication that
it is destructive, disabled, or denied. Prevent duplicate activation while an
invocation is pending; restore focus after a panel/dialog closes or fails.

TUI actions use the same semantic theme roles and host gate, with key hints and
visible denial text. Conversation/menu realizations preserve the action's label
and reason when a capability is unavailable; text is not evidence that execution
is supported. Programmatic handlers must use the gate too. Confirmation follows
host policy and does not grant an otherwise denied invocation.

## Required acceptance evidence

| Requirement | Evidence required before #47/#48 or v1 can close |
|---|---|
| Stable schema | Descriptor-driven tag/type/oneof/enum checks; old binary and proto-JSON fixtures; generated-language/module compatibility |
| Typed targets | Acyclic proto graph and native/Bazel/browser builds, including recursive inline-panel cases |
| Lossless adapters | Every legacy source and all seven invoke arms; raw IDs, bindings, predicates, refresh, palette metadata, and empty copy text |
| Presence/precedence | Absent/new/legacy combinations; explicit neutral/unspecified; unknown enums/arms; conflicting canonical vs legacy targets |
| Admission | Allowed and denied cases for every arm in every modality; absent capabilities; no invocation on mount/filter/hydration; denial never falls back |
| Lifecycle | Current policy/selection/descriptor at activation; pending duplicate prevention; retry, failure, cancellation, focus return |
| Cross-surface realization | Table/header/palette/chat/form/ActionPanel tests through real host seams, semantic accessibility trees or native cells, and callable handlers |
| Release migration | Both repositories and public package/registry consumers inventoried; deprecation guide; removal/reservation checks and v1 API review |

Passing a schema test is not proof of host admission or renderer adoption.
Remaining design review must settle the compilation-unit boundary and each
generated compatibility facade before schema code moves. The runtime capability
API and non-RPC host policy must be reviewed alongside #47, not introduced as
an unguarded UI callback during #48.
