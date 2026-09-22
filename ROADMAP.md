# Meridian roadmap

Three tracks, four milestones, seventeen epics, sixty-three tasks — tracked as GitHub
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
| **M1 · Seam & truth** | 2026‑10‑31 | [#4](../../issues/4) ComponentKit seam · [#5](../../issues/5) manifest completeness · [#14](../../issues/14) test floor · [#15](../../issues/15) release engineering · internal [#9](https://github.com/meridian-ux/meridian-internal/issues/9) orphaned tests |
| **M2 · Parity closure** | 2026‑12‑31 | [#6](../../issues/6) TUI · [#7](../../issues/7) web-components · [#8](../../issues/8) kits · [#9](../../issues/9) conformance corpus · internal [#11](https://github.com/meridian-ux/meridian-internal/issues/11) playground harness |
| **M3 · One language** | 2027‑02‑28 | [#10](../../issues/10) Tone · [#11](../../issues/11) Affordance · [#12](../../issues/12) ValueDisplay · [#13](../../issues/13) theme + glossary |
| **M4 · Hardened 1.0** | 2027‑04‑30 | [#16](../../issues/16) publish surface · [#17](../../issues/17) untrusted producers · internal [#10](https://github.com/meridian-ux/meridian-internal/issues/10) service contracts |

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
| arm | parity | web-components | web-react | mui-kit | html-kit | shadcn-kit | tui |
|---|---|---|---|---|---|---|---|
| `table` | standard | ● | ● | ● | ● | ● | ● |
| `lro` | standard | ● | ● | ● | ● | ● | ● |
| `adhoc` | standard | ● | ● | – | – | – | ◐ |
| `prompt` | standard | ● | ● | ● | ● | ● | ◑ |
| `llm_prompt` | standard | ● | ● | ● | ● | ● | ◑ |
| `gallery` | standard | ● | ● | ● | ● | ● | ● |
| `form` | standard | ● | ● | ● | ● | ● | ● |
| `choice` | full | ● | ● | ● | ● | ● | ● |
| `snippet` | full | ● | ● | ● | ● | ● | ● |
| `action` | full | ● | ● | ● | ● | ● | ● |
| `connect_flow` | full | ● | ● | ● | ● | ● | ● |
| `copy_value` | full | ● | ● | ● | ● | ● | ● |
| `catalog` | full | ● | ● | ● | ● | ● | ● |
| `terminal` | specialized | ● | ● | ● | ● | ● | ◐ |
| `grammar` | specialized | ● | ● | ● | ● | ● | ● |
| `stat` | full | ● | ● | ● | ● | ● | ● |
| `detail_header` | standard | ● | ● | ● | ● | ● | ● |
| `record_card` | standard | ● | ● | ● | ● | ● | ● |
| `resource_cards` | standard | ● | ● | ● | ● | ● | ● |
| `chart` | specialized | ● | ● | ● | ● | ● | ● |
| `steps` | full | ● | ● | ● | ● | ● | ● |
| `media` | specialized | ● | ● | ● | ● | ● | ● |
| `stream` | full | ● | ● | ● | ● | ● | ● |

**23 arms × 6 renderers = 138 cells; 131 render, 7 do not.**

| status | cells |
|---|---|
| – `not-applicable` | 3 |
| ◐ `placeholder` | 2 |
| ◑ `separate-entrypoint` | 2 |

| renderer | gaps |
|---|---|
| web-components | 0 |
| web-react | 0 |
| mui-kit | 1 |
| html-kit | 1 |
| shadcn-kit | 1 |
| tui | 4 |
<!-- matrix:end -->

Legend: ● renders · ◐ placeholder · ◑ separate entrypoint · ○ missing · ✕ structural gap · – not applicable.

Three facts shape the order of work:

- **The shared seam is now open.** `ComponentKit` (`packages/web-react/src/component_kit.ts`)
  exposes optional `Stream` and `Terminal` members. Semantic snapshots exposed
  the missing HTML/Shadcn `LlmPrompt` implementations; both now share typed
  parameter controls and local textual preview, with focused interaction tests.
- **The remaining intentional parity gaps are bounded:** two TUI placeholders
  (adhoc and terminal), two dedicated-entrypoint shapes (prompt and llm_prompt),
  and the TUI stream/terminal transport boundaries documented in their degradation
  ladders. The TUI now has focused `TestBackend` coverage for its rendered content
  and snapshot stream path; new parity work should preserve those tests.
- **The renderer catalog is now complete at the tier level.** The panel matrix remains
  intentionally scoped to `PanelDescriptor.body`; the catalog separately declares the
  SwiftUI preview tier and the conversation and launchpad modalities, with local
  entrypoints checked in CI. [#5](../../issues/5) remains the owner of expanding the
  catalog into per-modality conformance evidence.

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
This is a regression baseline, not proof of field-complete parity: broader
populated-shape parity, renderer-specific overflow/layout, broader interactive
surfaces, native snapshots beyond text goldens, and a Bazel-aware re-record
workflow remain in [#9](../../issues/9). See the
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
shared Step frame source admission with text degradation, and HTML/Shadcn
ActionPanel/Form interaction contracts are also checked in. Full Media sources,
posters, and caption tracks now share that passive-asset admission rule across
all browser renderers, degrading rejected primary sources to authored text and
dropping rejected auxiliary assets. These checks do not establish visual
layout, every formatter option, or full renderer parity. Remaining work is
the broader parity and renderer-specific/tooling scope called out above.

## Track B — One language

The protos already carry a semantic vocabulary. The work is to say each concept **once**:

| concept | today it is spelled | distilled to |
|---|---|---|
| **Tone** — how serious, how it looks | `ValueTone` (6) · `Status.State` / `ToolBlock.State` · `AffordanceStyle` · `Palette` roles | one `Tone` enum; `Palette` keyed by it — [#10](../../issues/10) |
| **Affordance** — what can I do here | `Affordance.invoke {uri, command}` · `Command.action {rpc, open_panel, open_view_id, navigate}` · `RowAction` · `ActionPanel` · kit `ActionBar` · `ActionPlacement` | one `Affordance {label, tone, emphasis, placement, invoke}` through one admission seam — [#11](../../issues/11) |
| **Value** — what is this, how does it read | `ValueDisplay` (18 `ValueType`s) on `DescriptorRow`, `FormField`, `TableColumn`, `StatPanel`, `CopyValue`, `MetaField`, `ResourceCardTemplate` slots, gallery `CardSpec` slots, `Conversation.Block.Field`, and `Conversation.Block.Table` cells | `display` on every value-bearing message, one formatter in `uiview-core` — [#12](../../issues/12) |
| **Rhythm & layout** | `Metrics` is empty; four layout modes with no per-modality realization; `NestedForm.element` is an empty oneof | `Metrics` defined; a degradation ladder per layout like `panel.proto` gives each arm; `schemas/DESIGN_LANGUAGE.md` as the glossary — [#13](../../issues/13) |

The glossary is [`schemas/DESIGN_LANGUAGE.md`](schemas/DESIGN_LANGUAGE.md): every
current concept is mapped to its meaning, modality ladder, and theme roles while
the proto remains the source of truth.

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
values against resolved options. Broader interaction parity remains separate work.
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

## Track C — Hardening

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
[#15](../../issues/15) closes the release-engineering items the monorepo merge left deliberately open — the
uncommitted lockfile, the `bats` fetch that reddens CI without being used, the
tectonic targets, `--action_env=HOME`. The publish workflow now repeats the parity,
catalog, test-floor, package-test, and Rust gates before any publish action. [#16](../../issues/16) decides the publish
surface and moves the registry admission ratchet into CI, where 0.25.0's regression
would have failed a pull request instead of a release. [#17](../../issues/17) treats
the descriptor boundary as untrusted, because the playground's own README says it is.

`meridian-internal` carries the service-side hardening: the 43 integration tests no
target runs ([#9](https://github.com/meridian-ux/meridian-internal/issues/9)), the
contract items the merge shipped with notes attached
([#10](https://github.com/meridian-ux/meridian-internal/issues/10)), and the playground
as the place parity is *seen* ([#11](https://github.com/meridian-ux/meridian-internal/issues/11)).

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
  Filter `label:roadmap` by `Priority:Urgent` to see the critical path (21 issues).
- **A project board.** [Meridian roadmap](https://github.com/orgs/meridian-ux/projects/1)
  carries all 80 roadmap issues from both repos in four views: **Board** grouped by
  milestone, **Timeline** over the `Start date`→`Target date` window, **Critical path**
  filtered to `Priority:Urgent` (21 issues), and **By track**. An issue opened in either
  repo with `label:roadmap` is added to it automatically. Everything the board shows is
  already on the issues, so the board is disposable and the issues are not.
- **Refreshing this file.** `tools/roadmap_matrix.py --write` regenerates the parity
  table from the manifest. The milestone and epic tables are hand-maintained; when an
  epic closes, strike it here.

## What is deliberately not here

- A `swiftui` row in the matrix. `meridian-swift` lives outside this monorepo; its
  maintainers own the declaration. [#5](../../issues/5) tracks the ask.
- Dates beyond M4. A 1.0 is the *criterion* of M4, not a date.
- Anything the compiler has not yet found. The monorepo merge surfaced two unimplemented
  RPCs and a formatting field simply by unifying pins; M3's proto changes will surface
  more, and they belong on the issues when they appear.
