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

## Ambient records for embedded panels

Hosts may call `PanelView::set_record(Some(Arc::new(record)))` with an immutable
JSON object. No-populate headers, cards, forms, and tables use that record;
explicit populate calls still take precedence, and explicit form prefill
overrides ambient defaults. Row-field bindings borrow the record for reads,
streams, and host-owned form/LRO submissions without cloning the full context.
Raw strings, false, and zero retain their original types.

Records are checked against the shared 4 MiB work and 64-level depth limits
before retention. Invalid records leave the previous state intact; hosts must
surface the returned error and must not display that previous row as the rejected
one. Reusing the same `Arc` preserves edits and caches. Replacing it (even with
an equal object) or clearing it resets local state, closes live streams, and
invalidates outstanding LRO tokens. Retain the `Arc` across redraws.

This is also the record handoff used by the composed `ViewHost` below.

## Composed native views

`ViewHost::new(descriptor)` owns a canonical `ViewDescriptor`. Render it into the
host's frame with `render`, passing the same `Context` and host-owned `RpcInvoker`
used for panels. The standalone offline viewer accepts `meridian-tui view.binpb
--view`; it refuses reads and mutations visibly rather than returning empty success.

All four modes preserve stable position order and header-row sections. At both
80 columns and wider widths, main sections precede a labeled sidebar. Unset or
unknown modes stack. Tabbed views keep unlabeled regions before the selector;
only the selected labeled tab's body mounts. F6/Shift+F6 move between sections,
tab labels, and actions. Left/Right/Home/End browse tab labels; Enter/Space
activates them manually. Ctrl+PageUp/PageDown always scroll the complete composition,
including long labels. Plain paging keys stay with a focused prompt; otherwise
they also scroll the view. Other keys reach the focused panel's native interaction.
Each panel has a 16-row virtual section; scrolling the view does not reset edits.

Nested views take precedence over panels. Repeated child views fetch through the
host's read-admitted invoker, validate the array and object rows, and share each
immutable ambient record with real child widgets. Closed selection gates preserve
labels and placeholders without fetching. As in the browser hosts, missing,
null, false, zero, and empty-string selections keep a scope gate closed; raw
row/form bindings still retain those values. Repeated-read failures are visible
and retry only on Enter. Hidden or
gated descendants are dropped, releasing streams and invalidating operation tokens.
Call `invalidate` when transport or context changes affect panel reads, including
selection values bound into those reads. Gate and repeated-populate request
changes are also reconciled during rendering.

`handle_key` returns `ViewResponse` for actions, forms, LRO starts, and prompt
responses. It never executes a mutation. Hosts authorize each emitted request,
execute it, and report errors with `show_error` or the focused widget's LRO APIs.
Token-routed `update_lro_progress`, `complete_lro`, `fail_lro`, and `cancel_lro`
continue working after focus moves. `focused_panel_mut` exposes the actual widget;
`poll_streams` uses the host's
admitted stream transport. Redraw after changing context before processing input.

Composition rejects descriptors over 4 MiB, depth 64, 1,000 expanded view/slot/action
nodes, or 16 KiB per composition label. Repeated expansion is checked before
constructing child records. These native limits do not change the wire schema.
Whole-view TestBackend tests cover 80/140-column ordering, keyboard reachability,
manual tabs, gates, nested/repeated raw bindings, host-owned submissions, and errors.

## Native gallery and media

Gallery renders populated cards in a responsive grid with one-cell gutters and
at least 32 cells per card when space permits. Narrow terminals use one column.
Titles, icons, status, subtitles, links, and action labels remain text; image
slots are omitted on this tier. Shared ValueDisplay formatting still supplies
the card labels. Grapheme-aware wrapping preserves Unicode, explicit newlines,
and styles, and row heights prevent wrapped content from overlapping the next
row. `select_next` / `select_prev` keep the selected card's row visible across
resizes. A card taller than the viewport is clipped to the available height.

Media uses the terminal's framed text degradation: authored alt description,
caption, source URI, duration, captions URI, and chapter contents. This is not a
claim of image/video playback. Hosts retain navigation and execution authority.

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
inline validator uses UTF-16 string lengths and the shared Rust Unicode regex
contract on native and WASM: a search match is sufficient unless the author
anchors the pattern, and lookaround/backreferences are unsupported. Invalid
patterns fail closed. The standalone prompt uses the same length and pattern
semantics for text, masked input, and their nested/repeated descendants. Migration:
the standalone helper no longer adds implicit whole-value anchors or counts
Unicode scalar values. Producers requiring whole-value constraints (including
imported CloudFormation constraints) must author an explicitly anchored pattern,
such as `^(?:cat|dog)$`; astral characters count as two UTF-16 code units.
Read-only forms ignore editing keys. Replacing a descriptor discards cached form
edits and open JSON editors; resizing preserves them. Hosts own authorization,
RPC execution, and operation polling; rendering or editing never starts an RPC.

Each `LroSubmission` includes an opaque, cloneable `LroRunId` for that one
in-process attempt. While it is active, inputs and duplicate submissions are
disabled. The host executes the start RPC and polls with its own authorized
client/policy. Decode the operation's metadata using the declared metadata type,
then pass its canonical protobuf `Struct` projection to
`update_lro_progress(&run_id, operation_name, &metadata)`. The native progress
line uses the same core metadata formatter as the browser. Operation names cannot
change within an attempt.

After successful completion and any declared host-owned finalize RPC, call
`complete_lro(&run_id, &result)` with the decoded protobuf `Struct` source. The
descriptor's result table renders locally, including shared ValueDisplay
formatting and raw row selection; it does not invoke the table's populate RPC.
Use `fail_lro` for start/poll/operation/finalize errors, or `cancel_lro` to mark
host-confirmed/local cancellation. These methods do not send any RPC, including
CancelOperation. Enter retries a terminal attempt with a fresh token; Esc returns
to its inputs. Resize preserves progress; replacing the panel or changing its
bound request context, or explicitly invalidating the view, drops that attempt.

Route every emitted start through the host's authorization policy before its
backend. On denial, call `fail_lro(&submission.run_id, &denial_message)`; do not
report an empty success or a completed operation. The denied state renders the
message and permits an explicit Enter retry with retained raw input. A later
host-authorized retry gets a fresh token, so an old denial cannot overwrite it.
Populate/prefill reads also go through the supplied `RpcInvoker`; a refusal is
visible and cached across repaint rather than appearing as successful empty data.
The TestBackend integration suite exercises these paths with an allowlisting host
and a separate backend spy. It does not install a renderer-owned policy or bypass
the host's admission authority.

Updates return false without changing state for stale/terminal/cross-view tokens,
changed operation names, or malformed/oversized structured payloads. Metadata and
result conversion is bounded to 1 MiB of keys/string content, 10,000 value nodes,
and 64 nested levels; nonfinite numbers are rejected. Hosts must handle rejection
explicitly; nothing is silently truncated. Run tokens are runtime identities,
not serializable DTOs or durable job IDs. The opaque operation name and canonical
protobuf payloads remain the host's transport/recovery contract.

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
