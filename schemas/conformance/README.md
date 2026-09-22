# Renderer conformance

`fixtures.ts` is the canonical protobuf corpus: 23 panel arms plus an unset body.
The matching `binpb/` messages are consumed by the native renderer. Browser tests
consume the TypeScript messages directly; the wire-integrity test verifies that
both representations agree.

## Browser semantic snapshots

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
link, an admitted view action's exact service/method and empty request, and
mutation denial before transport with a host denial callback. ActionPanel
affordances retain their URI/command contracts, separate from RPC actions.
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
displays; editable values remain raw. These tests do not establish dynamic enum
population or browser-native validation/layout parity.

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
