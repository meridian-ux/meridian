# Pre-v1 compatibility reference

`pre-v1.binpb` is a generated `google.protobuf.FileDescriptorSet`, compiled
without source info from public main
`471650ad7c7c50d287d9240f3614fe154c353ded`. It freezes declaration ownership
and generator input for old TypeScript-module compatibility exports. Both
development JS+declarations and Bazel TypeScript generation use this reference
with pinned protobuf-es 2.12.1. No parallel declaration/export catalog is used.

SHA-256: `5f0b554ad8d1b2ccdf708ff725b8b462d0c19c5ce69d51be73ea8c12bd89be16`.

This is preparation for the authorized Affordance migration PRs, not approval
to cut over production, publish packages, change versions, or reset FILE policy.
It is not a claim that current main equals the originally published 0.25.1 tag.
The final maintained 0.x release revision, descriptor digest, ownership diff,
v1 baseline, and activation policy still require explicit cutover review.

Keep the current `buf.yaml` FILE gate unchanged. A facade preserves old module
exports; it does not preserve descriptor-file ownership, Java holder indexing,
Rust boxing, old-host canonical precedence, or execution authorization. The
separate migration/consumer tests own those requirements.

## Explicit release-line preparation

`v1-affordance-candidate.binpb` combines the fully expanded nine-file candidate
from the tested migration probe with every unchanged file in the full pre-v1
reference, including conformance DTOs outside the probe's scope. Within the
probe's production-schema scope, the typed invoke/policy/envelope contract keeps
216 existing declarations and adds a collection message (217 total). Other
full-reference declarations are retained unchanged. SHA-256:
`9da6cc3c1d76be32633753bd220be64929dc412386facc61d843a370fcdee170`.
This is a prepared contract snapshot, not an active production baseline or a
promise of renderer/host adoption. Changes to either frozen digest require review.

```sh
# The maintained 0.x comparison still rejects the relocated candidate.
node schemas/tools/compatibility_line.mjs --line maintained-0x --image schemas/compat/v1-affordance-candidate.binpb
# Candidate preparation: retain the entire nonzero old FILE report, verify the
# exact ownership transition derived from both snapshots, then run FILE against
# the frozen v1 candidate. This does not activate a baseline or approve cutover.
node schemas/tools/compatibility_line.mjs --line v1-candidate --image schemas/compat/v1-affordance-candidate.binpb
```

The first command must fail. The second may pass only as candidate preparation;
its output explicitly reports the legacy rejection and pending production
approval. Tests reject extra ownership moves, missing declarations, unknown
release lines, and incompatible field changes under the candidate FILE baseline.
There is no `--approve`, automatic fallback, broad ignore, WIRE downgrade, or
workflow selector change. The existing `buf.yaml` remains FILE-based and intact.

To reproduce the prepared snapshot, run the migration probe with `--keep`, then
run `tools/prepare_compatibility_candidate.mjs` under `schemas/` with explicit
`--baseline schemas/compat/pre-v1.binpb`, `--candidate <probe-work>/candidate.binpb`,
and `--output <review-output>.binpb` paths from the repository root. Compare its
digest and ownership report before proposing any frozen-reference update.

Before any activation, an explicit cutover review must approve final 0.x/v1
source revisions, immutable descriptor digests, the complete ownership report,
generated-language/boxing breaks, all upgraded public/private consumers, old-host
precedence/version gating, and the release boundary. A later PR must wire the
approved release-line policy into required CI without converting an old-line
failure to success. Package publication and deployments remain separate approvals.
