# Meridian design language

This glossary describes the semantic vocabulary already present in the Meridian
protos. It is a rendering contract, not a proposal for new schema fields.

## Tone

`ValueTone` communicates the meaning of a value or state: neutral, positive,
warning, danger, informative, or accent. Renderers map tone to their own
palette roles; producers do not provide colors. `Status.State` and
`ToolBlock.State` carry operational state, while `AffordanceStyle` carries
emphasis for an action. A renderer may combine those signals, but must preserve
the distinction between what something means and what the user can do.

## Affordance

An `Affordance` is a labeled invitation to act. Its `invoke` oneof is either a
URI or a command, and its optional icon, description, and style provide context.
`ActionPanel`, catalog items, connect-flow targets, and step actions reuse this
same primitive. Web renderers use links or buttons; TUI renders a keybinding-like
action line; non-interactive surfaces retain the label and destination as text.

## Value display

`ValueDisplay` declares how a value should be read rather than asking each
renderer to infer meaning from a string. Its `ValueType`, temporal/number/principal
options, and optional host-resolved link are producer intent. `ValueDisplay`
does not carry a tone field; enum-option tone remains on `EnumOption`.
The compatibility rule is additive: an absent display keeps the renderer's
existing fallback formatting. The shared declaration is present on these
value-bearing schema slots:

| Surface | Shared declaration |
|---|---|
| Table cell | `TableColumn.value_display` (tag 6), alongside legacy `format` |
| Stat value | `StatPanel.value_display` (tag 16), alongside legacy numeric format |
| Form / record-card field | `FormField.display` (tag 13); `RecordCardPanel.fields` reuses `FormField` |
| Header row | `DescriptorRow.display` (tag 3) |
| Conversation field | `Block.Field.display` (tag 3) |
| Conversation table cell | `Block.Cell.display` (tag 2), carried in `Block.Row.display_cells` |

Conversation rich cells coexist with legacy string cells: a rich entry wins for
its key, including an empty value; a missing rich key falls back to `cells`.
Declaring display changes presentation, never the raw stored/submitted value.
The schema compatibility tests in `tools/value_display_contract.test.mjs` verify
stable tags, message presence, unchanged wire/JSON when unset, and old-reader
unknown-field preservation. They do not prove renderer formatting; the stateful
corpus and interaction suites own that evidence. The broader shared-core/WASM
formatter requirement remains roadmap #50, not a consequence of these fields.

New value-bearing messages should adopt the declaration before adding ad hoc
formatting rules. Principal labels may use the compatible `Name <email>` wire
form; `PrincipalDisplay` then selects the visible name, email, or name with an
email title where the surface supports titles.

## Rhythm and layout

Panel descriptors provide semantic content; each modality supplies its own
layout. Ordered content uses the same sequence everywhere: web uses numbered
blocks, TUI uses a numbered list, and conversational surfaces use numbered
bullets. Grids degrade to ordered cards or text. A renderer may change spacing,
typography, and control density, but it must not change ordering, labels, or
the meaning of an action.

## Degradation ladders

Degradation removes capability before it removes meaning:

1. Render the full semantic content and interaction.
2. Render a bounded static snapshot when live transport is unavailable.
3. Render authored metadata, labels, source URIs, and accessible alternatives.
4. Render the panel's explicit placeholder; never silently blank the panel.

The ladder explains the current exceptions in `coverage.json`: TUI terminal
content is a non-interactive placeholder because a PTY has no terminal transport
there; prompt and LLM-prompt TUI views use dedicated entrypoints; and adhoc
content is owned by the host handler registry.

## Theme roles

Themes provide roles, not component-specific colors. Renderers resolve roles such
as foreground, muted metadata, accent/title, border, focus, success, warning,
and danger into their native styling systems. The TUI `Palette` and web kit
component tokens are modality-specific realizations of those roles. A new
renderer should consume theme intent through roles and retain a neutral fallback
when a role is absent.

## Source of truth

The proto definitions in `schemas/proto` remain authoritative. Panel coverage is
declared in [`conformance/coverage.json`](conformance/coverage.json), and the
public renderer inventory is declared in
[`conformance/renderer_catalog.json`](conformance/renderer_catalog.json). This
document explains the concepts those files and protos already encode; it does
not override their generated types or conformance gates.
