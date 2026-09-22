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
and TUI tests. Epic #9 still owns representative overflow/ValueType fixtures,
broader interactive snapshots, native snapshots, and a common Bazel-aware
re-record workflow. MUI's semantic suite currently runs through the package
test job; its Bazel browser harness is a separate set of tests.
