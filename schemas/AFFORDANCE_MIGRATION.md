# Proposal: versioned Affordance declaration migration

Status: tested proposal, **not approved for production cutover**.
Companion to [AFFORDANCE_RFC.md](AFFORDANCE_RFC.md), roadmap #47/#48.
The user authorized preparation of this proposal, not moving production
declarations, changing the compatibility baseline, or relaxing the FILE gate.

## Reproduce the experiment

```sh
pnpm install --frozen-lockfile
node schemas/tools/affordance_migration_probe.mjs
# Optional: retain generated sources/descriptors for native consumer experiments.
node schemas/tools/affordance_migration_probe.mjs --keep
# With the retained directory, pinned protoc 33.4, JDK 21 and protobuf-java
# 4.33.4, run tools/affordance_java_probe.py --help for compiled Java checks.
```

The probe builds temporary copies of the **current real schemas**, not just
two synthetic messages. It does not alter canonical protos, checked-in Rust
descriptors, production codegen, or published packages. Its scratch directory
is removed unless explicitly retained. CI runs it as a proposal self-test.
Expected compatibility rejection is tested as rejection, not relabeled as a
successful production migration.

## Proposed compilation-unit boundary

Reuse RpcCall, Navigate, PanelDescriptor, ActionPlacement, and RowFilter rather
than inventing untyped targets or duplicate DTOs. Add prospective graph edges
for the typed union, canonical palette entry, and table action adoption.
FormPanel already lives in panel.proto: canonical submit adoption there does
not require adding actions to FormField or making form.proto depend on Affordance.
Recompute the component if that design changes.

The current graph yields **nine files**, not the prior seven-file estimate:

```text
proto/interaction.proto
  <- affordance.proto, catalog.proto, command_palette.proto,
     connect_flow.proto, lro.proto, panel.proto, steps.proto,
     table.proto, view.proto
```

LRO belongs in the component because panel imports LRO, LRO imports table,
and table's proposed canonical actions depend on Affordance. Form primitives,
RPC bindings, value types, and other leaves stay separate. The test recomputes
this boundary and fails if it changes; it is not an exhaustive forever-fixed
list inferred from this document.

All original .proto paths remain public-import facades. Package/full names,
existing tags, types, oneof membership, enum numbers, presence, reserved ranges,
and declaration options remain unchanged. File ownership and file-level
descriptor identity **do change**. No facade can promise that a declaration's
descriptor still identifies its original file while also moving that declaration.

The isolated expanded candidate tests these additional invoke tags:

| Proposed field | Tag | Payload |
|---|---|---|
| rpc | 10 | existing RpcCall |
| navigate | 11 | existing Navigate |
| open_panel | 12 | typed PanelDescriptor |
| open_view | 13 | host-resolved view ID string |
| copy | 14 | literal string, including empty |

Existing uri=5, command=6, style=7, optional tone=8 and emphasis=9 are untouched.
These allocations are **proposal candidates**, not production reservations.
Placement, predicate, optional refresh, and canonical collection/submit siblings
still require descriptor-driven tag allocation and full adoption tests in #47.
Do not claim the candidate implements those adapters or host admission.

## Evidence and limits

The reproducible probe verifies:

- All 213 existing message/enum declarations, including nested declarations,
  retain their contents under pure relocation. The expanded candidate changes
  only Affordance's five proposed fields; old field descriptors/options remain
  byte-identical.
- All 24 panel fixtures retain identical canonical wire and proto-JSON output.
  All seven invoke arms, including raw command text, typed recursive inline
  panels, RPC bindings, and empty copy text, round-trip through the candidate.
  Old binary readers preserve unknown new arms; **old JSON readers are not an
  unknown-field preservation channel**.
- Both pinned protobuf-es 2.12.1 generation modes, JS+declarations and TypeScript,
  fail old imports without explicit facades (TS2305). Generated facade
  re-exports restore all 90 named exports per mode (180 checks across two modes),
  old runtime export sets/schema identities, and typed old-path consumers.
  A negative assignment checks that the facade has not erased Affordance to any.
  Compiler settings match the existing generated package, including its
  dependency-only skipLibCheck; this is not a detached TS 5.7 consumer-package
  test or proof that the Bazel facade action has already been integrated.
- The **unchanged FILE policy rejects both pure relocation and the expanded
  candidate**. The unchanged baseline passes against itself. No rule, finding,
  or production compatibility test is suppressed.

Local native audit against the expanded candidate: all **84 Rust core tests
pass** through the documented descriptor override. Current TUI compilation
correctly fails at content.rs:1009 (new invoke arms need handling) and :1291
(ActionPanel.action becomes boxed through the new recursive target graph).
Stable Rust module names alone are not source compatibility. Do not add a
wildcard that pretends unsupported actions execute, or remove the exhaustive
check. These consumers need deliberate typed dispatch/normalization changes.

The separate **pure-relocation descriptor passes all 238 Rust workspace tests**
(one preexisting ignored doc test remains ignored). Thus the observed boxing/
exhaustiveness failures belong to adding recursive invocation targets, not
merely changing the compilation-unit ownership. Both experiments use the
documented MERIDIAN_UIVIEW_DESCRIPTOR_SET override with separate Cargo build
artifacts; neither replaces the committed production descriptor.

## Consumer inventory and required facades

Audit baseline: public main 257490e663e1f938c2e75a9fa6f15474518ee5d3 and the
private integration revision 8859ef4dcfd6eca1f52e6819842274c58f937e3b.
A local search found 106 public TS/TSX
files importing affected old modules and four private TS/proto source files
using affected module/proto imports. These counts are a bounded source audit,
not an inventory of unknown third-party clients. Private source remains private.
Rerun this audit before cutover; generated/vendor directories and external
package consumers need separate checks.

| Surface | Required cutover proof |
|---|---|
| Raw proto consumers | Old import paths compile with public forwarding; full-name lookup and extension options preserved; exact ownership diff published |
| Development protobuf-es | Apply generated old-export facades after Buf JS+dts generation; compile old imports and runtime descriptors |
| Bazel protobuf-es/npm | Apply the same ownership-derived facade transform to target=ts before tsc; declare all outputs; build old Bazel labels and test detached packed artifacts |
| Cargo core/TUI | Keep meridian_uiview::proto and existing crate names; test pure relocation separately, adapt new boxing/enum arms intentionally, run full workspace and archive consumers |
| Bazel Rust/private producers | Keep aggregate proto/prost labels; compile private canonical imports and registry clients against the candidate, not a stale pinned descriptor |
| Java | Preserve public message classes and source-level holder entrypoints where possible; compile old consumers with the actual shipped toolchain/runtime; explicitly review descriptor-file/index identity changes |
| SwiftUI | Preserve MeridianProtos module and package-scoped generated type names; build the public foundation and recursive descriptors on macOS/iOS |
| Descriptor/registry consumers | Regenerate checked-in descriptor sets; compare package/name/tag identity and explicit ownership map; admit/hash new artifact revisions intentionally |

The probe proves the generator-mode facade strategy, not all rows of this
table. Production facade generation must derive old ownership/exports from the
frozen baseline FileDescriptorSet and pinned generator, not a second manually
maintained schema/export catalog. Update both generation paths together.

Compiled Java evidence now uses the repository's protoc 33.4, checksum-pinned
protobuf-java 4.33.4, and the available Homebrew JDK 21 without changing system
Java configuration. The consumer compiles once against old generated classes;
that same bytecode passes message/builder/wire checks against the old, purely
relocated, and expanded schemas. Its old descriptor-ownership assertions pass
only against the old classes and correctly fail in both migrated worlds:
Affordance's owner changes to interaction.proto, while the old AffordanceProto
holder has zero messages rather than two. The dedicated CI job repeats this
with JDK 21. This is bounded compiled-consumer proof, not an audit of unknown
external Java/JavaFX applications. Descriptor-holder methods returning old
file descriptors, positional message lists, dependency lists, and descriptor
object identity cannot silently be treated as equivalent to a new canonical file.
The newly built SwiftUI foundation is tracked separately in PR #152; this
proposal has not yet rerun its native package against the relocated descriptor.
Public registry/external consumers require an explicit migration notice.

## Exact proposed cutover policy — requires separate approval

1. **Now / 0.25.x:** keep production declarations and buf.yaml FILE policy
   unchanged. Merge only this proposal/probe under the standing green-CI
   authority. Maintain current wire/file/module compatibility assertions.
2. **Preparation:** complete every consumer row above, the full typed contract
   and single host dispatcher, both-repository producer inventory, old/new
   readers, malformed/unknown targets, admission/lifecycle tests, and legacy
   precedence/refresh behavior. Keep all full-union roadmap criteria open.
3. **Version boundary:** propose a coordinated 1.0.0-alpha.1 release line.
   Archive the final 0.x source revision, FileDescriptorSet and SHA-256,
   generated artifact revisions, affected full-name-to-file mapping, old
   imports, and consumer test results. Publish the intentional source and
   descriptor breaks in the migration guide before requesting approval.
4. **Approval checkpoint:** obtain explicit human approval for the exact
   nine-file ownership diff, version boundary, unavoidable descriptor/boxing
   API breaks, and **one-time v1 compatibility-baseline transition policy**.
   Preparing this proposal, choosing v1, or standing merge authority is not
   that approval. No release publication or deployment authority is implied.
5. **Gate mechanics must be reviewed, not hidden:** the present FILE comparison
   rejects the relocation, so the production migration cannot be merged under
   the present policy. A separately approved release-line baseline transition
   must retain/archive the original nonzero FILE report and validate the exact
   approved ownership diff; later v1 changes must use FILE against the approved
   v1 baseline. The maintained 0.x line continues comparing against its old
   baseline. Do not add broad ignores, switch to WIRE, report the old check as
   passing, bypass required checks, or change workflow/baseline selection now.
   If keeping the current baseline comparison unchanged is nonnegotiable,
   **reject this relocation design** and revisit the typed graph; do not land it.
6. **Only after approval and all required checks pass:** integrate the reviewed
   schema, facades, adapters, and consumer updates as a coordinated change;
   verify integrated-main/release-line CI before closing acceptance criteria.
   Keep deprecated producer shapes until their explicit removal criteria are
   met; reserve removed names/tags. Test archives and packages before any
   separately authorized publication. Retain the maintained 0.x release line
   for consumers that cannot cross the major boundary.

There is no authorized cutover in this PR. #47/#48, the FILE decision,
cross-language consumer acceptance, and release authorization remain open.
