# Change summary

## Unreleased — 1.0.0 candidate

This unreleased major-1 source line uses `1.0.0` metadata and the canonical
Affordance removal contract. Required node CI explicitly selects the reviewed
major-1 FILE reference; both old-line FILE rejections remain required evidence.
This is not a tag, registry publication or deployment announcement. The prior
`1.0.0-alpha.1` preparation supplied validation evidence without an alpha release.
The integrated public source and complete seven-npm/three-crate rehearsal set
have detached-consumer and extracted-archive verification. The actual tagged
release must still produce and verify its own artifacts before a separately
approved publication. Published 0.x artifacts remain distinct from this line.
The roadmap's completed work and remaining issue criteria remain authoritative
in [ROADMAP.md](ROADMAP.md).

### Intentional breaking changes at the major-1 boundary

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
- The explicit initial removal-line rehearsal checks the complete audited image,
  exact initial cutover, surviving ownership moves and both old-line rejection
  reports before FILE-checking the candidate reference. Running the rehearsal
  grants no release, publication or deployment authority.
- The Studio catalog is regenerated through real installed module compositions
  with strict decoding and the maintained inventory. Its
  [provenance and verification limits](packages/mui-kit/harness/STUDIO-CATALOG.md)
  do not imply every external operation is implemented or admitted.
- SwiftUI remains the documented preview. Its existing tests are required;
  unverified native coverage is explicit, not promoted to full parity.

### Distribution and remaining release gates

Preparation supports all seven npm packages, including web-components, and three
Rust crate archives. Separately gated bootstrap covers the four new registry
names; resume skips only registry versions whose actual bytes match the verified
artifacts. No live authentication or upload is implied by a passing rehearsal. See
[DISTRIBUTION.md](DISTRIBUTION.md) for detached verification and
[API_STABILITY.md](API_STABILITY.md) for chat/launchpad API boundaries.
No npm/crates.io upload, registry change, image/chart publication, tag or
deployment is announced by this summary.

Version producers, locks and generated manifests agree on 1.0.0. Before a
versioned release, verify registry ownership and trust, configure the approved
release protections, resolve supported-consumer delivery and private integration
approval, and verify the selected FILE policy and exact artifacts on the tagged
release line. Public canonical-contract integration and its rehearsal do not
authorize these remaining steps.
External application rollout, including Aion, does not gate Meridian's release.
Live roadmap automation, production consumer cutover, publication and deployment
remain separately approval-gated.
