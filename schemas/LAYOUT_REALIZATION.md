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

## Required realization table

The browser column applies to web-components and the shared React composition
tier used with HTML, shadcn, and MUI kits. Native cells define the target contract;
they are not claims about unavailable SwiftUI source or an existing TUI view host.

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
| Shared React composition (HTML, shadcn, MUI) | [`ViewRenderer`, `TabbedSlots`, `TwoColumnSlots`](../packages/web-react/src/view_renderer.tsx); [view tests](../packages/web-react/tests/view.test.ts); [tab interaction tests](../packages/web-react/tests/view_tabs.test.ts) | List/stacked ordering, header-row partition, labeled tabs versus persistent regions, selection clamping, and wrapping main/sidebar are implemented. Two-column flex bases are 320px main / 240px sidebar with a 24px gap; these are current implementation details, not cross-modality units. Tabs provide manual keyboard activation, roving focus, unique tab/panel associations, and wrapping labels. Complete cross-kit narrow-view geometry/focus and two-column reflow proof remain separate requirements. |
| Web-components composition | [`renderView`](../packages/web/src/uiview/view_renderer.ts); [view tests](../packages/web/tests/view_renderer.test.ts) | List/stacked retain ordered slots. Two-column creates main/aside containers, but the renderer supplies no responsive column styling itself; a class name is not reflow evidence. Tabs support arrow/Home/End selection, but every slot becomes a tab, unlike the region rule above. Header-row, nested-view/repeated composition, and selection-gated slots are not implemented by this slot renderer. These are gaps, not intentional degradation. |
| TUI panels and transcript | [`PanelView`](../crates/tui/rust/tui/src/widget.rs); [conversation view arm](../crates/tui/rust/tui/src/conversation.rs) | Panels render individually. The transcript's `Block.view` shows the view title and slot count with an explicit “not drawn” message; it does not realize any layout mode. The native stateful suite extracts panels from view fixtures and therefore is not composed-layout proof. A real view host and 80-column buffer/navigation tests remain required. |
| SwiftUI | [renderer catalog](conformance/renderer_catalog.json) | Advertised external preview in `meridian-ui`; source and view-dump evidence are unavailable here. All four layout realizations remain unverified. “Tabbed on iOS” in the required table is a target contract, not a report of current behavior. |
| Conversation React / framework-free HTML | [`BlockView` host callback](../packages/chat/src/render_react.tsx); [HTML renderer](../packages/chat/src/render_html.ts) | React delegates `Block.view` to an optional host callback; without one it returns no view content. HTML does not compose a view. Neither proves the text expansion in the table. A host using a panel/view renderer inherits that renderer's behavior and must supply its own integration proof. |
| Launchpad | [command palette schema](proto/command_palette.proto) | Commands route to a panel or view; the palette does not own view arrangement. Verify the destination host, not a second layout implementation in the palette. |

The table does not add a waiver or change `coverage.json`. The existing panel
matrix and conversation coverage continue to describe their own scopes. In
particular, neither a panel snapshot nor an opaque host callback may be counted
as an implemented layout.

## Acceptance evidence still needed

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
4. Obtain the SwiftUI source and capture real compact/wide view behavior, including
   tab selection. Do not infer it from the browser or an advertised preview.
5. Verify composed conversation hosts and static expansion separately, including
   missing host support. An explicit unsupported placeholder is useful gap
   reporting, not full realization.

This document completes the specification artifact only after review. Renderer
changes and the evidence above remain part of the broader #13/v1 acceptance;
publishing the table must not close those implementation gaps.
