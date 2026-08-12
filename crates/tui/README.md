# meridian-tui

The **ratatui terminal renderer** of the meridian design language — a
native-Rust `PanelDescriptor` renderer for the terminal.

- **`PanelView`** — renders a `meridian.ui.v1.PanelDescriptor` (table / prompt /
  llm_prompt widgets) into a ratatui frame.
- **`PanelAppState`** — the panel app state machine (selection, scroll, input).
- **`RpcInvoker`** — the trait a host implements to fetch data for a panel.
- **theme binding** — maps `meridian.theme.v1.Theme` → a ratatui `Style` palette.

It is one of the swappable renderers of the design language; it depends only on
the shared rust core, never on the other renderers:

```
   meridian-uiview-core  (rust core)
     ├── //rust/uiview          (native lib)   ─▶ meridian-tui   (this repo)
     ├── //rust/uiview:theme_proto             ─▶ meridian-tui
     └── //rust/uiview:uiview_wasm  (wasm)      ─▶ meridian-web
```

It consumes the core cross-repo via the Bazel module graph
(`@meridian_uiview_core//rust/uiview` + `:theme_proto`); the proto contracts come
transitively from
[meridian-schemas](https://github.com/meridian-ux/meridian-schemas).

## Build

```bash
bazel build //rust/tui
bazel test  //rust/tui:tui_test
```

The authoritative build is Bazel. Standalone `cargo` is not wired in this repo:
the first-party `meridian_uiview` + `theme_proto` crates are supplied by Bazel
cross-repo (not as cargo path deps), and the `build.rs` proto-codegen path needs
the proto sources locally. Use the Bazel `bazel_proto` feature (the default
here).
