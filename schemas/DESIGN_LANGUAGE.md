# Meridian design language

This glossary describes the semantic vocabulary already present in the Meridian
protos. It is a rendering contract, not a proposal for new schema fields.

## Tone

`Tone` is the shared semantic vocabulary: neutral, info, success, warning,
danger, and accent, with unspecified retaining the receiving surface's default.
It describes meaning, not a literal color, operational state, or action emphasis.
Renderers map tone to their own
palette roles; producers do not provide colors. `Status.State` and
`ToolBlock.State` carry operational state, while `AffordanceStyle` carries
emphasis for an action. A renderer may combine those signals, but must preserve
the distinction between what something means and what the user can do.

`ValueTone` is deprecated but retained for existing fields, including
`EnumOption.tone`. Its numeric assignments match `Tone`, but its generated type
and `VALUE_TONE_*` JSON tokens remain unchanged. Do not change the enum type of
an existing field in place: matching wire numbers do not preserve generated
source APIs or JSON enum names. New tone-bearing fields should use `Tone`;
consumer adoption and precedence are covered by roadmap #44. The definition
alone is not the proof: the renderer and descriptor tests below establish the
stable-renderer adoption and theme conformance in #44/#45.

Conversation `Status.tone` (tag 3) and `Block.ToolBlock.tone` (tag 5) are optional
`Tone` fields. Absence preserves the legacy state-derived appearance. A present
neutral, unspecified, or unknown declaration selects neutral foreground instead
of reviving a legacy state color. All six explicit roles map to named palette
tokens in HTML/React conversation rendering, both assistant web components, and
TUI. Canonical named and numeric enum JSON are supported. The exported browser
stylesheet must be installed by the host, as before.

Tone changes semantic color, not operational state: an ERROR tool keeps its error
marker even with success Tone, and IDLE still clears a status even with danger
Tone. Browser tool markers expose their state as accessible labels and hover
text, so color is not the only way to distinguish running, OK, and ERROR.
No tone starts a tool, sends a turn, grants permission, or changes a state
transition. Existing state enum names/numbers remain intact. Descriptor-driven
tests protect field presence, unchanged legacy bytes, and old-reader unknown-field
round trips; actual Chrome colors and native terminal cells verify realization.
This is wire/JSON-additive, not a promise that exhaustive generated Rust struct
literals compile unchanged: constructors must supply `tone: None` or use an
appropriate `Default` update. Existing enum types/names and proto module paths
are unchanged; callers must still follow their generated-language migration rules.
Conversation adoption alone does not complete the Affordance/emphasis migration;
the separate action checks below cover that presentation contract. SwiftUI
remains a preview, not a full native theme/parity release gate.

The native `Palette.tone_style` maps all six shared roles to their named theme
colors. In particular, `info` and `warning` no longer collapse into accent or
bold code text. Legacy enum-option numbers adapt to this mapping without
changing their wire type or JSON names. Unspecified and unknown enum tones keep
the prior value style; explicit neutral uses ordinary foreground. A partial
theme falls back per role, and dark mode falls back to light when absent.
Wire-decoded theme and real terminal-cell color tests verify this native path;
they complement, rather than replace, the conversation/action conformance below.

The theme conformance cases in `conformance/tone_cases.ts` enumerate the generated
Tone descriptor and require the corresponding Palette field (`neutral` uses
`fg`). Hermetic Chrome tests consume these cases for HTML, Shadcn, MUI, and
web-component actions and web-component conversation states; the native action
TestBackend test independently enumerates the committed descriptor set. Expected
colors remain independent of production mappers. New roles fail until both the
palette binding and renderer expectations exist. Together these cover the six
stable renderer IDs: web-components, shared web-react, HTML, Shadcn, MUI, and TUI.
The React seam is exercised through its three concrete kits, not counted as a
fourth independent browser implementation. This is not SwiftUI view-dump proof.

## Affordance

An `Affordance` is a labeled invitation to act. Its `invoke` oneof is either a
URI or a command, and its optional icon, description, and style provide context.
`ActionPanel`, catalog items, connect-flow targets, and step actions reuse this
same primitive. Web renderers use links or buttons; TUI renders a keybinding-like
action line; non-interactive surfaces retain the label and destination as text.

`Affordance.tone` (optional tag 8) selects the shared semantic palette role;
`Affordance.emphasis` (optional tag 9) selects primary or secondary prominence.
These are independent: danger is not inherently primary, and neither field
grants permission to execute. An absent emphasis adapts legacy `style` (tag 7).
An explicitly supplied unspecified or unknown emphasis is ordinary, even when
legacy style is primary. An absent Tone preserves host styling; an explicit
unspecified or unknown Tone uses neutral. The deprecated `AffordanceStyle`
enum retains its existing numbers and field type for old readers.

The HTML, Shadcn, MUI, web-component, and TUI action paths adopt this projection.
Browser emphasis uses theme heading/body weights; native emphasis uses bold.
Semantic palette roles remain separate from emphasis. Unsafe URI admission and
exact command clipboard payloads are unchanged. Descriptor and old-reader tests
cover additive wire compatibility, not universal generated-source compatibility:
Rust exhaustive struct literals must include `tone: None, emphasis: None` or
use a default initializer. This presentation adoption completes #44 for stable
renderers; it does not prove preview SwiftUI adoption or the separate unified
invocation/schema migration in #11/#47/#48.

The proposed [unified Affordance contract](AFFORDANCE_RFC.md) inventories the
existing shapes, typed-schema dependency cycle, host admission requirements,
compatibility window, and acceptance tests. It is the design artifact for #46,
not evidence that #47's schema migration or #48's renderer adoption has landed.

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
corpus and interaction suites own that evidence. The shared-core/WASM formatter
in #50 and stable-renderer propagation proof in #51 are integrated separately,
not inferred from the existence of these fields.

The canonical formatter corpus contains 355 independent expectations, including
222 no-clock cases. Read-surface tests carry the corpus through HTML/Shadcn/MUI
and web-components using each surface's supported clock contract; native reads
use the no-clock subset. Conversation slots exercise all 18 ValueTypes on their
string-valued wire contract without numeric coercion. Constrained copy/Stat
cases retain literal copy identity and reveal state, and 1,265 typed-input/read-only
scenarios per realization preserve raw defaults, submission values, supporting
titles where available, and masked-value concealment. Native titles remain an
explicit omission without a hover channel. These are formatter adoption proofs,
not general layout or full SwiftUI parity.

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

The [layout realization contract](LAYOUT_REALIZATION.md) defines `list`,
`stacked`, `tabbed`, and `two_column` for wide/narrow browsers, terminals
(including 80 columns), compact touch surfaces, and static conversation output.
It separates required behavior from the current implementation audit: a panel
fixture does not prove a composed layout. SwiftUI's local panel preview has
initial native view-dump evidence, but general ViewDescriptor composition remains
unverified and is not a v1 release gate under the documented preview scope.

## Degradation ladders

Degradation removes capability before it removes meaning:

1. Render the full semantic content and interaction.
2. Render a bounded static snapshot when live transport is unavailable.
3. Render authored metadata, labels, source URIs, and accessible alternatives.
4. Render the panel's explicit placeholder; never silently blank the panel.

The ladder explains the current exceptions in `coverage.json`: TUI terminal
content is a non-interactive placeholder because a PTY has no terminal transport
there, and adhoc content is owned by the host handler registry. Prompt and
LLM-prompt panels now render through native `PanelView`, with typed response
collection; they are not separate-entrypoint exceptions. Native composed-view
layout remains a separate requirement from those panel-level proofs.

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

## Complete vocabulary and modality profiles

The authored mappings below name every enum and explicit oneof in
`schemas/proto`, including transport choices that are not widgets. A profile
states the semantic degradation contract once; its assigned concepts retain
their specific meaning, raw values, and proto-defined defaults. These are
requirements, not claims of implemented parity. In particular, SwiftUI's local
preview does not establish full native parity; its unverified coverage remains
explicit. The layout audit distinguishes the native composed host, passive
conversation projection, fixture-owned rich adapter, and their remaining limits.

Tone and emphasis remain independent. A numeric enum value is not a palette
index. Operational state is not a new Tone field, and a styling hint does not
grant permission to execute an action. Theme-role names below refer to semantic
roles (foreground, muted, accent, border, focus, success, warning, danger), not
literal colors. A role absent from the current theme schema uses the receiving
surface's compatible fallback; this table does not add a field or change an
existing enum's wire/JSON type.

### Profile: emphasis

- Web: semantic emphasis plus readable text/icon; color cannot be the only signal.
- Native/SwiftUI target: map roles to available native styles; retain the label
  when color, weight, or animation is unavailable.
- Conversation/static: retain meaning in words, not ANSI color or a transient
  visual alone. Unspecified preserves the receiving surface's existing default.

### Profile: values

- Web: shared formatted label and supporting title where supported; route only
  through the host resolver. Editing/submission retains the raw value.
- Native/SwiftUI target: the same label and declared precision; expose supporting
  text where possible, otherwise omit decoration rather than alter the value.
- Conversation/static: readable inline text or labeled fields. Preserve literal
  text for unsupported future types and do not invent routes or entity lookups.
  Legacy absence/precedence follows each original field's proto contract.

### Profile: actions

- Web: labeled link/button/menu at its declared placement; execution passes the
  host's admission boundary. Retain pending, failure, retry, and unavailable copy.
- Native/SwiftUI target: native controls or explicit key-driven choices with the
  same label, destination, and confirmation meaning; never execute on render.
- Conversation/static: show the label and safe destination/command as text when
  interaction is unavailable. A displayed command is not execution authority.

### Profile: layout

- Web: preserve slot identity and ordered groups while reflowing; tabs retain
  persistent regions and accessible selection.
- Native/SwiftUI target: follow the [four-mode realization table](LAYOUT_REALIZATION.md),
  including main-then-sidebar at 80 terminal columns and reachable compact tabs.
- Conversation/static: labeled ordered sections, expanding tab contents rather
  than silently retaining only the first tab. Do not count panel-only fixtures
  as evidence that a view composition host exists.

### Profile: collections

- Web: rows/cards/tree choices with visible labels, selection, empty/error states,
  and accessible paging where relevant. Keep order and identifiers stable.
- Native/SwiftUI target: native lists or key-navigable rows with the same items;
  a grid may become a list, and a route may remain a labeled unresolved target.
- Conversation/static: ordered or bulleted labeled items, with page/continuation
  information when known; do not imply that a partial snapshot is the full set.

### Profile: input

- Web: typed controls and shared validation before host callbacks; preserve raw
  tokens, false, zero, empty text, recursive object/array structure, and errors.
- Text and masked patterns: [Rust Unicode regex semantics](FORM_PATTERNS.md),
  executed by the same native/WASM core. Unsupported patterns fail closed;
  browser-only lookaround/backreferences require migration, not a JS fallback.
- Native/SwiftUI target: native or key-driven typed editing; unsupported editing
  must be visible and must not fabricate a submitted value. Read-only stays read-only.
- Conversation/static: show a labeled request or read-only value and the supported
  response path. Never treat rendering a prompt or confirmation as user consent.
  Masked values remain concealed unless the user explicitly reveals them.

### Profile: visuals

- Web: native chart/media or a host grammar renderer; retain caption, alternatives,
  source provenance, and meaningful failure states. Signals exist only when live.
- Native/SwiftUI target: supported native visualization, then bounded snapshot,
  value summary/alternative, then readable source metadata. For media, keep chapter
  labels even where seeking/playback is unavailable.
- Conversation/static: alternative text, named values/table, caption, or authored
  source in that order as applicable. Unknown grammar does not execute a new DSL.
  The specific ladders in grammar/media/chart protos take precedence over decoration.

### Profile: conversation

- Web: ordered append/replace by block ID and explicit live/tool/turn state. A
  spinner is supplementary; failures and final state remain readable.
- Native/SwiftUI target: the same durable blocks and state labels without requiring
  animation; composed `view` content needs a real host, not a fabricated snapshot.
- Conversation/static: retain durable block order, tool result/error text, and turn
  failure information. Transient thinking state is not a new transcript block;
  unknown events must not fabricate completion or silently authorize a tool.

### Profile: bindings

- Web: resolve only declared runtime sources at activation; omit an unset selection
  source and preserve admission. Bindings themselves are not user-facing controls.
- Native/SwiftUI target: resolve sources the host actually supplies; missing live
  signals remain unavailable, never replaced by guessed context or identity.
- Conversation/static: show action intent where appropriate, but do not invent a
  runtime source or execute a call just to produce explanatory text.

### Profile: stream

- Web: live ordered lines while transport is available; follow only while the
  reader remains at the bottom, or hold position under manual follow mode.
- Native/SwiftUI target: native live stream where supported, otherwise bounded
  labeled snapshot/placeholder. Reader navigation takes precedence over auto-scroll.
- Conversation/static: ordered bounded output with snapshot/availability context;
  do not represent a static capture as a live or complete stream.

### Profile: panels

- Web: dispatch the authored panel arm to its kit/host seam, preserving title and
  action meaning. Unknown/unset arms need visible fallback, not a blank success.
- Native/SwiftUI target: realize the arm's own degradation ladder from
  [panel.proto](proto/panel.proto); host-owned adhoc/transport capabilities remain
  explicit. The [coverage manifest](conformance/coverage.json) records actual proof.
- Conversation/static: retain the arm's named semantic content using its declared
  ladder. This broad dispatch profile does not override specialized terminal,
  media, grammar, or composed-view limitations.

## Named concept mappings

This is the authored interpretation. The generated inventory checks an exact
one-to-one match with compiled declarations; adding, removing, or renaming a
scope requires updating its concept as well as regenerating the table.

<!-- concepts:start -->
| Proto scope | Named concept | Tone / theme roles | Modality profile |
|---|---|---|---|
| `meridian.ui.v1.ActionPlacement` | Action location and prominence: primary, row, header, overflow | Placement is not Tone; foreground/accent/focus identify a reachable action. | `actions` |
| `meridian.ui.v1.Emphasis` | Action prominence: primary or secondary, independent of location and execution | Primary strengthens weighting; Tone independently selects a semantic palette role. Presence overrides legacy AffordanceStyle without granting a capability. | `actions` |
| `meridian.ui.v1.ActionStyle` | Resource lifecycle action emphasis, including destructive intent | Default/primary set prominence; danger retains its warning meaning and label, not color alone. | `actions` |
| `meridian.ui.v1.Affordance.invoke` | Static destination or command invitation | No intrinsic Tone; foreground/accent/focus plus authored label. URI/command capability stays host-owned. | `actions` |
| `meridian.ui.v1.AffordanceStyle` | Primary versus secondary action emphasis | Prominence is independent of Tone; compatible accent/foreground/border/focus styling. | `actions` |
| `meridian.ui.v1.Block.kind` | Durable conversational content unit | Context uses muted metadata; code uses code styling; content/state retain their own roles. | `conversation` |
| `meridian.ui.v1.Block.ToolBlock.State` | Tool execution phase and result | Running is informational, OK successful, ERROR failure; retain state text alongside info/success/danger styles. | `conversation` |
| `meridian.ui.v1.CatalogStyle` | Browsable collection density: cards or list | Neutral content with accent/focus on available actions; arrangement adds no success/failure meaning. | `collections` |
| `meridian.ui.v1.ChartMark` | Quantitative shape: line, area, bar, point, or summary | Series/foreground/border roles distinguish data; a mark is not an operational Tone. | `visuals` |
| `meridian.ui.v1.ChoiceStyle` | Presentation of one bounded selection | Neutral options with selected accent/focus; preserve submitted tokens regardless of widget style. | `input` |
| `meridian.ui.v1.Column` | Main versus supporting content region | Structural foreground/border roles only; sidebar is not a lower-priority data value. | `layout` |
| `meridian.ui.v1.ColumnFormat` | Legacy table-value reading convention | No intrinsic Tone; foreground/muted/code styles follow meaning, with existing formatting precedence. | `values` |
| `meridian.ui.v1.Command.action` | Admitted RPC or host navigation intent | Label, accent/focus, and explicit unavailable/error feedback; no implicit permission from a palette entry. | `actions` |
| `meridian.ui.v1.ContextSource` | Host-supplied resource or UI identity input | No visual role of its own; do not render or invent identity as decoration. | `bindings` |
| `meridian.ui.v1.ConversationEvent.event` | Turn progression: content, live status, completion, failure | Ordinary content retains its roles; explicit error uses danger/readable error text, not a fake successful end. | `conversation` |
| `meridian.ui.v1.EncodingType` | Meaning of a chart dimension: time, quantity, category, order | Labels/scales convey the meaning; series/accent styling must not substitute for type. | `visuals` |
| `meridian.ui.v1.FieldBinding.source` | Declared source of an RPC request value | No widget or Tone of its own; focus/error feedback belongs to the invoking control. | `bindings` |
| `meridian.ui.v1.FollowMode` | Reader-controlled stream following | Neutral stream/metadata and focus roles; follow state does not signal success or failure. | `stream` |
| `meridian.ui.v1.FormField.kind` | Typed value collection, including compound objects, arrays, and maps | Neutral control, focus, and explicit validation error roles; masked is privacy, not danger. | `input` |
| `meridian.ui.v1.FormMode` | Read-only versus editable field presentation | No new Tone or mutation authority; disabled/read-only styles retain legible values. | `input` |
| `meridian.ui.v1.GrammarLanguage` | Authored declarative content language | Content/foreground/code roles with authored alternatives; language is not executable host authority. | `visuals` |
| `meridian.ui.v1.Layout.mode` | Ordered composition: list, stack, tabs, main/sidebar | Structure uses spacing/border/foreground; focused or selected controls retain their own roles. | `layout` |
| `meridian.ui.v1.MediaKind` | Time-based or still medium | Neutral player/content roles, readable caption/alternative, and explicit unavailable feedback. | `visuals` |
| `meridian.ui.v1.NavNode.target` | Addressable navigation leaf, distinct from expandable group | Foreground/accent/focus for current/reachable destination; unresolved destination remains labeled. | `collections` |
| `meridian.ui.v1.PaginationMode` | Complete client set versus offset/cursor retrieval | Neutral rows, continuation metadata, and focus/error roles; paging adds no domain Tone. | `collections` |
| `meridian.ui.v1.PanelDescriptor.body` | Semantic panel shape dispatched through a renderer seam | The selected arm owns value/state/action roles; fallback retains a readable title and reason. | `panels` |
| `meridian.ui.v1.PrincipalDisplay` | Person/agent label with optional email context | Foreground label, muted supporting email/title, optional host-owned link emphasis. | `values` |
| `meridian.ui.v1.RepeatedField.element` | Positional scalar or object row in a typed collection | Neutral/focus/error roles; scalar IDs are positional, object child IDs identify properties. | `input` |
| `meridian.ui.v1.Status.State` | Transient idle, thinking, or working phase | Activity may use info/accent and readable detail; idle is not proof of success. | `conversation` |
| `meridian.ui.v1.TemporalDisplay` | Absolute versus relative time reading | Foreground label with supporting title where available; relative wording is not urgency Tone. | `values` |
| `meridian.ui.v1.TemporalPrecision` | Declared calendar/time granularity | No intrinsic Tone; preserve meaningful precision rather than invent seconds or a time zone. | `values` |
| `meridian.ui.v1.Tone` | Shared semantic emphasis independent of state/action prominence | Explicit neutral/info/success/warning/danger/accent map to named roles; unspecified preserves the receiver default. | `emphasis` |
| `meridian.ui.v1.Trend` | Direction of a numeric change, not desirability | No intrinsic Tone; preserve legacy trend styling while keeping direction distinct from a domain success claim. | `values` |
| `meridian.ui.v1.ValueDisplay.options` | Meaning-specific formatting policy | Same value roles; temporal/number/principal options do not replace raw values or authorize links. | `values` |
| `meridian.ui.v1.ValueFormat` | Legacy KPI magnitude/percent/currency reading | Neutral value roles plus the Stat's separate trend; shared numeric display precedence remains additive. | `values` |
| `meridian.ui.v1.ValueTone` | Legacy value-only semantic emphasis | Compatible role vocabulary; preserve VALUE_TONE JSON names and existing field types during migration. | `emphasis` |
| `meridian.ui.v1.ValueType` | Semantic kind of a readable value | Label/code/metadata/link roles follow declared meaning; enum-option Tone is separate from formatting. | `values` |
| `meridian.ui.v1.ViewKind` | Collection view versus one-record detail context | Structural foreground and header roles; list/detail is not an action capability or Tone. | `layout` |
<!-- concepts:end -->

## Generated proto inventory

Run `node schemas/tools/design_vocabulary.mjs --write` after a schema change;
`--check` compiles current sources and rejects missing/stale mappings or member
tables. Compiler-synthetic optional-presence oneofs are excluded, but explicit
oneofs and nested enums are included. This gate checks completeness/freshness,
not semantic quality, compatibility, accessibility, or renderer conformance.

<!-- vocabulary:start -->
Generated from the current compiled proto sources; numbers are wire identities, not display order.

| Scope | Kind | Declared members |
|---|---|---|
| [`meridian.ui.v1.ActionPlacement`](proto/view.proto) | enum | `ACTION_PLACEMENT_UNSPECIFIED=0`, `ACTION_PLACEMENT_PRIMARY=1`, `ACTION_PLACEMENT_ROW=2`, `ACTION_PLACEMENT_HEADER=3`, `ACTION_PLACEMENT_OVERFLOW=4` |
| [`meridian.ui.v1.ActionStyle`](proto/resource_card.proto) | enum | `ACTION_STYLE_UNSPECIFIED=0`, `ACTION_STYLE_DEFAULT=1`, `ACTION_STYLE_PRIMARY=2`, `ACTION_STYLE_DANGER=3` |
| [`meridian.ui.v1.Affordance.invoke`](proto/affordance.proto) | oneof | `uri=5`, `command=6` |
| [`meridian.ui.v1.AffordanceStyle`](proto/affordance.proto) | enum | `AFFORDANCE_STYLE_UNSPECIFIED=0`, `AFFORDANCE_STYLE_PRIMARY=1`, `AFFORDANCE_STYLE_SECONDARY=2` |
| [`meridian.ui.v1.Block.kind`](proto/conversation.proto) | oneof | `markdown=3`, `context=4`, `tool=5`, `list=6`, `fields=7`, `code=8`, `divider=9`, `table=10`, `view=11` |
| [`meridian.ui.v1.Block.ToolBlock.State`](proto/conversation.proto) | enum | `RUNNING=0`, `OK=1`, `ERROR=2` |
| [`meridian.ui.v1.CatalogStyle`](proto/catalog.proto) | enum | `CATALOG_STYLE_UNSPECIFIED=0`, `CATALOG_STYLE_GRID=1`, `CATALOG_STYLE_LIST=2` |
| [`meridian.ui.v1.ChartMark`](proto/chart.proto) | enum | `CHART_MARK_UNSPECIFIED=0`, `CHART_MARK_LINE=1`, `CHART_MARK_AREA=2`, `CHART_MARK_BAR=3`, `CHART_MARK_POINT=4`, `CHART_MARK_STAT=5` |
| [`meridian.ui.v1.ChoiceStyle`](proto/choice.proto) | enum | `CHOICE_STYLE_UNSPECIFIED=0`, `CHOICE_STYLE_SEGMENTED=1`, `CHOICE_STYLE_LIST=2`, `CHOICE_STYLE_DROPDOWN=3` |
| [`meridian.ui.v1.Column`](proto/view.proto) | enum | `COLUMN_UNSPECIFIED=0`, `COLUMN_MAIN=1`, `COLUMN_SIDEBAR=2` |
| [`meridian.ui.v1.ColumnFormat`](proto/table.proto) | enum | `COLUMN_FORMAT_UNSPECIFIED=0`, `STRING=1`, `FLOAT_2DP=2`, `INTEGER=3`, `ENUM_NAME=4`, `STRING_LIST=5`, `TIMESTAMP=6` |
| [`meridian.ui.v1.Command.action`](proto/command_palette.proto) | oneof | `rpc=8`, `open_panel=9`, `open_view_id=10`, `navigate=11` |
| [`meridian.ui.v1.ContextSource`](proto/rpc.proto) | enum | `CONTEXT_SOURCE_UNSPECIFIED=0`, `CURRENT_RESOURCE_PATH=1`, `UI_IDENTITY=2` |
| [`meridian.ui.v1.ConversationEvent.event`](proto/conversation.proto) | oneof | `block=2`, `status=3`, `done=4`, `error=5` |
| [`meridian.ui.v1.Emphasis`](proto/affordance.proto) | enum | `EMPHASIS_UNSPECIFIED=0`, `EMPHASIS_PRIMARY=1`, `EMPHASIS_SECONDARY=2` |
| [`meridian.ui.v1.EncodingType`](proto/chart.proto) | enum | `ENCODING_TYPE_UNSPECIFIED=0`, `ENCODING_TYPE_TEMPORAL=1`, `ENCODING_TYPE_QUANTITATIVE=2`, `ENCODING_TYPE_NOMINAL=3`, `ENCODING_TYPE_ORDINAL=4` |
| [`meridian.ui.v1.FieldBinding.source`](proto/rpc.proto) | oneof | `context=2`, `row_field=3`, `form_field=4`, `literal=5`, `nested=6`, `signal=7`, `selection_key=8` |
| [`meridian.ui.v1.FollowMode`](proto/stream.proto) | enum | `FOLLOW_MODE_UNSPECIFIED=0`, `FOLLOW_MODE_FOLLOW=1`, `FOLLOW_MODE_MANUAL=2` |
| [`meridian.ui.v1.FormField.kind`](proto/form.proto) | oneof | `integer=4`, `text=5`, `enum_selection=6`, `masked=7`, `boolean=9`, `number=10`, `nested=11`, `repeated=12`, `key_value_map=14` |
| [`meridian.ui.v1.FormMode`](proto/panel.proto) | enum | `FORM_MODE_UNSPECIFIED=0`, `FORM_MODE_READONLY=1`, `FORM_MODE_EDIT=2` |
| [`meridian.ui.v1.GrammarLanguage`](proto/grammar.proto) | enum | `GRAMMAR_LANGUAGE_UNSPECIFIED=0`, `GRAMMAR_LANGUAGE_MARKDOWN=1`, `GRAMMAR_LANGUAGE_MERMAID=2`, `GRAMMAR_LANGUAGE_PLANTUML=3`, `GRAMMAR_LANGUAGE_GRAPHVIZ=4`, `GRAMMAR_LANGUAGE_VEGA_LITE=5`, `GRAMMAR_LANGUAGE_VEGA=6` |
| [`meridian.ui.v1.Layout.mode`](proto/view.proto) | oneof | `list=1`, `stacked=2`, `tabbed=3`, `two_column=4` |
| [`meridian.ui.v1.MediaKind`](proto/media.proto) | enum | `MEDIA_KIND_UNSPECIFIED=0`, `MEDIA_KIND_VIDEO=1`, `MEDIA_KIND_AUDIO=2`, `MEDIA_KIND_IMAGE=3` |
| [`meridian.ui.v1.NavNode.target`](proto/nav_tree.proto) | oneof | `panel_id=4`, `view_id=5`, `route=9` |
| [`meridian.ui.v1.PaginationMode`](proto/table.proto) | enum | `PAGINATION_MODE_UNSPECIFIED=0`, `PAGINATION_MODE_CLIENT=1`, `PAGINATION_MODE_OFFSET=2`, `PAGINATION_MODE_CURSOR=3` |
| [`meridian.ui.v1.PanelDescriptor.body`](proto/panel.proto) | oneof | `table=3`, `lro=4`, `adhoc=5`, `prompt=6`, `llm_prompt=7`, `gallery=8`, `form=9`, `choice=10`, `snippet=11`, `action=12`, `connect_flow=13`, `copy_value=14`, `catalog=15`, `terminal=16`, `grammar=17`, `stat=18`, `detail_header=19`, `record_card=20`, `steps=21`, `media=22`, `stream=23`, `resource_cards=24`, `chart=25` |
| [`meridian.ui.v1.PrincipalDisplay`](proto/value.proto) | enum | `PRINCIPAL_DISPLAY_UNSPECIFIED=0`, `PRINCIPAL_DISPLAY_NAME=1`, `PRINCIPAL_DISPLAY_EMAIL=2`, `PRINCIPAL_DISPLAY_NAME_WITH_EMAIL_TITLE=3` |
| [`meridian.ui.v1.RepeatedField.element`](proto/form.proto) | oneof | `scalar=1`, `object=2` |
| [`meridian.ui.v1.Status.State`](proto/conversation.proto) | enum | `STATE_UNSPECIFIED=0`, `IDLE=1`, `THINKING=2`, `WORKING=3` |
| [`meridian.ui.v1.TemporalDisplay`](proto/value.proto) | enum | `TEMPORAL_DISPLAY_UNSPECIFIED=0`, `TEMPORAL_DISPLAY_ABSOLUTE=1`, `TEMPORAL_DISPLAY_RELATIVE=2`, `TEMPORAL_DISPLAY_RELATIVE_WITH_ABSOLUTE_TITLE=3` |
| [`meridian.ui.v1.TemporalPrecision`](proto/value.proto) | enum | `TEMPORAL_PRECISION_UNSPECIFIED=0`, `TEMPORAL_PRECISION_DAY=1`, `TEMPORAL_PRECISION_MINUTE=2`, `TEMPORAL_PRECISION_SECOND=3` |
| [`meridian.ui.v1.Tone`](proto/value.proto) | enum | `TONE_UNSPECIFIED=0`, `TONE_NEUTRAL=1`, `TONE_INFO=2`, `TONE_SUCCESS=3`, `TONE_WARNING=4`, `TONE_DANGER=5`, `TONE_ACCENT=6` |
| [`meridian.ui.v1.Trend`](proto/stat.proto) | enum | `TREND_UNSPECIFIED=0`, `TREND_UP=1`, `TREND_DOWN=2`, `TREND_FLAT=3` |
| [`meridian.ui.v1.ValueDisplay.options`](proto/value.proto) | oneof | `temporal=2`, `number=3`, `principal=4` |
| [`meridian.ui.v1.ValueFormat`](proto/stat.proto) | enum | `VALUE_FORMAT_UNSPECIFIED=0`, `VALUE_FORMAT_NUMBER=1`, `VALUE_FORMAT_PERCENT=2`, `VALUE_FORMAT_CURRENCY=3`, `VALUE_FORMAT_COMPACT=4`, `VALUE_FORMAT_PLAIN=5` |
| [`meridian.ui.v1.ValueTone`](proto/value.proto) | enum | `VALUE_TONE_UNSPECIFIED=0`, `VALUE_TONE_NEUTRAL=1`, `VALUE_TONE_INFO=2`, `VALUE_TONE_SUCCESS=3`, `VALUE_TONE_WARNING=4`, `VALUE_TONE_DANGER=5`, `VALUE_TONE_ACCENT=6` |
| [`meridian.ui.v1.ValueType`](proto/value.proto) | enum | `VALUE_TYPE_UNSPECIFIED=0`, `VALUE_TYPE_TEXT=1`, `VALUE_TYPE_MULTILINE_TEXT=2`, `VALUE_TYPE_INTEGER=3`, `VALUE_TYPE_DECIMAL=4`, `VALUE_TYPE_BOOLEAN=5`, `VALUE_TYPE_ENUM=6`, `VALUE_TYPE_LIST=7`, `VALUE_TYPE_DATE=8`, `VALUE_TYPE_DATE_TIME=9`, `VALUE_TYPE_TIME=10`, `VALUE_TYPE_DURATION=11`, `VALUE_TYPE_PRINCIPAL=12`, `VALUE_TYPE_EMAIL=13`, `VALUE_TYPE_URL=14`, `VALUE_TYPE_IDENTIFIER=15`, `VALUE_TYPE_MONEY=16`, `VALUE_TYPE_PERCENT=17`, `VALUE_TYPE_JSON=18` |
| [`meridian.ui.v1.ViewKind`](proto/view.proto) | enum | `VIEW_KIND_UNSPECIFIED=0`, `VIEW_KIND_LIST=1`, `VIEW_KIND_DETAIL=2` |

**27 enums and 11 explicit oneofs; 38 named-concept mappings.**
<!-- vocabulary:end -->
