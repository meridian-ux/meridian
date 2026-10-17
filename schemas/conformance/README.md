# Renderer conformance

## Stateful ViewDescriptor corpus

`fixtures/<arm>/` contains empty, typical, and overflow `ViewDescriptor` cases
for every current panel arm, each with a `.view.binpb` and reviewable `.view.txtpb`
twin. Companion `.responses.binpb` / `.responses.txtpb` files are canonical
`google.protobuf.Struct` messages, keyed by RPC service/method. They carry real
empty or populated responses rather than substituting a different fixture in
each renderer. `__streamFrames` supplies structured snapshot events to the
host's existing protobuf StreamFrame seam. No JSON-only transport DTO is added.

There are also all 29 value cases from `value_types.json` through each of five
unrestricted read arms (`panelArms`): table, record_card, detail_header, gallery,
and resource_cards. The corpus has 427 cases total, including nulls,
invalid declarations, and unknown types. HTML, shadcn, MUI, and web-components load these
exact wire messages, render `ViewRenderer`, resolve the shared responses through
their invokers, and compare committed semantic DOM goldens. Explicit assertions
check populated/empty tables, formatter outputs, and bounded stream tails.
Web-components runs these views through `renderView` and the actual compiled
WASM bridge (441 tests including the earlier 14 core-boundary checks). Its
stream goldens deliberately select the plain-DOM fallback; Terminal uses real
xterm with a non-network test socket, not a live PTY. Both resources are disposed
after every case. Form prefill waits for loading to finish and checks live input
values separately, because the DOM normalizer preserves attributes, not all
mutable control properties.
Prompt fixtures now declare a real text kind and empty/typical/overflow defaults.
All four browser realizations submit these wire values to the host and assert
canonical protobuf Struct responses after their initial-state snapshots. A
shared protobuf interaction fixture additionally covers all nine input kinds,
confirmation/cancellation, callback failure/retry, and stale response isolation.
`input_values.binpb` and its readable text twin supply 27 typed input/default
cases through Form, Prompt, LRO, and LLM-prompt, plus read-only Form: 135 views.
The canonical protobuf Struct index covers every declared ValueType, unknown and
invalid declarations, all nine input kinds, false/zero/empty values, multiline
text, leading-zero strings, and masked defaults. Consumers assert live raw
control values and exact collected requests/protobuf responses before comparing
snapshots; declared read-only formatting and secret concealment are separate
assertions. LLM-prompt previews remain local. LRO fixtures verify start inputs,
not complete polling/results in every kit; reference kits and MUI still need
that broader lifecycle work. Default expansion is bounded before DOM allocation
in the DOM LRO path and before native Form/LRO collection.
The presence gate requires every arm/state and formatter case; removing just an
overflow snapshot now fails even when that arm's initial snapshot still exists.

The native consumer decodes the same 427 views and protobuf Struct responses,
extracts each view's single panel, and drives the real `PanelView` RPC/stream
seams. It compares 854 terminal-buffer goldens under `native/` at 96×28 and
40×10, with explicit fetched-content, formatter, repeated-form-count, stream-tail,
and cancellation checks. This covers native panel dispatch, not a general view
layout tier. Prompt/LLM-prompt are owned by `PanelView`, with separate wire-decoded
dispatcher interaction tests for typed responses and local previews. Terminal
remains a web-specific surface.
Table rows and headers now reserve their declared multiline text height; the
corpus and a focused regression verify lines and following records aren't lost.
Native paragraphs also expand embedded newlines into real styled terminal
lines, preserving blank lines and following spans rather than joining words.
All gallery/card display slots are checked, including null placeholders.
Native DetailHeader and RecordCard values share a column sized to the widest
label using terminal display cells, including CJK and combining characters.
Explicit multiline value continuations retain that column. A focused TestBackend
regression checks both panels and the RecordCard field-ID fallback.

The unrestricted arm list is verified against reachable ValueDisplay fields in
the canonical descriptor set, with explicit exceptions for constrained payloads
and form input/default semantics. `constrained_value_types.json` supplies 26
string cases each for CopyValue/ConnectFlow and 26 numeric Stat cases, including
every declared ValueType, invalid/unknown declarations, and precision edges.
Raw values retain their canonical string/double field types. Copy metadata or
jsdom clipboard assertions preserve the original string, including empty strings
and leading zeros, independently of visible formatting. Native copy behavior
remains host-owned; these buffers do not claim a real clipboard integration.

These cases exposed and fixed string booleans being coerced by truthiness,
empty declared strings diverging between languages, and ConnectFlow endpoint
newlines being joined in native output. Stat now populates through each host's
invoker, caches native data until invalidation, and shares strict numeric-field
resolution plus the schema-defined display override. Computed delta/direction
do not trust server trend metadata. React guards late responses, changed
descriptors/requests/transports, and failures. Dedicated lifecycle tests cover
those paths; the hook also resolves nested bindings from repeated-view records.
Legacy Stat labels preserve their existing epsilon-assisted two-place rounding
while scaled cents remain exact binary64 integers. Larger magnitudes use the
shared exact fixed-decimal formatter without an integer cast or scaling overflow;
grouping, percent suffixes (no ratio conversion), currency, and compact suffixes
retain their legacy meanings. Native and default-WASM vectors cover large signed
values, fractional ties, and non-finite values; the latter retain explicit core
spellings (`inf`, `-inf`, `NaN`) rather than fabricating zero. Browser checks also
compare the largest finite binary64 integer against an independent BigInt
conversion, and a DOM regression verifies the visible value and computed delta.
Form/Prompt/LRO/LLM-prompt typed input/default cases now have their own wire
fixtures rather than coercing read-only payloads. Native Form/LRO inputs validate through
the platform-neutral core before returning host-owned requests, with focused
wire tests for all nine input kinds, compound JSON editors, invalid/recovering
values, read-only immutability, descriptor replacement, and empty forms. Legacy
prompt validation and regex-dialect consolidation remain separate work.

Compare or intentionally re-record native buffers from the source workspace:

```sh
bazel test --announce_rc=false //crates/tui/rust/tui:stateful_conformance_test
node schemas/tools/conformance_snapshots.mjs --native --update
```

The recorder requires Bazel's explicit source workspace path before writing,
never writes through runfiles, and does not delete unexpected goldens. The
normal comparison path fails on missing, changed, or extra goldens. The default
Node presence gate independently requires both viewport files for every case.

Generate or verify deterministically with the pinned protobuf runtime:

Before comparing or recording, the generator checks a complete, non-overlapping
partition of every value-bearing panel arm into its natural read, constrained
string/number, or input/default family. Every family must cover every declared
ValueType, and input cases must cover every declared FormField kind. Invalid
coverage fails before writing even the input index. These inventory checks do
not substitute for renderer execution, accessibility, or layout evidence.

```sh
python3 -m pip install -r tools/conformance_requirements.txt
python3 tools/stateful_corpus.py --write  # deliberate update; review all twins
python3 tools/stateful_corpus.py          # read-only freshness check used in CI
python3 -m unittest tools/test_stateful_corpus.py
```

The existing `UPDATE_SNAPSHOTS=1` re-record path includes the stateful suite.
Binary/text equivalence, missing files, changed content, and unexpected files
are tested; the updater refuses to delete unexpected files automatically.
The original panel corpus remains intact for native and existing browser users.

This expands real coverage but does not complete the conformance epic: the
stateful wire corpus does not replace broader interaction, overflow, and layout
acceptance criteria. Computed browser accessibility trees have a separate gate
below; the semantic DOM normalizer is not relabeled as that evidence. SwiftUI
preview behavior remains explicitly unverified.

## Shared composed-view corpus

`layout/` contains fourteen canonical `ViewDescriptor` cases, protobuf `Struct`
context/response twins, and a protobuf expectation index. The in-memory authoring
objects are validated against the committed descriptor set; no alternate layout
schema is maintained. All four modes, stable ties, headers, advisory roles,
unknown columns, unset/future modes, nested/repeated views, authored action labels,
and missing/null/empty/false/zero/open selection gates are included.

HTML, shadcn, MUI, web-components through actual WASM, and the real native ViewHost
consume the same bytes. Tests assert slot/content ordering, manual tab activation,
visible placeholders, read counts, and repeated raw names. Native tests run at
80/140 columns. This is semantic/navigation proof, not browser geometry or
conversation integration. Static headers/cards must retain authored titles and
labels even without a populate RPC; missing values remain unavailable and no RPC
is invented. Scope gates stay closed for falsey selections; raw bindings still
retain false, zero, and empty strings.

```sh
python3 tools/layout_corpus.py --write  # deliberate update; review binary/text twins
python3 tools/layout_corpus.py          # CI freshness check
python3 -m unittest tools/test_layout_corpus.py
```

The future-mode case carries unknown Layout tag5 in its binary and readable
unknown-field projection. Only the binary is round-trip authoritative for that
future arm: the current text parser cannot parse a field it does not declare.
All other binary/text twins are checked for canonical equivalence. The updater
rejects unexpected files without deleting them.

## Computed browser accessibility trees

`ax/<kit>/<arm>/<case>.txt` records Chrome's actual accessibility tree for all
427 canonical wire cases in HTML, shadcn, MUI, and web-components: 1,708 trees.
The hermetic Chrome target loads the real compiled WASM bridge for web-components
and the same ViewDescriptor/Struct bytes as the other consumers. RPC responses
and Terminal's socket are local test transports; this is not a live PTY test.

The harness uses the DevTools Protocol's
[`Accessibility.getFullAXTree`](https://raw.githubusercontent.com/ChromeDevTools/devtools-protocol/master/pdl/domains/Accessibility.pdl).
`normalize_ax.cjs` preserves computed roles, names, descriptions, values, widget
states, and hierarchy. It discards backend/node IDs, transient focus, inline text
layout boxes, and empty layout wrappers. Ignored nodes do not become accessible
content; their exposed descendants remain. Duplicate/cyclic/missing tree nodes
fail, and unnamed interactive controls fail rather than being filtered out.

The fixture environment is explicit: 1100×800, English, UTC, reduced motion,
unavailable external assets. Lazy images are requested eagerly for this test so
offscreen frames share that condition. Media waits for its real player → poster
→ text failure ladder to finish before capture; Steps may retain native broken
images with accessible alternative text. This does not prove successful playback,
production transport behavior, keyboard order, contrast, or full WCAG compliance.
Native buffer normalization and SwiftUI evidence remain separate.

```sh
bazel test --announce_rc=false //packages/mui-kit:computed_accessibility_test
bazel run --announce_rc=false //packages/mui-kit:record_computed_accessibility
node --test schemas/tools/normalize_ax.test.mjs
```

Recording requires Bazel's explicit source workspace, never a runfiles directory.
Normal verification is read-only and rejects missing, changed, or extra goldens;
the test target explicitly overrides any inherited writer flag to zero.
unexpected files are never deleted. The target runs under the existing `//...`
CI gate. The original semantic DOM goldens are retained, not relabeled as computed
accessibility evidence. The first real-tree audit exposed unnamed empty copy
controls and repeated scalar inputs; their labels were fixed in the renderers.

## External conversation consumer

The catalog tracks the private `meridian-internal` playground as a development
consumer of the conversation modality, not a new public panel-renderer package.
Its eight primitive Block kinds use the pinned published Conversation renderer;
View is explicitly `separate-entrypoint` because it delegates through a transcript
chip to the composed canvas. These rows do not establish current-source renderer
parity or change any SwiftUI verification status.

Internal issue #21 owns its producer-to-renderer evidence: all nine canonical
Block fixtures have protobuf binary and proto3-JSON twins, and the playground CI
gate starts the actual local host, emits each fixture through authenticated
HTTP/SSE, checks its rendered output, and compares committed computed
accessibility goldens (including the composed canvas for View). Fixture mode is
explicit and default-off; it does not invoke models or MCP backends. The private
gate owns execution evidence; the public catalog/coverage gates enforce complete
declarations and explicit delegation rather than claiming to execute private code.

## Native and WASM core fixtures

`core.proto` defines the test-only envelope for `core.json`. Its 264 cases cover
field paths, request bindings, tables, galleries, LRO status text, and stateful
payload budgets. Descriptor inputs are actual protobuf wire bytes. Native Rust
and the real wasm-bindgen bridge compare their outputs with the same committed
expectations, including false/zero preservation, plain JavaScript objects,
missing data, and invalid clocks. Both WASM table entrypoints also consume all
29 `value_types.json` cases already used by the native formatter, including
each case's null fallback. These tests cover the exported core bridge, not DOM
layout or every renderer interaction.

The precision matrix covers every TemporalPrecision and an unknown fallback for
DATE, DATE_TIME, and TIME, including midnight, absent seconds, and date-only
inputs. Explicit minute/second precision retains midnight, and second precision
retains timestamp seconds in both visible text and relative supporting titles.
DATE remains calendar-only; a date-only input does not acquire an invented time.

Numeric cases cover default grouping, explicit grouping suppression, K/M/B/T
compact magnitudes, currency-code prefixes, percentage ratios, fixed rounding,
large/small scalars, invalid precision, and literal numeric-looking strings.
All NumberOptions fields have an inventory gate. The historical fixture name
`percent-current-scalar` is retained to avoid churning fixture identities, but
its expected value now correctly represents the ratio as `12.500%`.
These semantic corrections intentionally update percentage render goldens and
native whole-number labels (`42`, not a JSON floating-point artifact `42.0`).
Raw values, clipboard values, and submitted inputs are unchanged.

Thirteen temporal vectors additionally compare native core, both real WASM
table entrypoints, and the default Rust-backed browser adapter. They cover UTC offset
normalization, day/year/leap-day rollover, midnight presentation, explicit day
precision, and malformed suffixes or Unicode input. Invalid inputs retain raw
text rather than becoming a partial timestamp or panicking on a UTF-8 slice.
DATE retains the authored calendar day after validating the complete optional
timestamp. DATE_TIME remains an instant: DAY precision shows its UTC date,
including offset-driven day/year/leap-day rollovers. Zone-free timestamps retain
the documented UTC convention.
These fixed expectations remain independent of the implementation even though
browser and native formatting now execute the same core. They do not establish
every invalid-input or modality acceptance requirement.

The additional 82 calendar cases include all four TemporalDisplay modes crossed
with all four TemporalPrecision values for DATE, DATE_TIME, and TIME. DATE uses
the explicit clock's UTC day: same-day values read `today`, including before the
Unix epoch, and stored offsets/times do not turn a calendar day into an instant.
DATE_TIME relative text remains elapsed-time based even when its absolute title
uses DAY precision. TIME never invents a calendar. Malformed suffixes, invalid
seconds/offsets/calendar dates, and Unicode cannot hide behind a valid date prefix.

The native suites run with `cargo test -p meridian-uiview --lib` or
`bazel test //crates/core/rust/uiview:uiview_test`. The real bridge suite runs
with `bazel test //packages/web/tests:conformance_wasm`; this compiles the WASM
and binds it with the pinned toolchain rather than substituting a mock. CI runs
both paths, so a divergence from either set of expectations fails the build.

### Standalone value formatter boundary

The core also exports `format_display_value_with_metadata`, returning the
canonical `FormattedValue` protobuf (visible text plus presence-tracked
supporting title). Text-only native callers retain their existing API and share
the same principal parser. The initialized WASM binding exposes
`formatValueDisplay(ValueDisplay bytes, raw JSON value) -> FormattedValue bytes`;
`formatByCore(value, display, bindings)` at the framework-neutral browser seam
encodes and decodes those messages without reformatting the result in JavaScript.
Raw values are never replaced with their formatted labels, and routing remains
host-owned. Malformed wire messages fail rather than selecting a hidden fallback.

Actual-WASM tests exercise all 29 current typed-value cases and null fallbacks,
the thirteen temporal core vectors, and the principal mode/supporting-title
matrix through this standalone entrypoint. Adapter tests separately preserve
absent versus empty title presence.

`format_display_value_with_context` adds an explicit epoch-millisecond instant
for relative temporal text and relative-with-absolute-title results. It reuses
the same UTC parser as absolute formatting, including fractional milliseconds
and pre-epoch dates. No process or browser clock is read. Missing, non-finite,
or out-of-range instants (outside ±8.64e15 milliseconds) retain absolute text;
zero and negative epoch instants remain valid. Calendar-free TIME values retain
absolute presentation rather than inventing a date.

The separate WASM `formatValueDisplayAt` capability and the optional final
`nowMs` argument to `formatByCore` carry this explicit instant. Clock-free calls
retain the original two-argument WASM entrypoint. An explicit clock with an older
binding that lacks the new capability fails clearly rather than silently ignoring
the caller's instant. Fifty-five proto-defined cases pin all TemporalDisplay
modes, relative-time boundaries/rounding, offsets, leap centuries, invalid clocks,
and PrincipalDisplay modes with and without clock context. Native Rust and actual
WASM decode identical expected FormattedValue bytes, including title presence.

The default `formatByDisplay` path now uses a self-contained module generated
from the same pinned Rust WASM target that ships in the schemas package. It
initializes synchronously from embedded bytes in browsers and Node SSR: no
runtime fetch, filesystem access, top-level await, host formatter configuration,
or independent clock. Legacy timestamp inference, principal APIs, StatPanel
numeric labels, and table FLOAT_2DP numeric labels also delegate to core. The
TypeScript date/number/principal algorithms are removed; routing and decoration
stay in their existing host seams. Legacy column rounding retains native
ColumnFormat semantics; declared precision retains its distinct documented rule.

For local source development, run `pnpm core:prepare` after `pnpm install` and
after Rust formatter changes. Bazel publishes the generated module directly;
generated source copies are ignored, not checked-in binary snapshots. CI builds
this narrow core target once, passes the two module artifacts to the Node test
job, and independently verifies the full Bazel package/render graph. Publishing
also prepares the same local artifact before package tests; this adds no publish
or deployment trigger.

Detached-process tests import the module with fetch, Intl date formatters, and
Date.now disabled in two time zones. Real HTML/Shadcn field tests render server
markup and hydrate it without replacing header nodes or producing recoverable
errors; relative text appears after hydration while supporting titles survive.
Synchronous WebAssembly compilation must be permitted by the host runtime/CSP.
The current full-core module is approximately 2.09 MB uncompressed / 613 KB
gzipped, an explicit startup/bundle cost, not a completed performance-budget audit.

Twelve fixed fallback cases protect literal declared text, unknown types/modes,
strict calendar validation, and UTC zone-free timestamps. UNSPECIFIED retains
the existing inference contract, now implemented in core; unknown future types
stay literal. Calendar semantics now have the explicit cross-mode matrix above;
the broader input/options/modality audit remains open. Neither default adoption
nor a finite fixture set alone closes #50/#51.

After editing the corpus authoring inputs or intentionally changing the core
contract, regenerate with `node schemas/tools/write_core_corpus.mjs --write`
after `pnpm install --frozen-lockfile`, then review the expectation changes.
Without `--write`, this tool validates the proto3 JSON envelope and checks that
descriptor bytes and committed expectations match the authoring inputs. CI
uses this read-only mode; it never records its implementation's actual output
as expected output.

Conversation list items accept optional title/subtitle `ValueDisplay` declarations.
Chat HTML/React and TUI tests wire-round-trip temporal and principal labels while
preserving raw strings. Unsupported types retain literal text; browsers expose
principal email titles and native output retains the visible name. These slots
do not coerce numeric strings or introduce navigation.

The TUI conversation unit suite also draws wire-decoded list events through the
shared conversation model and `TestBackend` at a fixed 100-by-10 viewport. Inline
text goldens cover date/principal formatting in both slots, literal numeric and
boolean strings, invalid/unknown displays, an empty subtitle, badges, and replacing
the same block with display declarations removed. Model assertions preserve raw
values. These are focused conversation fixtures, separate from the canonical panel
corpus; they do not prove colors, navigation, wrapping, or layout parity. Run
`cargo test -p meridian-tui --lib conversation::tests` to compare them.

MUI table and view-level row actions resolve declared literal, selection, row-field,
and nested request bindings against the clicked row. Unbound row calls retain the
legacy `{id}` request. Focused tests cover nested false/zero values, admission
denial, row-menu accessibility, `enabled_when` against raw row values, failure/retry,
and current-page reload after a successful panel action. Because proto3 scalar
presence cannot distinguish an omitted `refresh_on_success` from authored false,
MUI matches the browser reference renderers and honors the documented default by
refreshing after every successful panel row action. These assertions do not cover
menu positioning, animation, or other visual layout behavior.

Web-components view and slot RPC actions pass declared bindings to the WASM
request builder with the current host `RenderContext` at activation. Nested Maps
returned by the bridge become plain request objects; unbound actions retain an
empty request. DOM tests verify descriptor/context forwarding, nested results,
false/zero preservation, refreshed context on retry, and denial before request
building or transport. The tests substitute the WASM bridge and therefore prove
integration wiring, not end-to-end native binding evaluation. No new context
sources or refresh behavior are introduced.

Native prompts and inline form summaries honor static enum `options` labels,
falling back to each token when its label is empty. Authored options take
precedence over `allowed_values`; keyboard selection and submission retain raw
tokens. Option tones use native palette roles (warning uses bold emphasis because
the terminal palette has no warning role). Wire-decoded prompt tests cover
selection, cycling, text/style rendering, and raw submission. Dynamic
`options_source` loading remains host-owned on native surfaces.

The native descriptor suite also wire-round-trips a focused FormPanel fixture
through `PanelView` and `TestBackend` at 100-by-16. Text goldens cover read-only
and editable date displays, absent/unspecified/unknown display fallbacks, invalid
date text, and static enum labels with empty-label fallback. Editing a formatted
date and cycling enum options verifies exact raw submission values; authored
options take precedence over legacy tokens. Separate cell assertions check the
success, danger, and unknown-tone palette roles. This fixture is separate from
the canonical panel corpus and does not establish layout, dynamic option loading,
or transport behavior. Run `cargo test -p meridian-tui --test render_descriptor`
to compare the inline goldens and request assertions.

MUI FormPanel dynamic enum tests cover read-tier `options_source` requests,
dotted response/value/label paths, prefill token preservation, and validation
against resolved tokens (including nested and repeated values). While option
sources load, the form shows a status and disables submission; failed, malformed,
or empty results show an alert and leave submission unavailable. Defaults remain
in form state; invalid tokens are not silently replaced or submitted. Static
labeled-option precedence continues to use the existing `enumOptions` contract.
This does not establish dynamic options for Prompt/LRO or native forms.

MUI header/overflow, table-row, resource-card, and launchpad RPC controls expose
admission denial with `aria-disabled` and an unavailable title. Attempted
activation still uses the guarded invoker and preserves the host denial callback.
Pending mutations suppress duplicate activation; failures render text-only alerts
and the same control can retry. Launchpad RPC commands close only after success.
Focused header/resource tests assert exact payloads, denial callbacks, escaped
errors, and retry; the shell suite protects existing navigation behavior. URI and
copy affordances retain their existing behavior. This does not add table refresh
semantics or prove every action placement's interaction matrix.

Web-components view, resource-card, and table actions expose mutation denial
with `aria-disabled` and an associated explanation. Activation still passes
through the host admission gate, including its denial callback. Invocation
failures render text-only alerts; the same control retries, prevents duplicate
pending invocation, and announces completion. Focused DOM tests preserve resource
request construction and table refresh after successful retry.

`fixtures.ts` is the canonical protobuf corpus: 23 panel arms plus an unset body.
The matching `binpb/` messages are consumed by the native renderer. Browser tests
consume the TypeScript messages directly; the wire-integrity test verifies that
both representations agree.

## Browser semantic snapshots

Web-components `form.test.ts` exercises typed scalar, nested, repeated, and map
submission, denied mutations, prefill/default merging and failure fallback,
validation, duplicate-submit prevention, retry, teardown, and read-only display.
Its request builder is a mocked WASM bridge; this proves DOM/admission wiring,
not end-to-end WASM binding resolution. Dynamic enum option loading is not
implemented by this FormPanel path.

The conformance suites commit 96 goldens: each canonical fixture through HTML,
Shadcn, MUI, and web-components. `normalize_dom.ts` removes generated IDs, style
rules, and layout wrappers while retaining text, semantic elements, authored
roles and state, control values, destinations, and media alternatives. It resolves
ID-based accessible names to text. This is a semantic DOM projection, not a
computed browser accessibility tree; it does not evaluate CSS or layout.

The goldens live in each package's `tests/__snapshots__/conformance.*.snap` file.
`schemas/tools/check_coverage.mjs` rejects missing files or arm keys, duplicates,
and obsolete arm keys. CI runs this presence gate before the package test suites,
which compare actual renderer output against the committed goldens. Changing only
a title wrapper while dropping the body now fails a snapshot comparison. The
HTML/Shadcn no-fallback checks also derive their expectations from `coverage.json`.

Run every suite and the snapshot-presence gate from the repository root:

```sh
pnpm conformance:snapshots
```

The Node CI job runs this same verification command after the package test
suites. CI never passes `--update` or `--bazel`: committed goldens are read-only
there, and Bazel remains isolated in its dedicated job.

To record an intentional behavior change, use the same explicit switch from
either build entrypoint, then review every golden diff:

```sh
UPDATE_SNAPSHOTS=1 pnpm conformance:snapshots
UPDATE_SNAPSHOTS=1 bazel run //:re_record_conformance
# Include the compiled-WASM stateful DOM suite (requires the Bazel toolchain):
node schemas/tools/conformance_snapshots.mjs --wasm --update
```

The Bazel launcher returns to `BUILD_WORKSPACE_DIRECTORY` before running the
shared updater, so Vitest writes to the checked-out package snapshots rather
than through Bazel's runfiles symlinks. Do not re-record to hide a missing field
or unexpected fallback. After reviewing the diff, run
`node schemas/tools/conformance_snapshots.mjs --bazel` to verify the React and
web-components and MUI Bazel conformance targets. MUI's
`//packages/mui-kit:stateful_conformance` target compares both its initial and
stateful semantic goldens in strict CI mode; its real-browser harness remains a
separate test tier. The shared verifier suppresses Bazel rc announcements so
developer-local cache credentials cannot leak through configuration logging.
The optional `--wasm` path first builds `//packages/web/tests:wasm_artifacts`,
copies its generated JS/WASM next to the local Vite suite, and then runs the
suite with the same explicit update switch. The default Node-only command
checks the committed WASM golden presence but does not require a Rust compiler;
the dedicated CI Bazel job compares their contents in strict read-only mode.

## Focused interaction and content coverage

The web-components `table_stream.test.ts` suite also records seven semantic DOM
snapshots for TablePanel row actions: unselected, selected with an `enabled_when`
filter, selected with both actions enabled, pending, failed, retry pending, and
completed after refresh. It mounts the panel in the document so generated
`aria-describedby` references resolve to feedback text. Explicit assertions cover
keyboard selection, live disabled state, `aria-busy` (which the normalizer omits),
duplicate-click prevention on the pending button, escaped error text, and the
exact mutation/read sequence. A shortened refresh response clears an out-of-range
selection and disables its actions. The test decodes the authored row-field binding
at the WASM seam and checks raw selected-row context and outgoing request values;
its request-builder double does not prove Rust binding evaluation.

Run `pnpm --dir packages/web exec vitest run tests/table_stream.test.ts` to compare
these snapshots; append `--update` only for intentional changes and review
`packages/web/tests/__snapshots__/table_stream.test.ts.snap`. The Bazel
`//packages/web/tests:table_stream` target includes the normalizer and snapshots.
This is evidence for the single web-components TablePanel implementation, not
HTML/Shadcn table row actions, MUI, CSS/layout, or a computed accessibility tree.

HTML/Shadcn `table_actions.test.ts` separately exercises `TablePanel.actions`
through both reference kits with wire-decoded descriptors. Rows support click,
Enter, and Space selection while cell links retain independent navigation.
Actions check `enabled_when` against raw row fields and resolve literal,
selection-key, row-field, and nested bindings through the shared action request
helper. Raw false, zero, and empty strings survive; unset selection keys and
unavailable context sources are omitted. Overlapping request paths copy parent
objects so an override cannot modify the fetched row. Unbound calls send an empty request.
Mutation denial retains the host callback and an accessible explanation;
pending actions suppress duplicate activation, failures retain selection for
retry, and successful mutations announce completion and refresh the current page.
Like web-components, the kits follow the documented default of always refreshing:
the non-presence proto3 `refresh_on_success` boolean cannot express an opt-out.
Selection is cleared after success or result/page/scope replacement so an old
index cannot target a different row. Late completions after descriptor/scope
changes or unmount do not refresh replacement data. Failed refreshes expose the
existing table-load error separately from mutation completion.

Run `pnpm --dir packages/web-react exec vitest run tests/table_actions.test.ts`
for these DOM, keyboard, admission, request, and lifecycle assertions. The suite
is included in `//packages/web-react:conformance`. It covers TablePanel's selected
row actions; view-level `ActionPlacement.ROW` controls, custom kits, visual
layout, and a computed accessibility tree remain outside this evidence.

The HTML/Shadcn `interactive_conformance.test.ts` suite mounts both kits and
activates real DOM controls. It verifies the canonical ActionPanel's named URI
link, an admitted unbound view action's exact service/method and empty request, and
mutation denial before transport with a host denial callback. ActionPanel
affordances retain their URI/command contracts, separate from view Actions: the
current `Action` message carries an RPC call or a host-resolved id, not a URI or
command payload.

Both reference kits now provide an ActionBar. The suite verifies PRIMARY and
HEADER controls, an accessible OVERFLOW menu, ROW placement exclusion from the
view header, host callbacks for call-less actions, and literal request bindings.
The bars also resolve current selection and ambient repeated-view record fields
into declared request paths, including nested bindings. Missing sources are
omitted; raw false/zero values survive. They expose denied calls with
`aria-disabled` and an unavailable description while remaining focusable;
attempted activation reports the denial through the gated invoker without
transport. Pending actions disable duplicate activation. Failures render a
`role="alert"` message and allow retry; successful retries clear the error.
This does not supply form, signal, or host runtime context when those sources are
unavailable, and does not establish third-party kit or visual menu parity.
The HTML/Shadcn `form.test.ts` suite verifies FormPanel read-tier prefill,
typed scalar/nested/repeated/map payloads, submit bindings, mutation admission,
validation, duplicate-submit prevention, visible failures and retry, and saved
status. Failed prefill retains defaults. Read-only scalar defaults honor declared
displays; editable values remain raw. Dynamic enum sources use read-tier RPCs
with an empty request, resolve dotted option/value/label paths, and preserve
prefilled tokens. Pending, failed, malformed, and empty option responses cannot
be submitted; failures are exposed as alerts. Static labeled options take
precedence over bare allowed values. Tests cover both kits, nested/repeated
enum fields, and rejection of tokens inserted into the DOM outside the resolved
option set. These checks do not establish browser-native validation/layout parity.

These two suites also commit 28 semantic DOM snapshots across HTML and Shadcn:
view-action denial before/after activation, pending, failure, and successful retry;
form saving, saved, submit failure, and successful retry with prefilled values;
and dynamic enum loading, resolved options after a blocked submit, failed,
malformed, and empty responses. They use the same normalizer as the initial-state
corpus, preserving visible feedback, authored roles, disabled controls, and
resolved description text. These action states belong to the HTML/Shadcn
ActionBars, not ActionPanel's URI/command affordances. Live selected values and RPC
payloads remain explicit assertions: the normalizer records DOM attributes, not
all live control properties. The 28 snapshots supplement the 96 initial-state
browser snapshots; they do not expand the canonical fixture count or prove
layout, native browser validation, or other renderers' interaction behavior.

From `packages/web-react`, run
`pnpm exec vitest run tests/interactive_conformance.test.ts tests/form.test.ts`
to compare these snapshots. Add `--update` only for intentional changes, then
review both files under `tests/__snapshots__/`. Both snapshot files are included
in the Bazel conformance target's inputs.

The canonical `copy_value` fixture contains a long panel title, label, and
unbroken URL segment. All four browser semantic snapshots and explicit content
assertions preserve the full label and scalar. The native wire fixture preserves
the same text at sufficient terminal width and renders at a narrow width without
panicking. This keeps 24 fixtures and 96 browser snapshots. CSS overflow, clipping,
and wrapping remain renderer-specific; these checks do not prove visual layout.

The browser semantic goldens are initial-state regression snapshots. Several fixtures have no populate
RPC, and React snapshots are server-rendered, so loading/empty/degraded output is
recorded where appropriate. A snapshot of a loading message does not prove that
populated data renders. Network/clipboard/keyboard behavior remains covered by
the focused interaction suites. A stable snapshot does not establish full
accessibility or layout correctness.

The baseline exposed real debt: HTML and Shadcn omitted `LlmPrompt` and step
media. Both reference kits now implement the LLM
parameter-fill preview, with focused tests for typed controls, local substitution,
unresolved tokens, and descriptor changes. Steps now renders lazy-loaded frames
with accessible alternatives, falling back to text for invalid or failed sources.
Focused tests cover both kits and replacement frames after a failed load.
The first populated scenario now runs through the canonical `resource_cards`
descriptor and the same two-row response in HTML, Shadcn, MUI, web-components,
and TUI tests. Focused gallery tests cover declared `CardSpec` title, subtitle,
and status displays in HTML, Shadcn, MUI, web-components, and native rendering.
HTML and Shadcn focused tests also cover populated media, icons, navigation,
literal labels, unsafe URL degradation, malformed responses, and request failure.
Populated card support is established by these focused tests; the initial-state
snapshots alone record loading, empty, or degraded output.
The canonical Gallery fixture now also carries its populate and card mapping;
the same two-row response is exercised through HTML, Shadcn, MUI,
web-components, and TUI, closing the first populated gallery matrix slice.
Gallery `icon_field` values pass through the host glyph seam in each browser
renderer. The authored key remains available as `data-icon` when the host does
not provide a glyph, so renderer styling and diagnostics retain the declaration.
The canonical Table descriptor now includes its populate RPC, legacy scalar
columns, declared boolean/URL displays, and a host-resolved member link. Focused
MUI and web-components tests use the shared two-row response; the native test
decodes the same wire descriptor and exercises the Rust formatter. The browser
web-components test substitutes the WASM bridge, so it is DOM/link evidence,
not an end-to-end WASM test. HTML and Shadcn now fetch and render the same populated
table, including column order, legacy scalar values, declared displays, and safe
host-resolved links. Their focused tests cover pending, empty, and failed requests
and escaped markup. All four browser realizations link declared safe HTTP(S) URL
values while preserving unsafe schemes as text; MUI and web-components focused
tests exercise that behavior with the same canonical populated response.

`value_types.json` (the proto3-JSON representation of the test-only
`value_types.proto` envelope) supplies 29 cases to the TypeScript shared formatter
and Rust core formatter tests. All 18 declared semantic types are represented;
UNSPECIFIED and an unknown type are additional fallback cases. The tests round-trip
each ValueDisplay through protobuf, assert deterministic text without a clock,
check null fallback, and preserve raw inputs and descriptor bytes. Invalid dates,
times, principal labels, precision, and mismatched options have explicit cases.
Money without a currency code retains its numeric precision; percent ratios
scale by 100 and carry a percent suffix. The extended `core.json` cases exercise
currency-code prefixes, grouping, and compact magnitudes separately. This corpus does not prove renderer decoration,
layout, all option combinations, or universal Rust/TypeScript parity.

Conversation fields, list titles/subtitles, and rich table cells also consume
all 26 string cases from `constrained_value_types.json`, covering all 18 declared
ValueTypes without parsing numeric or boolean strings. The schema's conversation
contract preserves an explicitly empty string rather than the panel corpus's
missing-value dash. HTML, React, and the legacy assistant web component test
canonical Block wire round trips with both numeric and named enum JSON; the
native suite independently round-trips the same values through Block and checks
its rendered lines. Rich table cells override stale legacy values even when
empty. A native TestBackend test additionally verifies multiline table cells,
blank continuation lines, and neighboring column alignment in the actual terminal
buffer.
Conversation field/list spans also expand into physical lines before wrapping
and tail-scroll calculation; public draw-path TestBackend checks protect blank
lines, subsequent styled spans, and two-row viewport tails.
These checks do not establish SwiftUI conformance or every
temporal/principal option combination in every modality; roadmap #51 stays open.

The native descriptor suite now has inline text goldens for populated Gallery,
Table, ResourceCards, and Steps at a fixed 160-by-20 viewport, plus empty
responses and absent populate RPCs for the three RPC-backed shapes.
ResourceCards also has a transport-failure golden that preserves the
service/method diagnostic instead of an empty-state message. The ResourceCards
cases decode the canonical wire fixture and exercise its title/subtitle mapping
and authored empty message. They retain row order, headers, scalar precision,
boolean labels, gallery action/destination text, and the Steps frame alternative
that native surfaces use in place of an image. The canonical Steps fixture also
carries a nested affordance: all four browser realizations preserve its link,
label, and description in semantic snapshots, while the TUI golden retains the
same action as non-interactive label/destination text. Focused HTML, Shadcn,
web-components, and TUI tests additionally protect the icon and degradation
semantics. The native goldens normalize borders and whitespace. Table URLs are
plain text; these checks do not prove navigation, colors, or layout fidelity.
Run `cargo test -p meridian-tui --test render_descriptor` to compare them; intentional
changes require reviewing and editing the inline expected lines.

The canonical Media fixture preserves chapter offsets as visible timestamps on
every renderer. The four browser realizations expose those chapters as labeled
seek controls that update the active audio or video player's current time; their
semantic snapshots retain the control, timestamp, and machine-readable offset.
Focused interaction tests exercise web-components, HTML, Shadcn, and MUI seek
behavior. The TUI continues to realize the schema's non-playable degradation
rung by listing the same timestamps, labels, source, captions URI, and alt text.
These checks do not simulate codec loading, playback policy, or WebVTT parsing.

Chart population has focused coverage beyond the canonical initial-state fixture.
Web-components, HTML, Shadcn, and MUI invoke the declared read call, resolve
`rows_field`, and preserve x/y/series field order in a readable table fallback
when no richer host chart is available. The React reference kits also apply live
selection bindings and expose bounded loading, empty, and error states. These
tests establish portable data semantics, not chart-library visuals or layout.
The TUI wire-to-render suite now covers populated chart rows through the same
descriptor encodings and separately preserves successful-empty and transport-
failure states instead of collapsing them into the static-host hint.

The canonical Stream fixture also exercises the TUI's host-supplied snapshot
boundary. Explicit `max_lines` values retain only the newest authored number of
lines, and an unspecified limit uses a bounded 2,000-line renderer default
rather than retaining an unbounded process-lifetime stream. This establishes
native retention semantics without claiming a built-in streaming transport.

Authored `Affordance.invoke.uri` values pass through one browser navigation
admission rule before any renderer creates a link. Relative routes, HTTP(S),
mail links, and application deep links such as `cursor://` remain available;
executable or local-document schemes (`javascript:`, `data:`, `file:`,
`vbscript:`, and `blob:`), control characters, and malformed values degrade to
a disabled control that retains the label, description, and icon. Focused
web-components, HTML, Shadcn, MUI, and framework-neutral seam tests protect the
same rule. Native surfaces continue to expose URI intent as text for host-owned
activation.

The MUI Launchpad applies that same rule to authored `Command.deep_link` values
before document navigation. Safe application deep links retain precedence over
the command action; rejected executable or local-document schemes render as
disabled commands and never fall through to the alternate action.

The standalone React Launchpad now shares that precedence and degradation rule,
and both launchpad tiers admit authored `Navigate.route` values before invoking
either the host router or `window.location`. Rejected routes remain disabled and
cannot reach either navigation boundary. The standalone interaction suite is
owned by a Bazel target as well as the package test command.

MUI AppShell applies the same admission rule at its central `hrefForNode` seam.
Authored `NavNode.route` values and host-resolved panel/view destinations are
admitted before header links, sidebar leaves, user-menu items, or active-route
matching can consume them. Rejected destinations remain absent or disabled, so
every shell navigation surface shares one degradation behavior.

Gallery `href_field` values use the same admission rule in web-components,
HTML, Shadcn, and MUI. Safe application deep links remain interactive;
rejected destinations degrade to the authored action label or an inert card.
Focused tests cover both outcomes without granting navigation to image sources.

Walkthrough `Step.media_uri` values pass through one passive-asset admission
rule before browser renderers create an image. Host-relative and HTTP(S) frames
remain available; executable, local-document, opaque, malformed, or
control-character sources degrade to `media_alt` (or the step label) without
emitting an image element. Host asset resolvers run only after authored input is
admitted, so trusted surfaces can still map valid paths onto mounted assets.

`MediaPanel.src_uri`, `poster_uri`, and `captions_uri` use the same passive-asset
admission rule in web-components, HTML, Shadcn, and MUI. A rejected primary
source creates no image, audio, video, or track element and preserves authored
alt/caption text as the degradation rung. Rejected poster and caption sources
are omitted independently while a safe primary player remains available. Host
asset resolvers run only after each authored source is admitted.

Gallery `image_field` values also pass through passive-asset admission before
web-components, HTML, Shadcn, or MUI create an image. Rejected sources leave the
card's authored text and actions intact without emitting an image; MUI invokes
the host asset resolver only after the authored source is admitted.

`Theme.typography.fonts[].src_uri` uses a dedicated font-source admission rule
before the MUI theme binding emits `@font-face` CSS. Relative and HTTP(S) font
files remain available, as do base64 `data:font/*` sources for self-contained
skins. Active, local, opaque, malformed, and non-font data sources are omitted
instead of being escaped into an active stylesheet URL. Focused seam and theme
tests protect the admission and materialization boundaries.

`TerminalPanel.url` uses a separate, narrower transport admission rule: only
absolute `ws://` and `wss://` broker URLs without embedded credentials or URL
fragments can reach the browser's WebSocket constructor. Rejected endpoints do
not construct xterm or a socket; web-components, HTML, Shadcn, the core React
fallback, and MUI retain the authored value as inert diagnostic text with an
accessible error. This check establishes URL admission, not broker
authentication, session ownership, codec behavior, or network connectivity.

Declarative worker `fetch` effects apply a dedicated request-target admission
rule after payload interpolation and before browser `fetch`. Host-relative and
credential-free HTTP(S) targets remain available. Active/local schemes,
embedded URL credentials, control characters, malformed targets, and empty
values enter the effect's existing `onError` path without network activity.
Focused seam and worker-runtime tests protect both the pure admission rule and
the side-effect boundary. This does not define origin allowlists, authentication,
headers, response schemas, or host network policy.

## Remaining coverage and tooling

Panel `renders` claims must have an explicit owner in
`schemas/tools/panel_evidence.mjs`. The coverage/snapshot gate rejects an
unregistered renderer even when all existing renderers' goldens are present.
CI also runs the owners' seven unique Bazel test targets explicitly, so deleting
an owner target or excluding it from `//...` cannot silently drop its proof.
Run `node schemas/tools/panel_evidence.mjs --required-targets` to inspect the
selection or `--verify` to execute it read-only. Registration and snapshot
presence are necessary, not sufficient: the owning tests must pass on the same
revision. This registry covers panels, not external conversation consumers;
SwiftUI remains a preview; its initial native view-dump evidence does not promote
its unverified cells to full semantic parity.

The local SwiftPM foundation is documented in
[packages/swiftui](../../packages/swiftui/README.md). Its wire and native layout
smoke tests are not registered semantic render proofs and do not promote cells.

The v1 release scope retains the documented SwiftUI preview. Full SwiftUI native
parity, composed-view verification, and OS accessibility proof are future work,
not v1 release gates. Existing preview tests must pass, and coverage claims must
retain their explicit verification limits.

Epic #9 still owns stable renderers' visual overflow/layout proof and broader
interactive snapshots. The shared panel corpus
now has 427 canonical cases across all current arms, including typed input/default
values, with 854 native buffers and 1,708 computed browser accessibility trees;
those snapshots do not establish general native ViewDescriptor layout or every
interaction contract. The common snapshot command now
supports intentional re-recording and optional verification of the Bazel targets
that own semantic goldens. MUI's semantic suite runs through the package test
job; its Bazel browser harness is a separate set of tests.

The TUI now also has a real `ViewHost`, independently tested by
`//crates/tui/rust/tui:view_composition_test`. Its whole-view buffers and keyboard
tests cover all four layouts at 80/140 columns, nested/repeated raw records,
gates, host-owned mutations, stream disposal, and operation-token routing. It
also consumes an existing shared browser wire fixture without extracting its
panels. This is not yet a shared cross-renderer composed-layout corpus or an
implementation of the transcript's separate `Block.view` integration.
