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

## Historical compatibility versus actual removal consumers

`node schemas/tools/affordance_removal_probe.mjs --keep` checks two deliberately
separate phases. First it compiles the unchanged legacy TypeScript consumer in
both generation modes against the immutable pre-v1 and additive images (four
source compilations, 180 export checks). Those historical successes are not
removal compatibility claims. Then it builds today's full-module source image,
requires the exact removal transformation, and compiles the canonical consumer
against both TypeScript and JavaScript/declaration output. Typed negative checks
reject the removed fields, messages, and enum instead of introducing API shims.
Seven actual invocation variants also round-trip through generated JavaScript
and the retained additive reader without losing false/zero presence.

Both the maintained FILE reference and the separately retained additive image
must reject the removal image with Buf's explicit compatibility exit code 100;
tool failures or unexpected compatibility success fail the probe. Rejection
reports stay in its scratch directory. No reference selector is added or changed.

`node schemas/tools/affordance_consumer_probe.mjs` uses that actual removal
generation to compile all six public source projects. The retained `candidate.binpb`
is also supplied to the existing Rust and Swift `--canonical` package checks.
The Java `--removal` check preserves unchanged old bytecode tests for surviving
APIs, then separately compiles/runs `CanonicalAffordanceConsumer.java` against
the actual candidate: seven intents, nine field reservations, all four type
retirements, and old-submit wire denial. Legacy descriptor-owner assertions still
fail in both relocated worlds as before. These are implementation checks, not
schema cutover or publication authority.

The tests compile actual source, assert all reservations and retained types,
reject unrelated changes and incomplete/duplicate descriptors, and test that old
binary fields do not invent canonical intent. Strict new JSON rejects old field
names. Unknown wire-byte preservation is not compatibility or authorization.

## Current implementation boundary

An immutable Git archive of candidate revision
`5adedf0ee950c96603d5b97b75833ddea196eb30`, built with Buf 1.72.0 as a
source-info-free full-module descriptor, has SHA-256
`022c995b582690be2aea4f9c63126cfc93652a168c38d1f3e54c337aa824d55c`.
The exact removal checker passes. After accounting for the four retired full
names, 41 surviving declarations change file ownership relative to maintained
0.x; do not reuse the intermediate additive count of 45 as a final retained-move
count. Both retained FILE comparisons reject this image with exit 100. This is
an audit candidate, not a selected baseline or approved integrated release.

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

The retained-image Rust workspace and isolated Swift package checks now pass.
The pinned Java removal consumer and all six isolated public TypeScript source
projects pass as well. Historical compatibility and current removal evidence
remain separate; these successes do not activate a baseline.

The known browser action/row/form fixture migrations now pass complete local
React (9,282 tests), MUI (4,976), and launchpad (56) suites; all six public source
projects and the complete MUI source/test/harness configuration type-check.
MUI browser, Conversation browser, stateful/geometry, and layout checks pass.
All 1,708 computed AX trees pass normal read-only verification after reviewing
exactly 54 form trees for canonical policy-denial focusability/status changes.
Earlier failures/timeouts remain historical failures, not successes; passing
reruns kept the original deadlines and assertions.

The detached web-components npm consumer now checks actual removal artifacts,
not stale imports of removed Action APIs. It verifies strict public declarations,
retired API rejection, frozen historical wire, canonical admission/consent, raw
bindings, isolated browser imports, and runtime denial without legacy revival.
The coordinated private draft separately installs all five coupled SDK archives
from exact public runtime revision `df899525684ea7809ac0e9332bb05524f59b3a39`;
its renderer/app/producer tests and real loopback HTTP/SSE browser integration
pass. Published-profile evidence remains separate from candidate evidence.

Full removal validation is **not green yet**. Complete remote CI, the external
Studio producer migration, remaining consumer/notice inventory, and integrated
release-line verification are still required. The Studio catalog rejects the
producer's retired `actions` JSON key; do not bypass that strict decoder or
restore a compatibility shim. No targeted local success proves complete release
acceptance. Existing frozen compatibility inputs and FILE rejection checks stay
unchanged; the migration references above are audit inputs, not active baselines.

No final v1 baseline/version or release artifact is activated by these changes.
Keep the candidate draft/unmerged and preserve final exact-artifact cutover,
live automation, and publication as separate owner approvals.
