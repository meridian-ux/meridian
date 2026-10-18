# Proposal: versioned Affordance declaration migration

Status: migration implementation PRs authorized; **not approved for production cutover**.
Companion to [AFFORDANCE_RFC.md](AFFORDANCE_RFC.md), roadmap #47/#48.
The user has now authorized coordinated implementation PRs, explicit versioned
FILE-transition preparation, and public/private consumer upgrades. Final production
cutover remains separately approval-gated. No main-branch declaration move,
baseline activation, release publication, or FILE relaxation is authorized here.

## Canonical implementation candidate (unmerged)

The candidate now explicitly marks nine retained invocation/presentation fields
deprecated; the [field-by-field migration guide](migration/DEPRECATION.md) lists
exact tags, replacements, warning implications, and mandatory 1.0 removal
prerequisites. This narrowly tested metadata addition is not removal or production
activation. All other old declaration options stay exact. Older proposal-only
measurements below describe their original proof boundary, not completion of
today's producer/host/removal work.

The candidate relocates the nine compilation units into `proto/interaction.proto`,
retains public-import facades and generated TypeScript module exports, and adds
the typed invocation/presence fields below. Cargo's committed image is regenerated
from actual Bazel dependency outputs, validated for conflicts/missing dependencies,
and ordered dependency-first. Native passive projections handle all seven invoke
arms without executing them or displaying clipboard payloads. These checks do
not establish canonical activation-policy adoption by every renderer.

The production FILE policy remains unchanged. The actual full-module candidate
passes the explicit frozen `v1-candidate` comparison while maintained 0.x rejects
the 45 ownership moves. The explicit `--canonical` harness now compiles the real
source image and compares it with the frozen full-module old reader. It retains
all fixture, typed invocation, policy/envelope presence, both generator modes,
and FILE-rejection assertions. The canonical Rust phase requires full workspace
success, not an expected compiler error. The coordinated Swift preview candidate
now explicitly dispatches all seven arms through installed host capabilities,
separates read/mutation RPC admission, and uses shared bounded Rust predicates.
Its canonical phase requires successful package tests, not the historical
exhaustive-switch failure. This does not promote SwiftUI coverage or prove
canonical collection normalization/refresh and every cross-surface lifecycle.
Other renderer dispatch, producer upgrades, and
final production cutover remain outstanding. Keep this candidate unmerged until
those requirements and separate cutover approval are satisfied.

The first implementation foundation shares `tools/proto_facades.mjs` between
`pnpm codegen` and the Bazel protobuf-es action. Its frozen pre-v1 descriptor is
documented in [compat/README.md](compat/README.md). The real nine-file probe now
uses this compiler-backed transform in both generator modes, rather than a
probe-local export rewrite. On maintained main, generation remains a byte-identical
zero-facade path. The unmerged candidate exercises relocated Bazel/package/native
paths; this foundation does not activate its release line.

## Reproduce the experiment

The adopted SDK now names canonical fields that do not exist in old bindings.
The consumer probe therefore compiles current first-party source against the
actual candidate, and separately compiles the immutable pre-canonical
`migration/LegacyAffordanceConsumer.ts` unchanged against both frozen and actual
bindings in both generator modes. A digest guard rejects silent fixture edits
or replacement with a smaller smoke test. Its legacy Action/RowAction/Command,
view/slot/table/form, URI/command and optional presentation fields remain typed;
negative assignments reject any-erased facades. The 180 export checks, binary
and JSON fixtures, exact declaration guards and nonzero maintained FILE reports
remain required. This is a bounded frozen old-source sample, not proof that every
external client has migrated or that new SDK source compiles against missing APIs.

The shared normalization candidate selects present canonical messages as whole
units, including explicit-empty collections/intents. It never invents a URI,
view ID or command from a no-call Action ID; the original Action remains an
in-process semantic-resolution candidate for activation, not execution during
rendering. Legacy RowActions preserve predicates, placement and the browser
renderers' observed always-refresh behavior, even when the old non-presence bool
is false. Canonical refresh false stays false. Palette metadata stays on the
original Command envelope. These pure projections are not yet renderer wiring,
semantic resolution/confirmation, permission checks, or refresh execution.

```sh
pnpm install --frozen-lockfile
node schemas/tools/affordance_migration_probe.mjs --canonical
# Includes the complete probe above, then baseline/candidate compilation of six
# real public TS projects. Preserves their checking options; never emits files.
node schemas/tools/affordance_consumer_probe.mjs
# Optional local/private context only; keep private diagnostics out of public CI.
node schemas/tools/affordance_consumer_probe.mjs --config=/path/to/private/tsconfig.json
# Optional: retain generated sources/descriptors for native consumer experiments.
node schemas/tools/affordance_migration_probe.mjs --canonical --keep
# With the retained directory, pinned protoc 33.4, JDK 21 and protobuf-java
# 4.33.4, run tools/affordance_java_probe.py --help for compiled Java checks.
# With that directory, require complete tests of the actual Rust candidate:
python3 -u tools/affordance_rust_probe.py --canonical --scratch /path/from/probe/work
```

The canonical phase builds the **current real full-module schemas**, not just
two synthetic messages, and compares them with the frozen pre-v1 reference.
The original hypothetical-relocation experiment remains available on the
maintained source layout without `--canonical`; it is historical, not the
implementation candidate's acceptance command. Neither phase alters canonical protos, checked-in Rust
descriptors, production codegen, or published packages. Its scratch directory
is removed unless explicitly retained. CI selects the canonical phase explicitly.
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
and declaration options remain unchanged under pure relocation. The later
deprecation candidate changes only the nine documented field option bits; all
other declaration options remain exact. File ownership and file-level
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
The isolated candidate additionally proposes:

| Message | Proposed field | Tag | Payload/presence |
|---|---|---|---|
| Affordance | placement | 15 | optional existing ActionPlacement |
| Affordance | enabled_when | 16 | existing RowFilter |
| Affordance | refresh_on_success | 17 | optional bool |
| Command | affordance | 12 | singular Affordance |
| ViewDescriptor | affordances | 10 | singular AffordanceCollection |
| Slot | affordances | 13 | singular AffordanceCollection |
| TablePanel | affordances | 8 | singular AffordanceCollection |
| FormPanel | submit_affordance | 6 | singular Affordance |

`AffordanceCollection` is a new candidate message in interaction.proto, with
`repeated Affordance items = 1`. A message-valued collection distinguishes absent
(legacy adaptation) from explicitly empty (no legacy revival). Direct repeated
siblings cannot express that distinction. This is a proposal for review, not an
approved producer/host contract. Existing Action/RowAction/Command fields remain
present with their original names, tags, and types; the nine documented field
options add explicit deprecation. Final removal, semantic-header mappings, and
integrated release-line adoption remain outstanding.

The probe rejects occupied/reserved names and tags against current descriptors,
checks exact added types/labels/oneofs and optional presence, and verifies all
old declaration contents after removing only the specified candidate additions.
The SCC remains nine files. No production reservation or field is introduced.
Do not claim the candidate implements normalization, precedence enforcement,
dispatch, host admission, or renderer adoption.

## Historical proposal evidence and limits

Current canonical-phase measurement: **228 frozen declarations / 229 candidate
declarations**, including conformance DTOs in the full module, 24 panel fixtures,
seven invocation arms, 84 policy cases, 18 envelope cases, and 180 generated
export checks. All six public source projects compile against frozen and actual
candidate facades. The isolated canonical Rust workspace passes 308 tests with
one preexisting ignored doctest. These checks do not establish host-dispatch
adoption or approve production cutover. The narrower proposal measurements and
expected native failures below are retained as historical evidence, not current
canonical acceptance results.

The reproducible probe verifies:

- All 216 current message/enum declarations, including nested declarations,
  retain their contents under pure relocation. The expanded candidate adds the
  specified invoke/policy/envelope fields and one collection message (217 total);
  old fields, options, enums, and oneofs remain byte-identical. The count is
  measured from current descriptors, not treated as a forever-fixed baseline.
- All 24 panel fixtures retain identical canonical wire and proto-JSON output.
  All seven invoke arms, including raw command text, typed recursive inline
  panels, RPC bindings, and empty copy text, round-trip through the candidate.
  Old binary readers preserve unknown new arms; **old JSON readers are not an
  unknown-field preservation channel**.
- 84 invocation/policy combinations preserve absent/explicit-unspecified/unknown
  placement, absent/false/true refresh, explicit neutral tone/emphasis, predicates,
  raw RPC bindings, and empty copy text through an old binary reader and back.
  Unknown wire fields may reorder; recovered typed messages and canonical
  re-encoding match. Raw field order is not an additional compatibility promise.
- 18 view/slot/table/form/command envelope cases preserve absent versus explicit
  empty canonical messages and populated collections, alongside legacy bindings,
  predicates, refresh, and all palette search metadata. Both old binary and old
  JSON decoders still expose the legacy fields. **An old host cannot honor a new
  empty override or canonical precedence merely because bytes are preserved.**
  Conflicting dual-written targets, canonical tombstones, and new policy require
  upgraded-host/version gating or separately proven equivalent legacy targets.
  No execution-equivalence or denial guarantee for old hosts is claimed here.
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

Historical invoke-only native audit, before the policy/envelope additions:
all **84 Rust core tests pass** through the documented descriptor override. TUI compilation in that audit
correctly fails at content.rs:1009 (new invoke arms need handling) and :1291
(ActionPanel.action becomes boxed through the new recursive target graph).
Stable Rust module names alone are not source compatibility. Do not add a
wildcard that pretends unsupported actions execute, or remove the exhaustive
check. These consumers need deliberate typed dispatch/normalization changes.

That audit's separate **pure-relocation descriptor passed 238 Rust workspace tests**
(one preexisting ignored doc test remains ignored). Thus the observed boxing/
exhaustiveness failures belong to adding recursive invocation targets, not
merely changing the compilation-unit ownership. Both experiments use the
documented MERIDIAN_UIVIEW_DESCRIPTOR_SET override with separate Cargo build
artifacts; neither replaces the committed production descriptor.
These historical counts are not fresh native verification of the current
policy/envelope candidate. Rerun and adopt the current candidate before cutover.

The reproducible `tools/affordance_rust_probe.py` now runs the real locked Cargo
workspace tests against both the baseline and pure relocation, each in a fresh
isolated target directory. It then checks the expanded candidate's core library
and requires the known E0004 exhaustive-dispatch error in `static_view.rs`.
Arbitrary compiler errors, dependency/network failures, killed or incomplete
builds, and unexpected candidate success fail the probe instead of being counted
as adoption evidence. The classifier has separate unit tests. A read-only CI job
repeats this proposal-only experiment; it does not patch the native dispatcher,
regenerate committed descriptors, change FILE policy, or prove expanded native
adoption. Canonical proto, Cargo, descriptor, and Buf policy inputs are hashed
before and after the experiment. An expected rejection is a diagnosed release
blocker, not a successful migration or a v1 acceptance waiver.

The refreshed local run passes **305 workspace tests** against each of the old
and pure-relocation descriptors, with the same one preexisting ignored doctest.
The expanded candidate fails at the core library's exhaustive invoke match for
the five newly typed variants. That core compilation stops before expanded TUI
workspace tests can run; no expanded native execution or adoption is claimed.

## Consumer inventory and required facades

Refreshed audit: public main 2f5e3964e9695ebb2314c44bfeaa478f167f17f9,
public candidate 1b1e0873ebe26f204680ac20c2b3092d4cf2c8ea, and private main
8859ef4dcfd6eca1f52e6819842274c58f937e3b (confirmed against GitHub).
The direct-module query below finds 114 public main TS/TSX files and 122 candidate
files: chat 3, launchpad 7, MUI 38, shared React 41, web-components 24, schemas 9.
These include tests/harnesses, not only runtime producers. The private direct
TS/proto-import set remains four files; private source is not copied here.

```sh
git grep -l -E '/(affordance|catalog|command_palette|connect_flow|lro|panel|steps|table|view)_pb[.]' <revision> -- '*.ts' '*.tsx' ':(exclude)**/generated/**' ':(exclude)**/Generated/**' ':(exclude)**/gen/**'
```

This reproducible bounded query supersedes the older 106-file estimate. It does
not discover every reflective/dynamic/JSON producer, generated/vendor consumer,
or third-party client. Full producer migration and external inventory remain
required before cutover; import counts cannot establish them.

The real-consumer probe compiles six public projects with their existing strict
options, overriding only noEmit and the canonical proto package subpath alias:

| Project | Compiler root files | Baseline / candidate |
|---|---|---|
| schemas seam | 17 | pass / pass |
| web-components source | 25 | pass / pass |
| shared React source | 28 | pass / pass |
| MUI production source | 29 | pass / pass |
| chat source | 13 | pass / pass |
| launchpad source | 3 | pass / pass |

Each run asserts that isolated generated declarations were actually loaded;
compiler/configuration errors fail rather than skip a project. Original
dependency-only skipLibCheck settings are retained, not added as a workaround.
The local private playground project also passes baseline/candidate compilation
(11 compiler roots) without source copying or dependency changes. Public CI
requires the six public projects and retains the entire migration self-test;
it does not access private source or claim a private CI gate.

These checks use the JS+dts facade mode. The separate synthetic old-import probe
still tests both generator modes. Actual Bazel facade wiring, detached migrated
packages, native adoption, runtime precedence/admission, and first-party producer
cutover remain outstanding. Source compilation does not execute new targets.

| Surface | Required cutover proof |
|---|---|
| Raw proto consumers | Old import paths compile with public forwarding; full-name lookup and extension options preserved; exact ownership diff published |
| Development protobuf-es | Apply generated old-export facades after Buf JS+dts generation; compile old imports and runtime descriptors |
| Bazel protobuf-es/npm | Apply the same ownership-derived facade transform to target=ts before tsc; declare all outputs; build old Bazel labels and test detached packed artifacts |
| Cargo core/TUI | Keep meridian_uiview::proto and existing crate names; test pure relocation separately, adapt new boxing/enum arms intentionally, run full workspace and archive consumers |
| Bazel Rust/private producers | Keep aggregate proto/prost labels; compile private canonical imports and registry clients against the candidate, not a stale pinned descriptor |
| Java | Preserve public message classes and source-level holder entrypoints where possible; compile old consumers with the actual shipped toolchain/runtime; explicitly review descriptor-file/index identity changes |
| SwiftUI | Pure relocation passes all 13 macOS foundation tests; expanded union correctly requires host dispatch updates; test the final migrated implementation and recursive descriptors on macOS/iOS |
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
The SwiftUI foundation merged separately in PR #152. A copied isolated package
with the same pinned SwiftProtobuf 1.39.0 generator/runtime passes the current public
macOS test suite against pure relocation, including native view layout and host
policy checks. The expanded candidate correctly fails compilation at the
host's exhaustive invoke switch; handling new targets is required adoption
work, not an implicit capability grant. The Swift CI job repeats this
proposal-only check. Final migrated-host behavior and candidate iOS runtime
proof remain outstanding.
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
