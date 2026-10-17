# Layout realization across modalities

This is the layout contract for roadmap #53. It describes how the four existing
[`Layout.mode`](proto/view.proto) arms preserve composition as space and
interaction change. It adds no schema fields. The realization table is required
behavior; the implementation audit below is evidence of current support, not an
assertion that every renderer already satisfies it. Panel-level coverage alone
does not prove composed-view support.

## Shared invariants

- A slot retains its identity, title, content, and action meaning when its
  arrangement changes. Do not silently drop a sidebar, an inactive tab's label,
  an unsupported panel, or a nested view.
- Stable `position` order is the baseline; ties retain descriptor order. In
  `two_column`, partition main/sidebar first and retain that order within each
  group. Unspecified or unknown columns belong to main.
- `header_row` slots belong with the view header before the layout body. On a
  narrow surface, they may wrap below the title; wrapping must not hide controls
  or change their bindings.
- In `tabbed`, a nonempty `tab_label` identifies a tab. Other body slots are
  persistent regions above the selector. Order tabs by `tab_position`, then
  baseline order. Slot roles are advisory, not an alternate tab predicate.
- Unset or unknown layout modes degrade to a position-ordered stack. A `list`
  normally has one content slot, but extra authored slots must remain visible.
- Layout does not grant RPC authority. Preserve host admission, selection gates,
  and raw request bindings. A closed selection gate retains its authored
  placeholder; changing tabs is not consent to invoke a mutation.
- Scope gates follow the established browser contract: missing, null, false,
  zero, and empty-string selections keep the gate closed. This is distinct from
  raw row/form bindings, which preserve those values without coercion.

## Required realization table

The browser column applies to web-components and the shared React composition
tier used with HTML, shadcn, and MUI kits. Native cells define the target contract;
they are not claims about complete SwiftUI composition. The implementation audit
below distinguishes the TUI's composed host from extracted-panel proof.

Release scope: SwiftUI remains a preview. Its column is a future realization
target, not a v1 release gate. Existing preview tests still apply, and its
unverified coverage must not be promoted without evidence. The stable TUI and
browser tiers retain their composed-layout acceptance requirements.

| Layout | Browser, wide | Browser, narrow | TUI, including 80 columns | SwiftUI / compact touch surface | Conversation or static text |
|---|---|---|---|---|---|
| `list` | One content region; retain extra slots in baseline order. | Same vertical sequence; preserve labels and usable controls. | One vertical sequence with visible section labels and the panel's native interaction. | One scrollable sequence; extra slots remain reachable. | Labeled sections in baseline order; preserve action labels and destinations as text when interaction is unavailable. |
| `stacked` | Vertical sections in baseline order. | Same sequence, with wrapping instead of horizontal clipping. | Vertical sections; scrolling or explicit section navigation keeps every section reachable. | Vertical sections with native scrolling. | Labeled sections in baseline order. |
| `tabbed` | Persistent regions, then labeled selector and selected panel. | Keep every selector label reachable by wrapping, scrolling, or a native section selector; retain selection and persistent regions. | Persistent regions plus a labeled, keyboard-operable section selector. If the host cannot select sections, expand labeled sections in tab order rather than omit them. | Native tabs or a section selector that preserves authored labels, order, and selected content. No requirement to squeeze all labels into one row. | Expand all tabs as labeled sections in tab order after persistent regions; never emit only the first tab. |
| `two_column` | Main plus sidebar when both remain legible. | Stack main, then a labeled sidebar; retain order within each group. | At 80 columns use main followed by a labeled sidebar, not two clipped columns. Wider terminals may use columns only while both remain usable. | Compact width stacks main then sidebar; a wider split presentation may retain both columns. | Main sections followed by a labeled sidebar group. |

An interactive renderer may keep inactive tab bodies unmounted; it must preserve
the selector's labels and make every body reachable. A static rendering must
expand them instead. A change to the tab set must leave a valid selection or a
visible empty state, not an out-of-range blank panel. Empty views still retain
their view identity/title and any admitted header actions.

Interactive selectors must expose selection and panel association to their
platform's accessibility system. Browser tab selectors need a named tablist,
associated tabs/panels, and keyboard access to every tab without requiring a
pointer. Terminal selectors must document their keys. Responsive reflow must
retain meaningful reading and focus order. These are acceptance requirements,
not evidence that role attributes alone establish accessibility.

The shared React selector uses manual activation: Left/Right wrap focus,
Home/End reach the first/last tab, and Enter/Space or click selects the panel.
Up/Down retain page scrolling. Only the selected body mounts, so browsing labels
does not fetch inactive content; hidden panel containers retain valid
`aria-controls` targets. Labels wrap at compact widths without changing order.
This follows the [WAI tabs pattern](https://www.w3.org/WAI/ARIA/apg/patterns/tabs/)
for panels whose activation may load data.

## Current implementation audit

| Surface | Source evidence | Verified support and remaining gap |
|---|---|---|
| Shared React composition (HTML, shadcn, MUI) | [`ViewRenderer`, `TabbedSlots`, `TwoColumnSlots`](../packages/web-react/src/view_renderer.tsx); [view tests](../packages/web-react/tests/view.test.ts); [tab interaction tests](../packages/web-react/tests/view_tabs.test.ts) | List/stacked ordering, header-row partition, labeled tabs versus persistent regions, selection clamping, and wrapping main/sidebar are implemented. Two-column flex bases are 320px main / 240px sidebar with a 24px gap; these are current implementation details, not cross-modality units. Tabs provide manual keyboard activation, roving focus, unique tab/panel associations, and wrapping labels. The shared binary corpus now has real Chrome geometry, keyboard, association, and resize-retention proof across all three kits at 320/1100px; broader stateful overflow and conversation integration remain separate. |
| Web-components composition | [`renderView`, `disposeView`](../packages/web/src/uiview/view_renderer.ts); [view tests](../packages/web/tests/view_renderer.test.ts); [actual-WASM composition tests](../packages/web/tests/conformance_wasm.test.ts); [Chrome tests](../packages/mui-kit/tests_browser/web_components.js) | Header partition, explicit/persistent tab regions, manual activation, unique associations, and active-only mounting are implemented. Static/repeated nested views preserve host seams; repeated rows bind no-populate record/form/table content and raw submissions. Closed selection gates retain placeholders/labels without reads; the host rerenders with updated selection context. Recursive disposal invalidates obsolete work. Cycles/depth/expansion are bounded. Actual Chrome verifies long-label/manual keyboard behavior at 320px and 1100px columns reflowing main-then-sidebar at 320px. The shared binary corpus now has real Chrome section/tab/sidebar geometry and keyboard/reflow proof alongside the native host; broader stateful overflow and conversation integration remain separate. |
| TUI composed host and transcript | [`ViewHost`](../crates/tui/rust/tui/src/view.rs); [whole-view tests](../crates/tui/rust/tui/tests/view_composition.rs); [conversation view arm](../crates/tui/rust/tui/src/conversation.rs) | The composed host renders real PanelView widgets in scrollable labeled sections. All four modes, header partition, stable ties, main-then-sidebar ordering at 80/140 columns, manual tab navigation, persistent regions, nested/repeated ambient records, selection gates, and host-owned submissions have whole-view buffer/interaction tests. Hidden tabs release streams immediately. Opaque-token callbacks route independently of focus. The offline executable accepts `--view`. The older stateful suite still extracts panels and must not be counted as this proof. The shared binary corpus covers fourteen authored composition/gate cases at 80/140 columns alongside the browser consumers; broader stateful overflow and conversation integration remain separate. The transcript's `Block.view` still reports “not drawn”; it does not automatically use this host. |
| SwiftUI | [local panel preview](../packages/swiftui/Sources/MeridianUI/MeridianPanel.swift); [renderer catalog](conformance/renderer_catalog.json) | The public monorepo now contains the preview and initial panel view-dump evidence. This panel entrypoint does not implement general ViewDescriptor composition; all four layout realizations remain unverified. “Tabbed on iOS” in the required table is a target contract, not a report of current behavior. |
| Conversation React / framework-free HTML | [`BlockView` host callback](../packages/chat/src/render_react.tsx); [HTML renderer](../packages/chat/src/render_html.ts) | React delegates `Block.view` to an optional host callback; without one it returns no view content. HTML does not compose a view. Neither proves the text expansion in the table. A host using a panel/view renderer inherits that renderer's behavior and must supply its own integration proof. |
| Launchpad | [command palette schema](proto/command_palette.proto) | Commands route to a panel or view; the palette does not own view arrangement. Verify the destination host, not a second layout implementation in the palette. |

The table does not add a waiver or change `coverage.json`. The existing panel
matrix and conversation coverage continue to describe their own scopes. In
particular, neither a panel snapshot nor an opaque host callback may be counted
as an implemented layout.

## Acceptance evidence still needed

The shared binary layout corpus now lives in `conformance/layout`, authored by
`tools/layout_corpus.py` against the canonical descriptor set. Fourteen cases
exercise all four modes, stable ties/advisory roles, headers, unknown columns,
unset/future layout arms, nested/repeated views, action labels, and six gate
states. HTML, shadcn, MUI, real-WASM web-components, and the native ViewHost consume
the same bytes and expected slot/content order. The native host executes them
at 80/140 columns. The hermetic
[`layout_browser_test`](../packages/mui-kit/tests_browser/layout.cjs) additionally
verifies 112 real-browser mounts: all fourteen cases across HTML, shadcn, MUI,
and actual-WASM web-components at 320/1100px. It checks visible section bounds,
reading order and reachability, labeled sidebar reflow, long wrapped tab labels,
manual keyboard activation/associations, selection/focus across resize, and
read counts without a live transport. CI explicitly runs browser and native
layout proof targets, including if wildcard discovery changes.
These cases do not establish every overflow/interaction state or the separate
conversation-host integration.

Use the same binary `ViewDescriptor` fixtures across renderer hosts, including
all four modes, shuffled positions/ties, main/sidebar placement, labeled tabs
and unlabeled regions, header-row slots, nested views, and selection gates.

1. Assert every expected slot remains reachable and labels/actions retain their
   meaning; test unset/unknown modes without changing the wire schema.
2. Compare wide and narrow browser layouts using actual rendered geometry and
   focus/navigation behavior, not only class names or static markup.
3. Render a complete native view at 80 columns and a wider viewport; inspect
   buffers and exercise scrolling/section selection. Extracted panel tests do
   not satisfy this step.
4. Before promoting the SwiftUI preview to full parity, verify its real compact/wide
   composed-view behavior, including tab selection. This future promotion is not a
   v1 release gate. Do not infer it from the browser or an advertised preview.
5. Verify composed conversation hosts and static expansion separately, including
   missing host support. An explicit unsupported placeholder is useful gap
   reporting, not full realization.

This document completes the specification artifact only after review. Renderer
changes and the evidence above remain part of the broader #13/v1 acceptance;
publishing the table must not close those implementation gaps.
