# Renderer conformance

Conversation list items accept optional title/subtitle `ValueDisplay` declarations.
Chat HTML/React and TUI tests wire-round-trip temporal and principal labels while
preserving raw strings. Unsupported types retain literal text; browsers expose
principal email titles and native output retains the visible name. These slots
do not coerce numeric strings or introduce navigation.

MUI table and view-level row actions resolve declared literal, selection, row-field,
and nested request bindings against the clicked row. Unbound row calls retain the
legacy `{id}` request. Focused tests cover nested false/zero values, admission
denial, and current-page reload after an explicitly enabled `refresh_on_success`.

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

Run the suites from the repository root:

```sh
pnpm --dir packages/web-react exec vitest run tests/conformance.test.ts
pnpm --dir packages/mui-kit exec vitest run tests/conformance.test.tsx
pnpm --dir packages/web exec vitest run tests/conformance.test.ts tests/conformance_normalizer.test.ts
node schemas/tools/check_coverage.mjs
```

To record an intentional behavior change, append `--update` to the relevant
Vitest command and review the golden diff. Do not re-record to hide a missing
field or unexpected fallback. The existing React and web-components Bazel
conformance targets include the normalizer and goldens as runfiles.

## What these fixtures do not prove

The HTML/Shadcn `interactive_conformance.test.ts` suite mounts both kits and
activates real DOM controls. It verifies the canonical ActionPanel's named URI
link, an admitted unbound view action's exact service/method and empty request, and
mutation denial before transport with a host denial callback. ActionPanel
affordances retain their URI/command contracts, separate from RPC actions.
The HTML/Shadcn view-action fallback also resolves literal, current selection,
and ambient repeated-view record fields into declared request paths, including
nested bindings. Missing sources are omitted; raw false/zero values survive.
This does not cover custom kit ActionBars or row-action controls, nor supply
form, signal, or host runtime context when those sources are unavailable.
The shared view action fallback exposes denied calls with `aria-disabled` and
an unavailable description while remaining focusable; attempted activation
reports the denial through the gated invoker without transport. Pending actions
disable duplicate activation. Failures render a `role="alert"` message and allow
retry; successful retries clear the error. This evidence covers HTML/Shadcn's
fallback, not custom kit ActionBar implementations or row actions.
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

The canonical `copy_value` fixture contains a long panel title, label, and
unbroken URL segment. All four browser semantic snapshots and explicit content
assertions preserve the full label and scalar. The native wire fixture preserves
the same text at sufficient terminal width and renders at a narrow width without
panicking. This keeps 24 fixtures and 96 browser snapshots. CSS overflow, clipping,
and wrapping remain renderer-specific; these checks do not prove visual layout.

These are initial-state regression snapshots. Several fixtures have no populate
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
Their initial-state snapshots still do not establish populated card support.
The canonical Gallery fixture now also carries its populate and card mapping;
the same two-row response is exercised through HTML, Shadcn, MUI,
web-components, and TUI, closing the first populated gallery matrix slice.
The canonical Table descriptor now includes its populate RPC, legacy scalar
columns, declared boolean/URL displays, and a host-resolved member link. Focused
MUI and web-components tests use the shared two-row response; the native test
decodes the same wire descriptor and exercises the Rust formatter. The browser
web-components test substitutes the WASM bridge, so it is DOM/link evidence,
not an end-to-end WASM test. HTML and Shadcn now fetch and render the same populated
table, including column order, legacy scalar values, declared displays, and safe
host-resolved links. Their focused tests cover pending, empty, and failed requests
and escaped markup. These reference kits also link declared HTTP(S) URL values;
URL display alone remains plain text in the MUI/web-components table realizations.

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

The native descriptor suite now has inline text goldens for populated Gallery
and Table at a fixed 160-by-20 viewport, plus empty responses and absent populate
RPCs. They retain row order, headers, scalar precision, boolean labels, and gallery
action/destination text while normalizing borders and whitespace. Table URLs are
plain text; these checks do not prove navigation, colors, or layout fidelity.
Run `cargo test -p meridian-tui --test render_descriptor` to compare them; intentional
changes require reviewing and editing the inline expected lines.

Epic #9 still owns broader overflow/ValueType renderer fixtures,
broader interactive snapshots, native snapshots, and a common Bazel-aware
re-record workflow. MUI's semantic suite currently runs through the package
test job; its Bazel browser harness is a separate set of tests.
