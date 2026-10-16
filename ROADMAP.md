# Meridian roadmap

The initial scope: three tracks, four milestones, seventeen epics, sixty-three tasks — tracked as GitHub
issues in this repository and in `meridian-internal`, grouped by milestone. This file
is the narrative; the issues are the state. **Where the two disagree, the issues win.**

The roadmap exists to make three things true:

1. **Parity** — every renderer draws every shape the schema declares, or declares why not.
2. **One language** — every modality realizes the same small set of semantic interactive
   concepts, stated once in `schemas/proto` and never re-derived per renderer.
3. **Hardened** — what ships is tested to a floor, released from an honest lockfile,
   robust to untrusted producers, and complete in its published surface.

## Milestones

| milestone | due | epics |
|---|---|---|
| **M1 · Seam & truth** | 2026‑10‑31 | ~~[#4](../../issues/4) ComponentKit seam~~ · ~~[#5](../../issues/5) manifest completeness~~ · ~~[#14](../../issues/14) test floor~~ · ~~[#15](../../issues/15) release engineering~~ · ~~internal [#9](https://github.com/meridian-ux/meridian-internal/issues/9) orphaned tests~~ |
| **M2 · Parity closure** | 2026‑12‑31 | ~~[#6](../../issues/6) TUI~~ · ~~[#7](../../issues/7) web-components~~ · ~~[#8](../../issues/8) kits~~ · [#9](../../issues/9) conformance corpus · ~~internal [#11](https://github.com/meridian-ux/meridian-internal/issues/11) playground harness~~ |
| **M3 · One language** | 2027‑02‑28 | [#10](../../issues/10) Tone · [#11](../../issues/11) Affordance · [#12](../../issues/12) ValueDisplay · [#13](../../issues/13) theme + glossary |
| **M4 · Hardened 1.0** | 2027‑04‑30 | [#16](../../issues/16) publish surface · [#17](../../issues/17) untrusted producers · ~~internal [#10](https://github.com/meridian-ux/meridian-internal/issues/10) service contracts~~ |

M1 is ordered first because everything after it is cheaper once it lands: the seam
unblocks eight cells at once, the manifest becomes something CI can enforce rather
than a document, and the test floor means parity work lands with proof.

## Track A — Renderer parity

The source of truth for panel parity is [`schemas/conformance/coverage.json`](schemas/conformance/coverage.json),
gated by [`schemas/tools/check_coverage.mjs`](schemas/tools/check_coverage.mjs). The wider
renderer inventory is [`schemas/conformance/renderer_catalog.json`](schemas/conformance/renderer_catalog.json),
gated by [`schemas/tools/check_renderer_catalog.mjs`](schemas/tools/check_renderer_catalog.mjs).
The table below is **generated** from the coverage manifest by
`tools/roadmap_matrix.py --write`; CI verifies the committed projection with
`tools/roadmap_matrix.py --check`.

<!-- matrix:start -->
| arm | parity | web-components | web-react | mui-kit | html-kit | shadcn-kit | tui | swiftui |
|---|---|---|---|---|---|---|---|---|
| `table` | standard | ● | ● | ● | ● | ● | ● | ? |
| `lro` | standard | ● | ● | ● | ● | ● | ● | ? |
| `adhoc` | standard | ● | ● | – | – | – | ◐ | ? |
| `prompt` | standard | ● | ● | ● | ● | ● | ● | ? |
| `llm_prompt` | standard | ● | ● | ● | ● | ● | ● | ? |
| `gallery` | standard | ● | ● | ● | ● | ● | ● | ? |
| `form` | standard | ● | ● | ● | ● | ● | ● | ? |
| `choice` | full | ● | ● | ● | ● | ● | ● | ? |
| `snippet` | full | ● | ● | ● | ● | ● | ● | ? |
| `action` | full | ● | ● | ● | ● | ● | ● | ? |
| `connect_flow` | full | ● | ● | ● | ● | ● | ● | ? |
| `copy_value` | full | ● | ● | ● | ● | ● | ● | ? |
| `catalog` | full | ● | ● | ● | ● | ● | ● | ? |
| `terminal` | specialized | ● | – | – | – | – | ◐ | ? |
| `grammar` | specialized | ● | ● | ● | ● | ● | ● | ? |
| `stat` | full | ● | ● | ● | ● | ● | ● | ? |
| `detail_header` | standard | ● | ● | ● | ● | ● | ● | ? |
| `record_card` | standard | ● | ● | ● | ● | ● | ● | ? |
| `resource_cards` | standard | ● | ● | ● | ● | ● | ● | ? |
| `chart` | specialized | ● | ● | ● | ● | ● | ● | ? |
| `steps` | full | ● | ● | ● | ● | ● | ● | ? |
| `media` | specialized | ● | ● | ● | ● | ● | ● | ? |
| `stream` | full | ● | ● | ● | ● | ● | ● | ? |

**23 arms × 7 renderers = 161 cells; 129 marked renders, 9 other declared states, 23 unverified.**

| status | cells |
|---|---|
| ? `unverified` | 23 |
| – `not-applicable` | 7 |
| ◐ `placeholder` | 2 |

| renderer | cells not marked renders |
|---|---|
| web-components | 0 |
| web-react | 1 |
| mui-kit | 2 |
| html-kit | 2 |
| shadcn-kit | 2 |
| tui | 2 |
| swiftui | 23 |

### Conversation modality

| arm | chat-html | chat-react | playground |
|---|---|---|---|
| `markdown` | ● | ● | ● |
| `context` | ● | ● | ● |
| `tool` | ● | ● | ● |
| `list` | ● | ● | ● |
| `fields` | ● | ● | ● |
| `code` | ● | ● | ● |
| `divider` | ● | ● | ● |
| `table` | ● | ● | ● |
| `view` | – | ◑ | ◑ |

**9 arms × 3 renderers = 27 cells; 24 render, 3 do not.**

### Launchpad modality

| arm | launchpad |
|---|---|
| `rpc` | ● |
| `open_panel` | ● |
| `open_view_id` | ● |
| `navigate` | ● |

**4 arms × 1 renderer = 4 cells; 4 render, 0 do not.**
<!-- matrix:end -->

Legend: ● renders · ◐ placeholder · ◑ separate entrypoint · ○ missing · ✕ structural gap · ? unverified · – not applicable.

Three facts shape the order of work:

- **The shared seam is now open.** `ComponentKit` (`packages/web-react/src/component_kit.ts`)
  exposes optional `Stream` and `Terminal` members. Semantic snapshots exposed
  the missing HTML/Shadcn `LlmPrompt` implementations; both now share typed
  parameter controls and local textual preview, with focused interaction tests.
  Omitted `Stream` and `Terminal` slots dispatch to the host kit's `Fallback`.
  Interactive Terminal support remains the web-components specialization:
  React kits preserve safe connection metadata but declare the four interactive
  PTY cells `not-applicable`, rather than counting that degradation as PTY parity.
  HTML, Shadcn, and MUI also share a protobuf-backed static stream transcript:
  hosts supply `StreamFrame` snapshots by panel ID through `streamSnapshots`.
  The kits retain the bounded tail, honor `line_field` and the byte ceiling,
  and preserve placeholder copy when no valid frames are available. This is
  the static degradation rung; live React subscriptions remain host-owned.
- **The remaining intentional parity gaps are bounded:** two TUI placeholders
  (adhoc and terminal), as permitted by the completed TUI epic. Prompt and
  LLM-prompt are now owned by `PanelView`, including typed response collection
  and local preview. Native LRO progress and finalized results are host-driven,
  with stale-safe runtime identities; rendering does not execute operation RPCs.
  The TUI terminal transport boundary remains documented in its degradation ladder.
  The TUI stream pane now subscribes through a host-owned `StreamInvoker`, keeps a
  bounded tail, and lets readers scroll back without losing their place as frames
  arrive. Its follow behavior is covered with `TestBackend`.
- **The renderer catalog is now complete at the tier level.** The panel matrix includes
  every catalog panel renderer, including SwiftUI. Its local preview cells are marked
  `unverified`, with explicit waivers on full-parity arms; conversation and launchpad
  retain their separate modality rows. Native preview verification remains
  explicit rather than being inferred from catalog completeness.

Declared is not proven. [#9](../../issues/9) builds the conformance corpus — fixtures per
arm, a normalizer per renderer, snapshots gated in CI — so `renders` becomes a property
CI checks rather than a word someone typed.

The first cross-kit crank slice is now live: the canonical protobuf fixture corpus
lives under `schemas/conformance/fixtures.ts` and is consumed by `web-react`,
`mui-kit`, and the web-components renderer. The same corpus is materialized as
protobuf wire fixtures under `schemas/conformance/binpb/` for the TUI, whose
headless `TestBackend` now decodes and renders every arm through its real dispatch
ladder. The browser renderers use kit-neutral `data-panel` and `data-panel-shape`
normalizers, while
web-components and TUI preserve their explicit degradation behavior. The
conformance slice also has a byte-integrity test in the web package, so CI fails
if the checked-in native fixtures drift from the canonical TypeScript messages;
the CI corpus gate also rejects missing or stale files against the coverage arm
set. All four browser realizations now commit semantic DOM snapshots for the
24 canonical initial-state fixtures, preserving text, controls, link targets,
media alternatives, and authored accessibility state. `check_coverage` requires
every browser arm's golden, and the conformance suites verify its contents.
The shared stateful corpus now adds 427 canonical `ViewDescriptor` cases under
`schemas/conformance/fixtures/`: empty/typical/overflow cases for all 23 arms,
plus all 29 formatter cases through each of five unrestricted read surfaces:
tables, record cards, header rows, galleries, and resource cards. It also includes
26 string-only cases each for CopyValue/ConnectFlow and 26 numeric Stat cases,
without coercing their canonical payload types. A canonical protobuf Struct
index adds 27 typed input/default cases through Form, Prompt, LRO, and LLM-prompt,
plus read-only Form: 135 additional views covering every declared ValueType,
unknown/invalid declarations, all nine input kinds, raw false/zero/empty values,
multiline and leading-zero strings, and masked-value concealment.
Each view and its protobuf
`Struct` response companion has binary and readable text twins. HTML, Shadcn,
MUI, and web-components consume these exact wires and compare 1,708 semantic DOM goldens, with explicit
checks for fetched content, formatter results, and bounded stream tails.
The web-components suite loads the actual compiled WASM bridge; its stream cases
pin the documented plain-DOM fallback, and terminal sockets are test transports,
not live PTY proof. The snapshot gate and shared Bazel-aware re-record path include these cases.
Native TUI `PanelView` also decodes these views, extracts their one panel slot,
and renders shared responses through its actual transport seams. It compares
854 terminal-buffer goldens at 96×28 and 40×10, with explicit content, formatter,
stream-tail, and subscription-disposal assertions. This exposed and fixed
multiline table cells and headers losing all but their first line. It does not
establish a general native ViewDescriptor layout implementation. The expanded
corpus also fixed declared-null values being omitted in MUI header rows and
web-components card slots, and preserves multiline values in native paragraphs
instead of silently concatenating their words. The five unrestricted surfaces
are checked against the canonical descriptor set. Dedicated constrained cases
also fixed string-boolean coercion, native empty-string and ConnectFlow newline
inconsistencies, and missing Stat populate/display-override behavior. Stat fetch
lifecycle regressions guard stale responses, cache invalidation, and visible
errors. Input cases assert live raw values and exact collected requests/protobuf
responses before snapshot comparison; LLM-prompt previews stay local. LRO cases
prove typed start-input collection, not full polling/results across every kit.
Reference kits now have functional start forms; their full lifecycle, alongside
MUI's, remains outstanding.
Fixture provision ([#39](../../issues/39)) and the passing-snapshot gate
([#41](../../issues/41)) are now integrated and acceptance-audited. The generator
requires a complete, disjoint family for every value-bearing panel arm and every
declared ValueType, including input/default cases. Computed browser accessibility
proof covers all 427 cases across four browser realizations (1,708 trees).
The gate rejects unsupported `renders` promotions, requires committed goldens,
and CI explicitly executes the seven registered panel proof targets in addition
to its wildcard test suite. Presence alone is not proof of passing output.
The SwiftUI initial view-dump normalizer is now integrated in
[#156](../../pull/156), completing the normalizer infrastructure in
[#40](../../issues/40): 24 committed canonical panel projections, independent
presence/format gates, native runtime comparison, and shared Bazel recording.
Unsupported arms snapshot their current explanation, not completed rendering.
This is not field-complete parity: unsupported SwiftUI content, stateful native
proofs, general ViewDescriptor layout, renderer-specific overflow/layout, and
broader interactive surfaces remain in [#9](../../issues/9). See the
[conformance guide](schemas/conformance/README.md) for scope and update commands.
Bounded slices now cover canonical `resource_cards`, `gallery`, and `table`
descriptors with shared responses across HTML, Shadcn, MUI, web-components, and
TUI in focused populated-data tests, separately from the initial-state browser
snapshots. Long-copy text preservation, a shared formatter corpus covering all
18 semantic ValueTypes, populated Gallery/Table native text goldens, nested
Steps affordances across all renderers, playable Media chapter seek controls
across all browser renderers, populated Chart fallbacks across all browser
renderers plus native populated/empty/failure text goldens, bounded native
Stream snapshot retention, safe declared Table URL links across all browser
renderers, browser Affordance URI admission that preserves safe application
deep links while disabling executable/local-document schemes, matching MUI
and standalone Launchpad admission for authored command deep links and raw
navigate routes, shared Gallery href admission across all browser renderers,
MUI AppShell navigation admission for authored NavTree routes and host-resolved
panel/view destinations, shared Step frame source admission with text
degradation, and HTML/Shadcn ActionPanel/Form interaction contracts are also
checked in. Full Media sources,
posters, and caption tracks now share that passive-asset admission rule across
all browser renderers, degrading rejected primary sources to authored text and
dropping rejected auxiliary assets. Gallery image fields now use the same
passive-asset admission rule across all browser renderers, and host asset
resolvers run only for admitted sources. Gallery icon fields now use the host
glyph seam across browser renderers while retaining their authored key as
`data-icon` when no resolver is installed. MUI gallery grids and lightboxes now
realize authored action labels, preserve safe card destinations, and keep those
navigation values out of the asset-resolution seam. Theme font files now pass
through a dedicated font-source admission rule before the MUI kit emits
`@font-face` CSS;
HTTP(S), relative, and narrowly typed embedded fonts remain available while
active, local, opaque, and arbitrary data sources are omitted. Declarative
worker fetch effects now admit only relative or credential-free HTTP(S) targets
after interpolation, so untrusted action payloads cannot select active, local,
or credential-bearing schemes. These checks do not establish visual layout,
every formatter option, or full renderer parity.
Remaining work is the broader parity and renderer-specific/tooling scope called
out above.

## Track B — One language

The protos already carry a semantic vocabulary. The work is to say each concept **once**:

| concept | today it is spelled | distilled to |
|---|---|---|
| **Tone** — how serious, how it looks | shared `Tone` (6 roles) is defined; deprecated `ValueTone`, operational states, `AffordanceStyle`, and `Palette` consumers still retain their existing APIs | additive consumer adoption and precedence; `Palette` keyed by `Tone`; per-renderer theme proof — [#10](../../issues/10) |
| **Affordance** — what can I do here | `Affordance.invoke {uri, command}` · `Command.action {rpc, open_panel, open_view_id, navigate}` · `RowAction` · `ActionPanel` · kit `ActionBar` · `ActionPlacement` | one `Affordance {label, tone, emphasis, placement, invoke}` through one admission seam — [#11](../../issues/11) |
| **Value** — what is this, how does it read | `ValueDisplay` (18 `ValueType`s) on `DescriptorRow`, `FormField`, `TableColumn`, `StatPanel`, `CopyValue`, `MetaField`, `ResourceCardTemplate` slots, gallery `CardSpec` slots, `Conversation.Block.Field`, and `Conversation.Block.Table` cells | `display` on every value-bearing message, one formatter in `uiview-core` — [#12](../../issues/12) |
| **Rhythm & layout** | `Metrics` has radius/unit fields but no full spacing/density/stroke contract; four layout modes need a per-modality realization table; `RepeatedField.element` has scalar/object arms and `NestedForm` has fields | complete Metrics and Typography adoption; layout degradation ladders; cross-modality form validation and glossary audit — [#13](../../issues/13) |

The glossary is [`schemas/DESIGN_LANGUAGE.md`](schemas/DESIGN_LANGUAGE.md): every
current concept is mapped to its meaning, modality ladder, and theme roles while
the proto remains the source of truth.

The shared `Tone` definition and legacy deprecation ([#43](../../issues/43)) are
integrated without changing existing field types, wire numbers, or
`VALUE_TONE_*` JSON names. Consumer migration ([#44](../../issues/44)) and theme
conformance ([#45](../../issues/45)) remain open. The additive ValueDisplay schema
slots ([#49](../../issues/49)) are also integrated, with real-descriptor tests
for stable tags, unset wire/JSON behavior, and old-reader field preservation.
Neither schema milestone alone completes formatter consolidation. The browser
default now executes the same Rust core as native surfaces through a packaged,
synchronously initialized WASM module; duplicate JavaScript temporal, principal,
and numeric algorithms are removed. Legacy stat and table numeric labels also
delegate to core. Real HTML/Shadcn SSR hydration and detached, no-fetch Node
imports are tested in addition to fixed native/WASM expectations.
[#50](../../issues/50) is integrated; [#51](../../issues/51) remains open for the
complete input/options and modality audit. Calendar-day relative labels and
UTC day-only instant labels now have a fixed cross-mode/precision matrix;
matching fixtures or default adoption alone does not establish full acceptance.

The first `ValueDisplay` migration slice is now shared at the table, native
read-surface, and browser read-surface boundaries: `meridian-uiview` honors a
declared display before legacy `ColumnFormat`, including deterministic date and
date-time labels; the TUI detail-header and record-card consumers use that same
semantic formatter; and the web-components renderer plus all three browser kits
consume the framework-neutral browser formatter. The dependency-free HTML and
shadcn kits now fetch and realize populated detail values as well. Descriptors
without `ValueDisplay` retain their existing output. Browser relative temporal
labels now share a hydration-safe display instant across React kits, while
web-components use the current render instant; declared HTTP(S) URL values are
links across browser surfaces. Declared principal labels now honor name and email
modes across browser and native read surfaces using the compatible `Name <email>`
scalar form. Browser read surfaces also preserve email titles; native surfaces
degrade that mode to the visible name. Principal record links now use the
existing host route resolver when a target kind is declared. General
`ValueLink` declarations now reuse that same host-owned route seam for scalar
values across browser read surfaces. TUI tables, detail headers, and record cards
now show declared route intent as escaped, noninteractive record-kind/raw-ID
metadata. Explicit empty links suppress legacy principal decoration; absent or
invalid declarations preserve plain values. The TUI does not resolve routes or
grant navigation capability. `StatPanel.value_display` now shares the bounded
numeric `ValueDisplay` precision contract for current values and computed deltas;
legacy `format` remains the fallback for absent or nonnumeric declarations.
Declared fixed precision now rounds exact binary64 ties away from zero in both
shared formatters (12.5 at zero digits becomes 13, and -1.125 at two becomes
-1.13). Wire-decoded numeric, table, and stat cases cover ties, neighboring
values, negative zero, and the 100-digit limit; legacy column formatting is
unchanged. This follows the rounding rule in
[ECMAScript toFixed](https://tc39.es/ecma262/multipage/numbers-and-dates.html#sec-number.prototype.tofixed).
`CopyValue.display` now extends the same declared-value contract to standalone
and ConnectFlow copy surfaces: browsers and the TUI format the visible/revealed
text while copy actions retain the original scalar.
`Conversation.Block.Field.display` now extends the contract to streamed chat
field blocks: the vanilla and React chat tiers decode the proto3-JSON display
declaration at one boundary, while the TUI realizes temporal and principal
labels and preserves literal string semantics for unsupported or malformed
declarations. Chat fields intentionally do not coerce numeric/boolean strings
or invent navigation routes.
`Conversation.Block.Table` now has an additive per-cell display map: legacy
string cells remain the fallback, declared cells format in browser chat kits and
the TUI, and the raw wire value is preserved for actions and other consumers.
`FormField.display` now reaches the MUI and native TUI form
read surfaces: disabled MUI scalar controls render semantic text, edit controls
retain their raw input values, and TUI form summaries use the same core
formatter. HTML and Shadcn FormPanel now submit typed values through mutation
admission, prefill through the read invoker, preserve input on failures, and show
pending/saved/error states. Their read-only scalar defaults honor declared
displays; editable controls retain raw values. Web-components FormPanel now uses
the same read/mutation admission tiers, typed nested/repeated/map input, prefill
defaults, and visible save/retry states; its submit bindings use the WASM request
builder. HTML/Shadcn dynamic enum sources now load through the read-tier invoker,
preserve prefilled tokens, expose loading/failure states, and validate submitted
values against resolved options. Browser Form collection now delegates scalar
and compound constraints to the shared `validateFormValues` path. HTML/Shadcn
pass their trusted loaded enum registry, including nested and repeated input
paths; submitted DOM options cannot enlarge that registry. Web-components use
canonical static enum membership rather than trusting editable option markup.
Empty and duplicate object-field IDs are rejected before mutation, while scalar
list elements may remain anonymous. The selected v1 pattern contract now uses
Rust Unicode regex semantics in native and the embedded browser WASM core;
[FORM_PATTERNS.md](schemas/FORM_PATTERNS.md) documents unsupported browser-only
patterns and migration. Shared native/WASM fixtures pin this part of [#54](../../issues/54).
Broader interaction parity remains separate work.
The native one-shot `PromptPanel` path now accepts scalar `RepeatedField` values
as JSON arrays and string `KeyValueMapField` values as JSON objects. It validates
every array element against its declared scalar kind, enforces array and map item
constraints, and submits the validated raw JSON through the existing text value
boundary. Nested scalar arrays are supported; repeated object rows and top-level
nested forms still require a richer row editor and remain explicit pre-terminal
errors.
`ResourceCard.MetaField.display` now formats fetched card metadata across browser
kits, web-components, and TUI, reusing the existing safe URL and host-resolved
record-link seam; legacy scalar output is preserved when unset.
`ResourceCardTemplate` now applies the same formatter to title, subtitle, and
status slots across browser kits, web-components, and TUI, including supporting
titles for principal email labels while preserving the old scalar path when
those declarations are absent.
Gallery `CardSpec` now applies the same formatter to title, subtitle, and
status slots across the HTML, Shadcn, MUI, web-components, and TUI realizations. The image,
icon, href, and action slots remain scalar/navigation fields, and absent display
declarations preserve scalar labels. HTML and Shadcn reference kits now fetch
populated cards, including media alternatives, host-resolved icons, and href actions.
Richer non-browser realizations remain open.
Conversation list title/subtitle slots now share the field display contract in
chat HTML/React and TUI, with wire-roundtrip coverage and literal string fallback.
The shared formatter corpus now has 355 fixed-expectation cases, including a
no-clock twin for all 133 explicit-clock cases. Native and actual WASM checks
independently verify absolute temporal fallback and preserved principal titles;
all 48 temporal mode/precision combinations and eight principal modes are covered.
These formatter-boundary cases do not replace per-renderer option propagation
or the outstanding SwiftUI semantic conformance evidence.

The local SwiftUI package now calls that same Rust kernel through a bounded
protobuf C ABI in a statically linked macOS/iOS XCFramework. Its native tests
execute all 355 formatter cases and the 16 shared Rust Unicode regex cases.
CopyValue adopts declared formatting while preserving literal copy, absent
declaration behavior, and hidden-secret masking. These are kernel/consumer
proofs, not full SwiftUI panel parity. The separate initial view-dump verifier
now checks actual SwiftUI text, control labels/disabled state, picker selection,
image names, and declared labels. It does not claim computed OS accessibility
or close the remaining stateful/composed-view conformance work.

## Track C — Hardening

Request assembly now uses a fallible shared Rust boundary policy for native,
WASM, and TUI calls: 64 KiB encoded RPC declarations, depth 64, and 4 MiB of
cumulative value/path copy work, including overwritten and nested bindings.
Borrowed row/form overrides are checked before copying; TUI automatic form
fields continue the binding budget rather than restarting it. Rejection makes
no RPC, subscription, form submission, or LRO start. Browser Stream no longer
falls back to an empty subscription request, and live grammar signals enter
the core context instead of mutating its output afterward.
This is not completion of [#17](../../issues/17): browser post-core automatic
form/LRO assembly, the separate React action builder, and pre-conversion host
context allocation still require their own boundary audit. The trusted Rust
`RequestBuilder::build` API remains compatible and is not the untrusted seam.

Baseline, 2026‑09‑11:

| package | tests | shipped as |
|---|---|---|
| `packages/mui-kit` | 124 | `@savvifi/meridian-mui-kit` 0.25.1 |
| `packages/web` | 82 | **private workspace** — CDN bundle only |
| `packages/web-react` | 72 | `@savvifi/meridian-web-react` 0.25.1 |
| `packages/chat` | 14 | `@savvifi/meridian-chat` 0.25.1 (5 versions) |
| `packages/launchpad` | 12 | `@savvifi/meridian-launchpad` 0.25.1 (5 versions) |
| `schemas` | 14 | `@savvifi/meridian-schemas` 0.25.1 |
| `crates/*` (cargo) | 79 | **no crate on crates.io** — Bazel registry / git only |

[#14](../../issues/14) sets a per-package floor that only rises; the current floor is
declared in [`schemas/conformance/test_floor.json`](schemas/conformance/test_floor.json)
and checked by [`schemas/tools/check_test_floor.mjs`](schemas/tools/check_test_floor.mjs).
CI compares the manifest against the pull request base (or previous `main`
revision) and rejects lower floors or removed suites. The WASM FFI floor counts
only its real boundary test file, independently of ordinary renderer tests.
Core, theme-proto, and TUI also have individual floors, so added tests in one
crate cannot hide removed tests in another.
These declaration counts complement test execution and coverage reports; they
do not establish a measured code-coverage threshold.
The native core and its real WASM bridge now share the protobuf-defined
[`core.json`](schemas/conformance/core.json) fixture corpus for paths, requests,
tables, galleries, metadata, and payload budgets; WASM also runs the native
formatter's complete `value_types.json` corpus through both table entrypoints.
Both implementations compare against the same committed expectations in CI.
[#15](../../issues/15) tracks release engineering. Its lockfile and strict
`bazel mod deps --lockfile_mode=error` gate are in place; the unused Bats toolchain
is stubbed; and the three Tectonic catalog targets are manual and built by a focused
workflow on relevant `main` changes and weekly. `HOME` is scoped to the Tectonic
config instead of entering unrelated action environments and cache keys. The publish workflow now repeats the parity,
catalog, test-floor, package-test, and Rust gates before any publish action. [#16](../../issues/16) decides the publish
surface and moves the registry admission ratchet into CI, where 0.25.0's regression
would have failed a pull request instead of a release. [#17](../../issues/17) treats
the descriptor boundary as untrusted, because the playground's own README says it is.

`meridian-internal` now runs all 43 formerly orphaned integration tests through
seven explicit Bazel targets, alongside the full pinned Cargo workspace/all-target
suite. Its merged [PR #23](https://github.com/meridian-ux/meridian-internal/pull/23)
also supplies deliberate Bazel-native golden recorders for both k8s and projector;
ordinary tests only compare committed expectations. Clean-runner CI provisions
the same pinned `protoc` version as Bazel instead of relying on a developer's PATH.
The service-contract epic
([#10](https://github.com/meridian-ux/meridian-internal/issues/10)) is complete:
the projector title is configurable through flag/env/Helm with a compatible
default; k8s tests pin absent launchpad together with standalone UNIMPLEMENTED;
both services test unary/watch AppShell behavior; and five build-definition
facades share one OCI and one descriptor implementation. Per-crate compiler,
image-layer, and archive guards preserve the existing build contract. Selected-site
watches reject unrelated updates, and the combined Cargo workspace and strict
all-targets Clippy pass. This does not imply production deployment or a v1 release.
The playground
harness epic ([#11](https://github.com/meridian-ux/meridian-internal/issues/11)) is
complete: its selectable canonical corpus and side-by-side HTML/Shadcn/MUI kits
are integrated, and all nine Block kinds pass through the real local host's
authenticated HTTP/SSE path into the production browser bundle. Committed computed
accessibility goldens cover each Block and the composed canvas for View.
The public manifest declares this private development consumer explicitly;
View remains `separate-entrypoint`, not an inline panel-renderer claim.

The reference web-components renderer now enforces the descriptor admission policy
at every RPC boundary: populate and stream calls are read-tier, while row/resource
actions and LRO starts are mutation-tier and default closed. Hosts can allow exact
service/methods through `MountOptions.admission`; denied actions remain visible with
the policy reason instead of reaching the invoker. The React kit now applies the
same boundary through `MeridianProvider`: view/resource/table actions, form submits,
LRO starts, and Launchpad `rpc` commands use the mutation tier, while automatic
populate/prefill calls remain read-tier. Browser `TerminalPanel` realizations now
admit only absolute, credential-free `ws://` and `wss://` broker URLs before any
WebSocket construction; rejected endpoints remain visible as inert diagnostics.
Declarative worker `fetch` effects now pass their fully interpolated target through
the shared HTTP request admission seam before network activity. Relative and
credential-free HTTP(S) targets remain available; active/local schemes, embedded
credentials, control characters, and malformed values follow the effect's existing
error transition without reaching `fetch`.

## Working the roadmap

- **Labels.** `track:parity` · `track:design-language` · `track:hardening` for the track;
  `renderer:*` for the surface; `seam:ComponentKit` and `proto` for the two kinds of
  change that ripple. Every roadmap issue carries `roadmap`; epics carry `epic`.
- **Types.** Epics are `Feature`; their sub-issues are `Task`. Each epic's sub-issues
  render as a tracked tree on the epic.
- **Fields.** Every roadmap issue carries the org's four issue fields, so GitHub's own
  issue views group, sort and filter the roadmap without a board:
  - `Target date` / `Start date` — the issue's milestone window (M1 2026‑09‑11→10‑31,
    M2 11‑01→12‑31, M3 2027‑01‑01→02‑28, M4 03‑01→04‑30). Group by `Target date` for
    the timeline.
  - `Priority` — dependency order, not sentiment: **Urgent** for the four epics that
    unblock others (ComponentKit seam, manifest completeness, conformance corpus,
    orphaned tests); **High** for the rest of M1–M2; **Medium** for M3–M4. Sub-issues
    inherit their epic's priority.
  - `Effort` — scope: **High** for seam, widget, corpus, proto-migration and
    publish-surface work; **Low** for decisions, waiver lifts and docstrings.
  Filter `label:roadmap` by `Priority:Urgent` to see the current critical path.
- **A project board.** [Meridian roadmap](https://github.com/orgs/meridian-ux/projects/1)
  carries roadmap issues from both repos. **Board** uses Status columns and Milestone
  swimlanes; GitHub does not offer milestones as board columns. **Timeline** uses
  `Start date`→`Target date`, grouped by milestone. **Critical path** filters to
  `Priority:Urgent`, sorts by target date ascending, and shows tasks individually.
  Three label-filtered boards — **Track: Parity**, **Track: Design language**, and
  **Track: Hardening** — keep the existing track labels authoritative without
  introducing a duplicate project field.
  Native auto-add is enabled for open `roadmap` issues in the public repository.
  The organization's current plan permits only one auto-add rule, with a single
  repository per rule; internal standalone issues still need explicit addition.
  The enabled sub-issue workflow does not replace that missing standalone rule.
  Issue fields and labels remain authoritative; the board is a projection.
- **Refreshing this file.** `tools/roadmap_matrix.py --write` regenerates the parity
  table from the manifest. The milestone and epic tables are hand-maintained; when an
  epic closes, strike it here.

## What is deliberately not here

The selected distribution direction is crates.io for the three Rust packages
and npm for `@savvifi/meridian-web`; [DISTRIBUTION.md](DISTRIBUTION.md) records
archive verification and release prerequisites. Preparation is not publication
and does not close the remaining v1 contract/conformance work.

- Verified SwiftUI rendering. Its public preview is now represented in the matrix as
  `unverified`; the public monorepo now owns a tested SwiftPM foundation under
  [packages/swiftui](packages/swiftui/README.md), not an external source dependency.
  Native layout smoke tests do not satisfy full semantic conformance.
  The conformance guide records the verification limits independently of catalog completeness.
- Dates beyond M4. A 1.0 is the *criterion* of M4, not a date.
- Anything the compiler has not yet found. The monorepo merge surfaced two unimplemented
  RPCs and a formatting field simply by unifying pins; M3's proto changes will surface
  more, and they belong on the issues when they appear.
