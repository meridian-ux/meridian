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

```bash
bazel build //src:core
bazel test //tests:unit //tests:conformance   # conformance = the binary-boundary render guard (jsdom)
```
