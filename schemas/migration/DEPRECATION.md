# Affordance compatibility-field migration

Status: **unmerged implementation candidate**, not an activated production
schema, published SDK, or approved 1.0 removal. See the [cutover policy](../AFFORDANCE_MIGRATION.md#exact-proposed-cutover-policy--requires-separate-approval).

The nine old fields below now carry `deprecated = true` in the candidate.
They remain present with the same names, tags, types, and behavior during the
0.x compatibility window. Do not delete them, clear their data, or pretend that
descriptor deprecation alone migrates a producer or grants invocation authority.

| Retained field | Tag | Replacement |
|---|---:|---|
| `Affordance.style` | 7 | `Affordance.emphasis`; keep `tone` independent |
| `Command.rpc` | 8 | `Command.affordance.rpc` |
| `Command.open_panel` | 9 | `Command.affordance.open_panel`, carrying the actual panel rather than the old wrapper |
| `Command.open_view_id` | 10 | `Command.affordance.open_view` |
| `Command.navigate` | 11 | `Command.affordance.navigate` |
| `FormPanel.submit` | 3 | `FormPanel.submit_affordance.rpc` |
| `TablePanel.actions` | 6 | `TablePanel.affordances.items` |
| `ViewDescriptor.actions` | 8 | `ViewDescriptor.affordances.items` |
| `Slot.actions` | 7 | `Slot.affordances.items` |

The canonical invocation is a typed oneof: URI, command, RPC, navigation,
inline panel, view ID, or copy. Use actual protobuf messages, preserving raw
targets, RPC bindings, empty strings, subject context, placement, predicates,
and authored refresh policy. Keep palette search/shortcut/deep-link metadata on
the Command envelope. Read/populate calls are not form submits and must not be
rewritten into mutations as part of this migration.

## Producers and hosts

1. Migrate explicit old RPC or palette targets into the matching typed arm.
   Map the old primary placement to both its region and primary emphasis, not
   a danger/success tone. Old row adapters preserve the observed always-refresh
   behavior; canonical `refresh_on_success: false` is authoritative.
2. An old no-call Action ID is a host semantic key, **not a destination**. Supply
   an explicit real route/panel/view mapping and any required confirmation.
   A pure host resolver may return typed intent, but must not execute an old
   callback. Delete confirmation must not become a direct header mutation.
3. Canonical presence wins as a whole, including an explicit empty collection
   or empty invocation. Never merge a new target with legacy bindings, retry an
   old callback after denial, or turn a failed command into clipboard copy.
4. Install the required host capability and admission policy for every target.
   Renderer widgets and normalization grant no permission. Resolve and recheck
   against current subject/row/form/selection/identity context at activation;
   late completion must not refresh a replacement view. Denial remains visible.
5. Version-gate delivery to old hosts. Old binary readers preserving unknown
   bytes does not make them honor canonical precedence or an empty override.
   Old tolerant JSON readers can discard canonical intent. Do not dual-write
   inequivalent targets/policy to unupgraded consumers or claim old JSON is an
   unknown-field preservation channel. A tested compatibility adapter is not a
   replacement for verifying the installed candidate SDK artifacts.

## Generated-language consequences

Deprecation is real descriptor metadata, not just documentation. Pinned prost
emits deprecated Rust fields, so warnings-as-errors correctly catch new direct
uses. Native production readers use `meridian_uiview::legacy` for five borrowed
0.x field reads and one ownership-taking submit accessor. This tiny module performs no normalization,
allocation, target inference, or invocation. Canonical selection remains in the
existing adapter. The real WASM submission builder selects canonical submit
presence first: empty/non-RPC intents cannot revive the old call. Exact
old-contract test fixtures explicitly allow their
intentional deprecated uses; unrelated code keeps strict warnings.

TypeScript keeps typed old exports/facades and generated deprecation metadata.
Java and Swift consumers must recompile/review with their pinned generators;
the declaration-file ownership and recursive boxing changes described in the
main migration guide remain separate source-compatibility concerns. No warning
annotation promises unchanged descriptor-file identity or authorization.

## Evidence and removal prerequisites

The canonical descriptor guard allows only these nine deprecation bits to be
added to retained old declarations. It still compares every other field,
option/unknown extension, tag, type, oneof, and declaration exactly; tests reject
an unrelated deprecated label and a second changed option on an allowed field.
The actual committed Cargo descriptor must contain every marker. Frozen 0.x
and v1-candidate references and production `buf.yaml` are unchanged: maintained
FILE still rejects relocation, and the explicit candidate comparison is only
preparation. No check is relabeled as production success.

Before the roadmap's **1.0 removal**, prove all first-party producers/hosts use
canonical targets (including semantic headers and confirmation), notify external
consumers, test installed/versioned artifacts and old/new readers, and obtain
the exact cutover approval. Remove obsolete envelopes/types only after that
proof, reserve every removed field name and tag, and verify generated API and
descriptor effects in every maintained language. The legacy read module and
dual-write paths must then be removed deliberately, not carried forward as an
undocumented exception. These prerequisites remain open; deprecation does not
close renderer adoption, removal, release, or automation requirements.
