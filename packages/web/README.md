# meridian-web

## npm distribution preparation

The selected v1 npm name is `@savvifi/meridian-web`. The locally buildable
`//packages/web:pkg` artifact exposes the renderer at the package root, toolkit
helpers at `/toolkit`, the compiled theme binding at `/theme`, and CSS at
`/theme.css`. The development manifest remains private; the generated
`web.package.json` is the publication manifest. No new npm version has been
published by this preparation. See [distribution verification](../../DISTRIBUTION.md)
for the detached-tarball consumer check and release prerequisites.

Hosts still supply the initialized WASM rendering seam.

The matching WASM core rejects RPC declarations over 64 KiB and request assembly
over depth 64 or 4 MiB of cumulative copy work. A rejected Stream request never
subscribes with an empty fallback. Live grammar signals are supplied to that
same core at activation; construction/transport failure shows a generic alert
without echoing request values. These assembly limits do not bound the host's
JavaScript object allocation or replace transport admission policy.
Request exports also bound conversion into Rust before copying context strings
and containers: depth 64, 65,536 value nodes, and 16 MiB of conservative conversion
work (strings charge three bytes per UTF-16 code unit). Submission context and
field values share that budget. Supply own-data JSON records, arrays, or
string-key Maps, not accessors, class instances, nonfinite numbers, or cyclic
graphs. Conversion errors are generic and return no request. Request output has
a 4 MiB JSON ceiling and preserves literal data keys, including `__proto__`, as
own properties. These limits do not bound allocation already performed by host
JavaScript, key enumeration in the JavaScript engine, or time spent in host
proxy/iterator code.

Dynamic formatter, metadata, path, table, and gallery WASM inputs now use the
same bounded conversion. Standalone formatting and table/gallery projections
have a separate 4 MiB cumulative work budget, checked before cloning rows or
building repeated cells/slots. Each formatted cell/slot reserves 1 KiB for
fixed expansion plus its path and twice its selected JSON value. Static table
headers reserve 1 KiB plus header bytes even when there are no rows. Whole table /
gallery declarations are limited to 1 MiB; standalone displays and paths to
64 KiB. JSON outputs stream into a 4 MiB capped buffer before returning plain
objects, preserving raw data keys rather than invoking prototype setters.
Rejection is an error, not a truncated/partial result; failed table refreshes
clear old rows and disable their actions. This does not bound all JavaScript
DOM projections or establish full renderer robustness.
Form saves and LRO starts require the initialized core's `buildSubmissionRequest`
capability: it assembles explicit bindings and automatic fields together under
one budget. An older core without that capability rejects submissions visibly;
there is no unbounded JavaScript fallback. Form values use literal field IDs
(explicit bindings win), while LRO inputs use declared request paths (inputs
win). Nested LRO paths compose at every level; repeated values and maps stay raw.

The **web-components renderer** of the meridian design language — the reference,
React-free renderer that proves the [`WebRenderer` seam](../../schemas/src/uiview)
isn't anchored to any framework.

It ships:

- **`//src:core`** — the web toolkit: the web-components `PanelDescriptor`
  renderer (`webComponentsRenderer`, `renderPanel`), a typed worker runtime, DOM
  patch helpers, template loader, and UI-kit CSS. It speaks the **canonical**
  `@savvifi/meridian-proto-ts` types end to end and crosses the wasm boundary with
  protobuf **binary** (`toBinary` → `prost::decode`).

  Descriptor-originated RPCs can be constrained with `MountOptions.admission`:
  populate and stream calls are read-tier, while row/resource actions, view
  actions, and LRO starts/finalization are mutation-tier. LRO operation polling
  remains read-tier. A start grant does not grant the optional finalize call:
  hosts must explicitly admit both methods in `mutations`, even if a finalize
  method is also listed in `reads`. This closes the older finalize read-tier
  behavior; hosts using that path must migrate their allowlist. Reads are allowed by default for
  compatibility; mutations are denied unless the host lists the exact
  `service/method` (or passes the explicit `"unrestricted"` opt-out).
- **`//theme:web`** — the web theme binding (`meridian.css` + `theme.ts`,
  `meridian.theme.v1` → `--mer-*` vars).
- **`//bazel:panel_bundle.bzl`** — `meridian_panel_bundle`, compiling a textproto
  `PanelBundle` to binpb. Consumer-parameterized: callers pass the `proto`
  (e.g. `@meridian_schemas//proto:uiview_proto`) and bring `rules_proto`/`protobuf`.

The Rust render/request logic and WASM target live in
[`crates/core/rust/uiview`](../../crates/core/rust/uiview); a host wires that
initialized core into `webComponentsRenderer`. The design language is exposed
through `@savvifi/meridian-schemas` and `@savvifi/meridian-proto-ts`, linked from
the same monorepo during development and pinned together in npm artifacts.

## Composed views

### Authored invocation controls

`renderPanel`, `renderView`, and `webComponentsRenderer.mount` accept the same
explicit `invocation` capabilities/policy seam. ActionPanel and nested canonical
affordances, plus normalized view-header and slot controls, use the shared
seven-target dispatcher and actual Rust binding builder. A present canonical
collection wins whole, including empty; legacy no-call semantic actions require
a pure resolver. No URI anchor, command-to-clipboard, or old callback fallback
grants permission. Register URI/command/navigation/panel/view/copy capabilities
and an explicit target policy; RPC still requires mutation admission.

Native buttons retain description/icon/tone/emphasis, linked sanitized feedback,
pending/cancel behavior and focus return. Current owned context/policy/targets
are rechecked at activation and around asynchronous confirmation/effects;
replacement, inactive-tab disposal, and unmount suppress obsolete completion.
Cancellation is best effort, not rollback, and duplicate activation stays guarded
until the current host effect settles. Refresh failure is distinct from effect
failure and never automatically replays a successful action. Rerender/update
the mount to repaint changed host/descriptor inputs.

These controls accept bounded own-data JSON context, reject getters/cycles and
oversized snapshots before host work, and include header/slot actions in the
existing composition ceiling. This does not complete form, row/resource action,
or other renderer/modality adoption; those legacy workflows remain separate.

`renderView` partitions `header_row` slots into the view header in every layout.
Body slots retain stable `position` order. In tabbed layouts, only nonempty
`tab_label` slots become tabs, ordered by `tab_position` with stable position
ties; unlabeled slots remain persistent regions above the selector. No labeled
slots means a plain ordered stack, not an inferred tab strip. This aligns the
web-components tier with the shared React layout contract.

Tabs use manual activation: Left/Right/Home/End move focus; Enter/Space or click
activates. Only active tab content mounts/fetches, and switching disposes the
old panel's live resources. Returning to a tab creates a fresh panel; local
drafts are not cached across tab switches. Tab/panel associations use generated
per-view IDs, not producer slot IDs. The shipped theme CSS wraps long tab labels
and header controls, and reflows wide main/sidebar columns to main-then-sidebar
at narrow widths. View rendering preserves host root classes, including the
base theme class.

Call `disposeView(root)` before removing a composed view or handing its root to
another renderer; `renderView` calls it automatically on replacement. Disposal
is idempotent and releases every mounted panel's resources. It invalidates
pending view observation and detached view/slot action handlers, but does not
abort host transport work already started. Both browser and toolkit exports
include this helper. Calling `disposePanel` on the outer view root alone is not
a composed-view teardown.

Migration: older web views turned unlabeled regions into tabs, automatically
selected/fetched on arrow navigation, and mounted inactive panels. Authors must
set explicit `tab_label` values for intended tabs. Header rows now stay outside
the body/tab strip.

Nested `sub_view` takes precedence over a slot's legacy panel and recursively
uses the same layout/host seams. A `sub_view_populate` call is read-admitted and
built by the bounded core; its declared row array repeats the nested template.
Owned rows supply `record` to no-populate tables, detail headers, record cards,
and forms, and the raw selected-row context for nested actions/submissions.
Explicit populate/prefill calls retain their transport behavior. Failed repeated
reads have visible retry feedback; empty lists are explicit. Parent disposal,
replacement, or hiding a tab recursively disposes descendants, and obsolete
responses cannot mount them afterward.

`depends_on_selection_key` reads an own data property of `context.selections`.
Missing/null/empty/falsey values retain the authored placeholder, without mounting
the panel or nested view or firing its read. A gated tab retains its selector
label. The host owns the selection bag: call `renderView` with the new context
when it changes; mutating a bag in place does not notify this imperative renderer.
Replacement intentionally resets local panel/draft state.

Composition preflight rejects cycles, nesting beyond 64, or more than 1,000
declared view/slot nodes. The active composed tree shares a 1,000-node budget,
released on descendant disposal; repeated expansion is checked against the
remaining budget before rows mount. These bound composition, not arbitrary host
allocation, every panel's DOM, or a hard execution-time sandbox. They do not
establish native composition, all per-renderer layout evidence, or full v1 parity.

## Build & test

Media playback errors degrade to a safe poster image, then to alt text if the
poster fails. Captions, duration, chapter contents, and a safe source link remain
available; seek controls disable without a player. An unspecified media kind is
inferred only from recognized image/audio/video extensions; other sources
degrade. Rejected URLs never become active media or links. Image media ignores
the separate poster, as specified by the schema.

`LlmPromptPanel` is a local parameter-fill and preview surface, not an LLM
execution client. Slots use their canonical `FormField` controls, including
nested objects, repeated values, string maps, and multiline text. Preview
substitutes original template tokens once; inserted token-shaped text stays
literal, and unresolved tokens remain visible. Values are keyed by slot name,
not an unrelated authored field ID. Templates, model metadata, and output JSON
schema are rendered as text, never interpreted as HTML.

Remote enum options use the host's read-tier admission policy. Loading and failed
option requests disable preview; failures remain visible with a retry action.
Disposing or replacing a panel ignores late option responses and prevents stale
forms from updating their preview. Preview itself makes no RPC and never invokes
an LLM provider.

Multiline masked slots use one native password input per line, with Enter,
boundary Backspace/Delete, and multiline paste support. Raw values retain their
original line separators and trailing blank lines; long values are paged, not
truncated. Preview conceals masked slots (including aggregates with masked
children) until **Show masked values in preview** is selected. Each successful
new preview starts concealed. Masking prevents casual visual disclosure; it is
not encryption or protection from code running in the host page.

Standalone `PromptPanel` uses the optional `onPromptResponse(panelId, values)`
host callback on `renderPanel`, `renderView`, or `WebRenderer.mount`. Values are
a canonical protobuf `Struct`, keyed by field ID; a confirmation returns a bool
keyed by panel ID. Cancellation returns `null`, not a false confirmation. The
callback may return a promise. Pending responses block duplicates; acceptance
finishes the mounted prompt, while failure preserves inputs for retry. Missing
handlers are explicit and cannot submit. Replacing/disposal isolates old replies.
This is a local host callback, not an RPC grant: the host must authorize any
external action it chooses to perform with the collected values.

```bash
bazel build //src:core
bazel test //tests:unit //tests:conformance   # conformance = the binary-boundary render guard (jsdom)
```
