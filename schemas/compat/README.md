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
