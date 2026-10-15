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

The monorepo supplies the first-party core and theme crates through Cargo path
dependencies and in-repository Bazel targets. Both builds use the canonical
protobuf contracts from `schemas/proto`.

## Embedded prompts and local LLM preview

`PanelView::render` draws Prompt and LlmPrompt in the host's existing frame.
Forward prompt key events to `PanelView::handle_prompt_key(&descriptor, key)`;
it returns an optional `PanelPromptResponse`. Submitted values and preview slots
are canonical protobuf `Struct` values, including nested objects, arrays, and
maps. Confirmation returns a distinct boolean outcome; cancellation is distinct
from false. Ordinary prompts respond once. LLM preview remains editable and may
be requested again. No model, provider, or mutation RPC is executed. Hosts own
authorization and execution of any subsequent action. As with other native enum
controls, hosts resolve remote enum options before supplying a descriptor.

Tab/Shift+Tab moves between fields; arrow keys edit numeric/enum controls, and
Space toggles booleans. Compound values use recursively validated JSON editors;
Ctrl+U clears an editor. Defaults honor required repeated rows, bounded to 1,000
expanded value nodes; oversized descriptors fail visibly, never silently
truncate. Enter validates and submits/previews. Shift+Enter inserts a newline in
an LLM slot declared multiline. Original separators and Unicode remain in the
collected value. PageUp/PageDown scrolls long previews; F1 toggles full prompt
description/detail, with paging for long context. Esc cancels. Confirmations use
Y/N, defaulting to No on Enter; their fields are ignored as the schema specifies.

Masked fields and compound editors containing masked children remain concealed,
including preview substitutions. Raw values are available only in the returned
host response and local state; concealment is not encryption. Descriptor changes
reset prompt state, while resizing/invalidation preserves in-progress edits.
The offline executable displays these local states without executing responses.
The legacy one-shot helpers remain available; their established `FieldValue`
API retains compound JSON as text, while the embedded API returns typed protobuf.

## Inline forms and LRO inputs

Forward Form keys to `handle_form_key` and LRO keys to `handle_lro_key`.
Up/Down or Tab selects a top-level field; Left/Right changes numeric and enum
values, Space toggles booleans, and ordinary text keys edit strings. F2 opens
nested objects, scalar/object arrays, or string maps in the existing prompt JSON
editor. Delete clears its buffer, Enter validates and saves locally, and Esc
discards the editor without submitting. Masked descendants remain concealed.

Enter outside the editor validates every declared field through the
platform-neutral core before returning a host-owned submit/start request.
Invalid types, lengths, patterns, numeric bounds, enum tokens, collection bounds,
and missing kinds block submission with a visible error. Values retain their raw
types, including false, zero, empty strings, and nested collections. The core
validator uses UTF-16 string lengths and unanchored pattern matching like the
browser validator; unsupported Rust-regex syntax fails closed. Full regex-dialect
parity and consolidation with legacy prompt validation remain separate work.
Read-only forms ignore editing keys. Replacing a descriptor discards cached form
edits and open JSON editors; resizing preserves them. Hosts own authorization,
RPC execution, and operation polling; rendering or editing never starts an RPC.

## Build

Hosts can call `PanelView::selected_row_request(&call, &context, legacy_id_fallback)`
to resolve an action's declared bindings against the selected raw table or resource
row. The helper uses the core request builder, preserves host context, and returns
`None` without a selection. Unbound calls produce `{}` unless the caller opts into
the legacy non-null row `id` fallback. Hosts still decide whether an action is
eligible, authorize it, invoke the RPC, and refresh the panel after success.

```bash
bazel build //crates/tui/rust/tui:meridian_tui
bazel test //crates/tui/rust/tui:tui_test //crates/tui/rust/tui:render_descriptor_test
cargo test --locked -p meridian-tui
```

Run these commands from the monorepo root. Bazel and Cargo both exercise the
native renderer; Bazel's shared conformance target additionally verifies the
committed descriptor corpus through TestBackend.
