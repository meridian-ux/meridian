# Projector structure catalog

`proto-viewdescriptors.json` is a generated export from the exact producer commit
recorded in `generatedFrom`, not a hand-migrated approximation or a deployed
service claim. Its only normalization replaces reviewed resource type domains in
`subjectKind` and `targetKind` with `meridian.example.com`. RPC names, bindings,
request fields, and served layout names retain the actual producer output.

To verify against the recorded producer source, run from the public repository:

```sh
node schemas/tools/projector_catalog.mjs \
  --source /absolute/path/to/meridian-internal \
  --revision 545e11d86a353d92f6ea101624607e2f8548d70d
```

Use `--write` only for an intended refresh, then review the full diff. The script
reads the committed `crates/projector/testdata/golden/render-bundle.json` through
Git, never dirty working files. Add any new entry names to `PROTO_VIEWS` in
`packages/mui-kit/BUILD.bazel`; the capture pipeline verifies exact set equality.

`node --test schemas/tools/projector_catalog.test.mjs` verifies strict decoding
and served request destinations without requiring a private checkout. Removed
action/submit fields, unserved routes, direct row/header RPCs, duplicate names,
and unreviewed resource types are failures, not ignored fields or guessed routes.

The eleven-view catalog includes the actual RefreshTarget request form. Row and
header controls only open that form; its explicit submission owns the RPC and
input bindings. The capture harness grants no mutation permission. Sample cell
values remain synthetic structure examples, not live records or host navigation
grants. This does not upgrade the separate historical Studio producer or approve
merging, schema activation, deployment, or publication.
