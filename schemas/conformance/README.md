# Renderer conformance

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
```

The Bazel launcher returns to `BUILD_WORKSPACE_DIRECTORY` before running the
shared updater, so Vitest writes to the checked-out package snapshots rather
than through Bazel's runfiles symlinks. Do not re-record to hide a missing field
or unexpected fallback. After reviewing the diff, run
`node schemas/tools/conformance_snapshots.mjs --bazel` to verify the React and
web-components Bazel conformance targets. MUI remains covered by its package
Vitest suite because its browser Bazel harness is a separate test tier.

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
Money/percent cases record the current scalar precision behavior, not currency
symbols or percentage scaling. This corpus does not prove renderer decoration,
layout, all option combinations, or universal Rust/TypeScript parity.

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

Epic #9 still owns broader populated-shape coverage, visual overflow/layout and
ValueType renderer fixtures beyond the shared formatter corpus, broader
interactive snapshots, and native snapshots beyond the
Gallery/Table/ResourceCards/Steps/Chart text goldens. The common snapshot command now
supports intentional re-recording and optional verification of the Bazel targets
that own semantic goldens. MUI's semantic suite runs through the package test
job; its Bazel browser harness is a separate set of tests.
