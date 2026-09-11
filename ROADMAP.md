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

The source of truth is [`schemas/conformance/coverage.json`](schemas/conformance/coverage.json),
gated by [`schemas/tools/check_coverage.mjs`](schemas/tools/check_coverage.mjs).
The table below is **generated** from it by `tools/roadmap_matrix.py --write`.

<!-- matrix:start -->
| arm | parity | web-components | web-react | mui-kit | html-kit | shadcn-kit | tui |
|---|---|---|---|---|---|---|---|
| `table` | standard | ● | ● | ● | ● | ● | ● |
| `lro` | standard | ● | ● | ● | ● | ● | ◐ |
| `adhoc` | standard | ● | ● | – | – | – | ◐ |
| `prompt` | standard | ○ | ● | ● | ● | ● | ◑ |
| `llm_prompt` | standard | ○ | ● | ○ | ○ | ○ | ◑ |
| `gallery` | standard | ○ | ● | ● | ● | ● | ◐ |
| `form` | standard | ● | ● | ● | ● | ● | ◐ |
| `choice` | full | ● | ● | ● | ● | ● | ● |
| `snippet` | full | ● | ● | ● | ● | ● | ● |
| `action` | full | ● | ● | ● | ● | ● | ● |
| `connect_flow` | full | ● | ● | ● | ● | ● | ● |
| `copy_value` | full | ● | ● | ● | ● | ● | ● |
| `catalog` | full | ● | ● | ● | ● | ● | ● |
| `terminal` | specialized | ● | ✕ | ✕ | ✕ | ✕ | ◐ |
| `grammar` | specialized | ● | ● | ● | ● | ● | ● |
| `stat` | full | ● | ● | ● | ● | ● | ● |
| `detail_header` | standard | ● | ● | ● | ○ | ○ | ◐ |
| `record_card` | standard | ● | ● | ● | ○ | ○ | ◐ |
| `steps` | full | ○ | ● | ● | ○ | ○ | ◐ |
| `media` | specialized | ○ | ● | ● | ○ | ○ | ◐ |
| `stream` | full | ● | ✕ | ✕ | ✕ | ✕ | ◐ |

**21 arms × 6 renderers = 126 cells; 87 render, 39 do not.**

| status | cells |
|---|---|
| ○ `missing` | 16 |
| ◐ `placeholder` | 10 |
| ✕ `structural-gap` | 8 |
| – `not-applicable` | 3 |
| ◑ `separate-entrypoint` | 2 |

| renderer | gaps |
|---|---|
| web-components | 5 |
| web-react | 2 |
| mui-kit | 4 |
| html-kit | 8 |
| shadcn-kit | 8 |
| tui | 12 |
<!-- matrix:end -->

Legend: ● renders · ◐ placeholder · ◑ separate entrypoint · ○ missing · ✕ structural gap · – not applicable.

Three facts shape the order of work:

- **Eight of the gaps have one cause.** `ComponentKit` (`packages/web-react/src/component_kit.ts`)
  has no `Stream` or `Terminal` member, so no React kit *can* render those arms — and
  `stream` is declared full-parity. Opening the seam is [#4](../../issues/4), and it is first.
- **The TUI is the largest single gap** at 12 cells, and has one test file for eleven
  source files. [#6](../../issues/6) closes both together: every widget lands with a
  `TestBackend` render test.
- **The manifest is itself incomplete.** The public catalog advertises a SwiftUI renderer
  in preview with no row here, and the chat and launchpad modalities are not modelled.
  [#5](../../issues/5) makes the gate reject a shipped renderer with no declaration.

Declared is not proven. [#9](../../issues/9) builds the conformance corpus — fixtures per
arm, a normalizer per renderer, snapshots gated in CI — so `renders` becomes a property
CI checks rather than a word someone typed.

## Track B — One language

The protos already carry a semantic vocabulary. The work is to say each concept **once**:

| concept | today it is spelled | distilled to |
|---|---|---|
| **Tone** — how serious, how it looks | `ValueTone` (6) · `Status.State` / `ToolBlock.State` · `AffordanceStyle` · `Palette` roles | one `Tone` enum; `Palette` keyed by it — [#10](../../issues/10) |
| **Affordance** — what can I do here | `Affordance.invoke {uri, command}` · `Command.action {rpc, open_panel, open_view_id, navigate}` · `RowAction` · `ActionPanel` · kit `ActionBar` · `ActionPlacement` | one `Affordance {label, tone, emphasis, placement, invoke}` through one admission seam — [#11](../../issues/11) |
| **Value** — what is this, how does it read | `ValueDisplay` (18 `ValueType`s) on `DescriptorRow` and `FormField` only; everything else infers from string shape | `display` on every value-bearing message, one formatter in `uiview-core` — [#12](../../issues/12) |
| **Rhythm & layout** | `Metrics` is empty; four layout modes with no per-modality realization; `NestedForm.element` is an empty oneof | `Metrics` defined; a degradation ladder per layout like `panel.proto` gives each arm; `schemas/DESIGN_LANGUAGE.md` as the glossary — [#13](../../issues/13) |

The glossary is the deliverable that makes this a design language rather than a
schema: every enum and oneof mapped to a named concept, its tone, its ladder per
modality, its theme roles — generated where the proto is the source.

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

[#14](../../issues/14) sets a per-package floor that only rises. [#15](../../issues/15)
closes the release-engineering items the monorepo merge left deliberately open — the
uncommitted lockfile, the `bats` fetch that reddens CI without being used, the
tectonic targets, `--action_env=HOME`. [#16](../../issues/16) decides the publish
surface and moves the registry admission ratchet into CI, where 0.25.0's regression
would have failed a pull request instead of a release. [#17](../../issues/17) treats
the descriptor boundary as untrusted, because the playground's own README says it is.

`meridian-internal` carries the service-side hardening: the 43 integration tests no
target runs ([#9](https://github.com/meridian-ux/meridian-internal/issues/9)), the
contract items the merge shipped with notes attached
([#10](https://github.com/meridian-ux/meridian-internal/issues/10)), and the playground
as the place parity is *seen* ([#11](https://github.com/meridian-ux/meridian-internal/issues/11)).

## Working the roadmap

- **Labels.** `track:parity` · `track:design-language` · `track:hardening` for the track;
  `renderer:*` for the surface; `seam:ComponentKit` and `proto` for the two kinds of
  change that ripple. Every roadmap issue carries `roadmap`; epics carry `epic`.
- **Types.** Epics are `Feature`; their sub-issues are `Task`. Each epic's sub-issues
  render as a tracked tree on the epic.
- **A project board.** GitHub Projects cannot be created from the automation that built
  this roadmap, so the board is a view you bind, not state you maintain:
  *Projects → New project → Board → add items from `meridian` and `meridian-internal`
  filtered on `label:roadmap` → group by Milestone.* Everything the board shows is
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
