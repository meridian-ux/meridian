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
  actions, and LRO starts are mutation-tier. Reads are allowed by default for
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
