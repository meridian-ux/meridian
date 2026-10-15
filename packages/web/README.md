# meridian-web

The **web-components renderer** of the meridian design language — the reference,
React-free renderer that proves the [`WebRenderer` seam](https://github.com/meridian-ux/meridian-schemas)
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

The Rust render/request logic + the wasm bundle live in
[meridian-uiview-core](https://github.com/meridian-ux/meridian-uiview-core); a host
wires that `uiview_wasm` into `webComponentsRenderer`. The design language reaches
this repo as **npm** packages (`@savvifi/meridian-schemas`,
`@savvifi/meridian-proto-ts`) — there's no `bazel_dep` on the other meridian
modules.

## Build & test

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
an LLM provider. Standalone `PromptPanel` host response collection remains a
separate roadmap obligation.

```bash
bazel build //src:core
bazel test //tests:unit //tests:conformance   # conformance = the binary-boundary render guard (jsdom)
```
