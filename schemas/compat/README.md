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
approval. Expected legacy rejection requires Buf's exact compatibility exit
code 100 as well as the ownership report; partial deletion output followed by
a tool failure is not compatibility evidence. Tests reject extra ownership moves,
missing declarations, unknown release lines, and incompatible field changes under
the candidate FILE baseline.
There is no `--approve`, automatic fallback, broad ignore, WIRE downgrade, or
workflow selector change. The existing `buf.yaml` remains FILE-based and intact.

Inputs to release-line checks must be full-module descriptor images, not a
per-crate subset that omits conformance or other retained declarations.
To reproduce the prepared snapshot, run the migration probe with `--keep`, then
run this command from the repository root, substituting its actual scratch path:

```sh
node schemas/tools/prepare_compatibility_candidate.mjs --baseline schemas/compat/pre-v1.binpb --candidate <probe-work>/candidate.binpb --output <review-output>.binpb
```

Compare the digest and ownership report before proposing any frozen-reference
update. Preparation never overwrites a frozen reference implicitly.

## Exact removal-candidate rehearsal

`v1-removal-candidate.binpb` is the digest-guarded audit reference selected
explicitly for major-1 CI below. Neither frozen old-line reference is replaced.
It is the source-info-free full-module
image built with Buf 1.72.0 from public candidate
`e7975a6ecec98217f2a9c76b7f9a2a59a4bf3dea`. SHA-256:
`022c995b582690be2aea4f9c63126cfc93652a168c38d1f3e54c337aa824d55c`.
The digest and exact transformation from the separately frozen actual additive
image are both checked before it can serve as a rehearsal reference.

```sh
node schemas/tools/compatibility_line.mjs --line v1-removal-candidate --image <full-module-removal-image>.binpb
```

This explicitly requested mode:

1. Requires the exact nine field removals/name-and-tag reservations, empty
   Command oneof retirement, three message removals and AffordanceStyle removal.
   Whole-image comparison retains all other declarations and conformance files.
2. Reports **41 surviving declaration ownership moves**, after accounting for
   the four retired full names separately, not 45 surviving moves.
3. Requires **both** maintained-0x and actual pre-removal additive FILE checks to
   reject with compatibility exit 100, retaining both complete reports. Tool
   failures and unexpected compatibility success cannot count as that evidence.
4. Runs FILE against the digest-guarded removal-candidate reference and prints
   `PREPARATION ONLY`, without changing any selected policy or reference.

This is an exact **initial-cutover rehearsal**, deliberately stricter than a
future v1 maintenance gate: even unrelated FILE-compatible additions require
separate review here. It does not implement the post-approval maintenance
policy, expose a `v1`/`production` alias or `--approve` switch, change required CI's
selector, change package versions, or authorize merging/activation/publication.
The existing maintained and additive line names retain their original behavior
and continue rejecting removal. The root `buf.yaml` remains unchanged.

Before any activation, an explicit cutover review must approve final 0.x/v1
source revisions, immutable descriptor digests, the complete ownership report,
generated-language/boxing breaks, all upgraded public/private consumers, old-host
precedence/version gating, and the release boundary. Major-1 CI selects the
explicit policy below without converting an old-line failure to success. Future
selection changes require review. Package publication and deployments remain
separate approvals.

## Explicit major-1 FILE maintenance policy

The node CI job explicitly selects `v1-maintenance-proposal` for the major-1
line; the technical mode name is retained for audit continuity. Selection is
recorded in the workflow, not inferred from running the evaluator. The root
FILE rule set and both historical references remain unchanged. The exact
initial-cutover rehearsal above retains its stricter whole-image check.

```sh
node schemas/tools/compatibility_line.mjs --line v1-maintenance-proposal --image <full-module-image>.binpb
```

This policy requires a major-1 version from the real `MODULE.bazel` module
block, verifies the unchanged removal-reference digest and transformation,
retains all nine retired field names/tags as reservations, forbids resurrection
of the four retired full names under any declaration kind, and keeps the
retired Command.action oneof absent. It then requires FILE compatibility with
the frozen removal reference. FILE-compatible additions may pass; changing or
deleting the surviving contract still fails. Retirement checks are necessary
because adding a previously retired type can otherwise look like an ordinary
compatible addition to FILE.

Both maintained-0x and pre-removal additive FILE comparisons must still reject
with exit 100 and retain their complete reports. No old-line failure is relabeled
as a compatibility success. Unknown/production/default aliases remain errors;
there is no approval flag. The maintenance evaluator reports that evaluation
grants no merge, publication, deployment or live automation approval. The exact
initial-cutover rehearsal continues to print PREPARATION ONLY.

Policy selection requires review of the implementation, tests, final source/image
identities, supported version boundary, first-party consumers and integration
checks. The initial release retains its exact-cutover consumer probes unchanged;
this policy does not relax those checks. Future compatible schema evolution also
requires review of that migration-probe phase. Evaluating FILE compatibility does
not merge a PR, publish an artifact, deploy a service or activate automation.
