# Change summary

## Unreleased — 1.0.0 candidate

This records the unmerged removal candidate, not a published release or an
activated compatibility policy. This separate distribution draft prepares
`1.0.0` package metadata, not a tag or registry release. The prior unmerged
`1.0.0-alpha.1` candidate supplied validation evidence; no alpha publication is claimed.
The final-version archives and consumers still require their own verification.
The maintained 0.x line is unchanged; neither a final 1.0.0 release nor its
schema/FILE activation is approved by this version preparation.
The roadmap's completed work and remaining issue criteria remain authoritative
in [ROADMAP.md](ROADMAP.md).

### Intentional breaking changes in the removal draft

- Use one canonical `Affordance.invoke` vocabulary across rows, headers,
  palette commands, chat and forms: RPC, navigation, inline panel, view, URI,
  command and copy. Placement, tone and emphasis remain independent of intent
  and host permission.
- Remove and reserve nine legacy field names and tags: `Affordance.style`,
  four old Command invocation fields, `FormPanel.submit`, and the old Action
  collections on TablePanel, ViewDescriptor and Slot. Remove the empty
  `Command.action` oneof, messages Action/RowAction/OpenPanel and enum
  AffordanceStyle. See the exact [removal inventory](schemas/migration/REMOVAL.md).
  Canonical ConnectTarget actions, ActionPanel and unrelated ResourceAction are
  not retired merely because their names contain “action.”
- Preserve surviving protobuf module import facades, not removed generated
  APIs or descriptor-file ownership. Java holders, Rust recursive types,
  generated exports and stored descriptor consumers need deliberate migration.
  Old binary unknown-field preservation is not policy compatibility; strict
  new JSON rejects removed field names.
- Require explicit host capabilities, current target admission and consent.
  Bare semantic IDs, deep-link metadata and legacy callbacks cannot recover an
  invocation after canonical intent is absent, empty or denied. Opening or
  rendering a request form does not submit it; mutations use actual request
  views and explicit submit controls.

### Contract and verification notes

- Native and browser-WASM text/masked form validation use the same
  [Rust Unicode regex contract](schemas/FORM_PATTERNS.md). Lookaround and
  backreferences require pattern migration, not a JavaScript fallback.
- Frozen old-reader compatibility checks and actual-removal generated-language
  checks remain separate. Both existing FILE references intentionally reject
  the breaking candidate; neither is silently replaced or downgraded to WIRE.
- An explicit inactive removal-line rehearsal checks the complete audited image,
  exact initial cutover, surviving ownership moves and both old-line rejection
  reports before FILE-checking the candidate reference. It cannot activate a
  production baseline or approve release execution.
- The Studio catalog is regenerated through real installed module compositions
  with strict decoding and the maintained inventory. Its
  [provenance and verification limits](packages/mui-kit/harness/STUDIO-CATALOG.md)
  do not imply every external operation is implemented or admitted.
- SwiftUI remains the documented preview. Its existing tests are required;
  unverified native coverage is explicit, not promoted to full parity.

### Distribution and remaining release gates

Preparation supports three Rust crate archives and the web-components npm
artifact, alongside existing package/build surfaces. See
[DISTRIBUTION.md](DISTRIBUTION.md) for detached verification and
[API_STABILITY.md](API_STABILITY.md) for chat/launchpad API boundaries.
No npm/crates.io upload, registry change, image/chart publication, tag or
deployment is announced by this summary.

Before a versioned release, finish exact-artifact downstream delivery and
consumer notices, review the explicit FILE-baseline transition, align versions,
locks and generated manifests through their producers, verify extracted
artifacts, and test the integrated release line. Merging/schema activation,
live roadmap automation and publication remain separately approval-gated.
