# Draft combined Affordance removal candidate

The owner authorized preparation of one combined `1.0.0-alpha.1` removal
candidate, including retirement of AffordanceStyle. This is **not** authorization
to merge, select a production compatibility baseline, activate roadmap writes,
publish any package/image/chart, create a release tag, or deploy.

The draft source removes the nine legacy fields and reserves both their names
and numeric tags. It removes Command's now-empty `action` oneof, the obsolete
Action/RowAction/OpenPanel messages, and AffordanceStyle. Surviving canonical
types, fields, options, tags, and dependencies remain exact. ValueTone is not
part of this removal. Public-import facade paths remain present; removed
generated symbols are intentional major-version API breaks, not shim DTOs.

## Exact, separate audit reference

`schemas/compat/v1-additive-pre-removal.binpb` is the full schemas-module image
compiled without source information from additive public revision
`412d3e15f92e9396f9966e388aafa5576e1a592d`. Its SHA-256 is
`6dfcee54b85b39b59c4b1bb17d241a02eccfa37441d5c742db480b87c1e0a968`.
It is an audit input for the removal transition, **not an active FILE baseline**.
Existing `pre-v1.binpb`, `v1-affordance-candidate.binpb`, and `buf.yaml` are
unchanged. The maintained FILE comparison must continue to reject the breaking
candidate; do not call that rejection production success.

`affordance_removal.mjs` derives the expected descriptor transformation from
that reference, then compares the entire image. The only permitted changes are
the nine removals/reservations, Command oneof retirement, and four type removals.
There are no broad ignores. Whole-image comparison also rejects reintroduction
of retired full names (protobuf has no package-level name reservation syntax).

```sh
node_modules/.bin/buf build schemas --as-file-descriptor-set \
  --exclude-source-info -o /path/to/removal.binpb
node schemas/tools/affordance_removal.mjs --check /path/to/removal.binpb
node --test schemas/tools/affordance_removal.test.mjs
```

The tests compile actual source, assert all reservations and retained types,
reject unrelated changes and incomplete/duplicate descriptors, and test that old
binary fields do not invent canonical intent. Strict new JSON rejects old field
names. Unknown wire-byte preservation is not compatibility or authorization.

## Current implementation boundary

The core, TUI, shared browser dispatcher, React reference kits, MUI, and
web-components production readers now use canonical intent only. No retired
semantic resolver, implicit row-ID binding, deep-link-as-target fallback, or raw
native mutation handoff remains. MUI entity navigation requires a concrete
host-resolved destination plus canonical admission; mutations remain explicit
form/request-view operations. Canonical refresh policy is authored, not inferred
from a retired row envelope. ResourceAction's distinct existing contract remains.

The committed Cargo descriptor was regenerated through the supported Bazel
producer. The full Cargo workspace test run passes, including all native
integration suites. The rebuilt synchronous WASM core passes the 116 shared
normalization/presentation/invocation tests. Focused React and web-components
tests exercise admission, consent, cancellation, raw request values, old-wire
traps, and bounded descriptor-byte ownership. Request/context JSON still rejects
opaque byte buffers. Generated Swift preview bindings and its 57 tests pass;
this does not promote SwiftUI to a full-parity release gate.

The immutable additive contract is tested against the separately digest-guarded
pre-removal image. The current committed runtime descriptor independently proves
all retirements and reservations. The exact whole-module removal and facade
suites remain fail-closed; unrelated deletions are not allowed. The generator's
`v1-surviving-imports.binpb` is derived from the old export inventory minus the
exact retirements. It is not selected by the production FILE-policy tool.
Both TypeScript and JavaScript/declaration generation preserve the nine surviving
import facades, without obsolete API shims. Development JavaScript uses explicit
`.js` import extensions so detached Node consumers can actually resolve it.

The corpus authoring tools now emit canonical form and layout intent. Their
binary/text artifacts were regenerated; native form goldens explicitly include
the authored target line. Goldens are still compared read-only during normal
tests, and the corpus-completeness gates remain unchanged.

Full removal validation is **not green yet**. Remaining work includes migrating
older browser action/row/form fixtures and semantic/AX snapshots, separating
additive cross-language migration probes from final-removal consumer probes,
coordinated downstream producer/host upgrades, and final installed/archive
consumer validation. Existing tests must be migrated to frozen bindings or
canonical expectations, not deleted or made expected failures. A broad local
Bazel run also timed out under competing builds; that run is a failure, not a
pass. Recheck without changing the test deadlines.

No final v1 baseline/version or release artifact is activated by these changes.
Keep the candidate draft/unmerged and preserve final exact-artifact cutover,
live automation, and publication as separate owner approvals.
