# MeridianUI — local SwiftUI preview

This is the public monorepo's native renderer foundation, not an external
`meridian-ui` dependency and not a claim of full v1 parity.

## Build and test

Use Xcode 26.2 or later / Swift 6.2 or later on macOS, the existing stable Rust
toolchain, Node 22, and the repository's pinned pnpm dependencies:

```sh
pnpm install --frozen-lockfile --ignore-scripts
rustup target add aarch64-apple-darwin x86_64-apple-darwin aarch64-apple-ios aarch64-apple-ios-sim x86_64-apple-ios
python3 tools/swiftui.py
# Optional iOS 16 device + simulator cross-build (no deployment):
python3 tools/swiftui.py --ios
```

The root Swift package exports `MeridianUI` and `MeridianProtos`. The preparer
resolves the exact SwiftProtobuf runtime/generator version in `Package.swift`
and `Package.resolved`, then uses the workspace Buf compiler and existing proto
modules. Generated bindings are ignored build outputs, never a second schema.
Only stale `Generated/*.pb.swift` files owned by this generator are removed.
After preparation, ordinary `swift build` / `swift test` work from the root.
Fresh source consumers must run preparation before building. This is not yet a
self-contained published Swift package.

Preparation builds the existing meridian-uiview crate with Cargo's staticlib
override (no change to its published crate types), then creates the ignored
.build/MeridianCoreFFI.xcframework. It contains universal macOS, arm64 iOS device,
and universal iOS simulator slices. A real C consumer cross-links all five
architectures and executes on the build host. No dynamic library loading,
distribution signing, installation, publication, or deployment occurs. Only the owned derived
XCFramework is replaced after every slice succeeds. Bazel ignores .build so
downloaded Swift dependency BUILD files do not become monorepo targets.

## Shared Rust core

MeridianCore.format takes canonical google.protobuf.Value and ValueDisplay and
returns FormattedValue, including optional supporting-title presence and an
optional explicit clock. MeridianCore.matchesFormPattern executes the same
bounded Rust Unicode regex helper as native forms and WASM; invalid patterns
throw without echoing input. There is no Swift formatter or Foundation regex
fallback. ABI version mismatch fails closed.

`MeridianCore.computeStat` accepts the canonical StatPanel and an optional,
already host-admitted google.protobuf.Value response. It returns the canonical
ComputedStat protobuf: formatted value, optional formatted delta (including
present empty), Trend, shared Tone, and series. Rust owns every computation,
including previous/series precedence, explicit overrides, numeric ValueDisplay,
unit suppression, dotted response paths, and the server display-string escape
hatch. No Swift numeric formatter, delta calculation, or trend inference is
added. Good/bad maps to SUCCESS/DANGER only when higher_is_better is present;
otherwise Tone stays NEUTRAL. This pure bridge does not fetch, admit, or execute
a populate RPC. The native Stat view and its separate admitted live-data
lifecycle use this same computation; neither promotes Stat coverage by itself.

The additive ABI symbol takes at most 1 MiB per panel/response, 64 KiB for its
nested ValueDisplay, and returns at most 4 MiB. Optional-response presence is
explicit. Dynamic protobuf Value numbers must be finite, matching the existing
native JSON-input policy. Authored StatPanel doubles follow the Rust kernel's
explicit nonfinite spellings rather than substituting zero. Output slots reset
on failure and use the same Rust-owned buffer/free contract as value formatting.

The C interface in crates/core/rust/uiview/include documents pointer ownership
and non-overlap obligations. It borrows inputs and returns Rust-owned output;
the Swift wrapper always frees that exact pointer/length after copying/decoding,
including decode failure. Limits are 64 KiB per declaration/pattern, 1 MiB per
value/input, 4 MiB per result, and 64 dynamic value levels. Prost's wire recursion
ceiling also applies, including wrapper messages. Invalid/nonfinite dynamic
numbers, malformed protobuf/UTF-8, invalid patterns, and limit violations yield
non-textual statuses, not serialized secrets or substituted values. Logical
safe integers follow the pinned WASM deserializer's representation, preventing
JSON/list fallback drift such as 1 versus 1.0. Unwinding panics are contained;
the library is built with unwind enabled. Invalid foreign pointers, double frees,
and process-level allocation failures are not recoverable API inputs.

## Native Stat and admitted populate requests

Stat displays the Rust-computed value, direction, delta, and caption. Semantic
success/danger colors come from the current light/dark palette; absent/invalid
tokens use native primary foreground, and explicit favorable/unfavorable text
keeps meaning independent of color. Without higher_is_better, changes are neutral.
The bounded sparkline uses at most 256 geometric samples, includes the endpoints,
and normalizes finite extremes before subtraction to avoid overflow. Nonfinite
history shows an explanation instead of a misleading plot.

To enable a populate RPC, a host supplies both callbacks explicitly:

```swift
let capability = MeridianRpcCapability(
    admit: { call, builtRequest in
        // Validate service/method, tenant/scope, request fields, and current policy.
        return .deny("") // Replace with the host's real policy.
    },
    invoke: { call, builtRequest in
        // Marshal the admitted protobuf Value through the host's real transport.
        // No transport is installed by MeridianUI.
        throw MeridianRpcError.unavailable
    }
)
let host = MeridianHost(rpcContext: context, rpc: capability)
```

The default host has no RPC capability, and the default capability admission
denies everything. `MeridianCore.buildRequest` passes canonical RpcCall and
RequestContext protobufs to the existing Rust RequestBuilder, not a Swift
reimplementation. Admission sees both the original call and fully assembled
request immediately before each transport call, including retries. Unknown
methods, authorization, scope requirements, marshaling, and destination policy
remain the host's responsibility. Missing service/method, malformed context,
duplicate exact context keys, and failed core validation never reach admission.

RequestContext's optional resource path distinguishes absent from present empty.
Form/signal/selection bags use repeated ContextValue entries to preserve exact
UTF-8 names; canonically equivalent names are distinct, while exact duplicates
fail. The pure C builder takes a 64 KiB call and 1 MiB context, returns at most
4 MiB, and applies the existing finite dynamic-number/depth-64 policy. It never
admits or invokes. Message bytes use the same Rust-owned result/free contract.

The view's keyed `.task` loads on mount and descriptor/context/capability changes;
Refresh/Retry rechecks policy. Rendering and inspection themselves stay inert.
An in-flight identical load is deduplicated. Deterministic protobuf bytes and
per-instance host/capability tokens key responses; old data is hidden immediately
when those identities change, before lifecycle cleanup. Replacement/cancellation
invalidates late results even if a transport ignores cancellation. Disappearance
cancels owned work; cooperative transports receive task cancellation. Hosts
should support cancellation and replace the capability object when changing
transport/authorization identity. Do not retain a capability across tenants.
Errors and denial reasons do not echo transport details or request payloads.
Invalid/non-object/nonfinite/oversized response data is not retained as a metric.
Authored data is the explicit loading/failure placeholder, with visible status.

## Host contract

```swift
import MeridianUI

// In a @MainActor host, retain this ObservableObject across view updates.
let host = MeridianHost() // Denies every effect by default.
let content = MeridianPanel(descriptor, host: host).meridianTheme(theme)
```

The host supplies both `admit` and an async `execute` capability. Every actual
activation reevaluates current host policy. The renderer does not call a shell,
open a URL, fetch content, or install a clipboard capability itself. Copy passes
literal text, including empty text; URI and command payloads remain distinct.
No policy or effect runs during rendering or selection. Missing/unknown targets
and absent capabilities fail closed. Pending activation suppresses duplicates;
failures do not echo request payloads or error descriptions into the UI.
Hosts remain responsible for destination/scheme and command policy, clipboard
authorization, confirmations, authenticated execution, and cancellation of
host-owned work when its presentation lifecycle ends.

Current controls: native Choice picker, preformatted Snippet with host-gated
copy, masked/revealable CopyValue with host-gated raw copy, Action, Catalog,
numbered Steps, ConnectFlow with target selection and per-target actions/configs,
and Stat with admitted populate loading, safe retry/cancellation, and a sparkline.
Choice and ConnectFlow use exact UTF-8 IDs: empty/duplicate IDs show an explanation
instead of a picker. Valid remembered selection survives reordering; removal
falls back to the declared default or first target. Selection never activates.
Steps includes actor badges and frame alternatives. Hosts may supply already
materialized `images: [Data: Image]` and `symbols: [Data: String]` maps keyed by
exact UTF-8 descriptor URI/icon bytes. Rendering only reads these maps; it never
fetches an image URI, guesses an icon name, or calls admission. Missing frames
show authored alternative text (or an explicit unavailable label).
CopyValue uses Rust formatting for a present, non-unspecified declaration;
absent/unspecified declarations keep raw literal text. Hidden secrets bypass
formatting entirely and expose neither formatted labels nor supporting titles.
Reveal state is keyed to exact raw UTF-8 bytes, so replacing a revealed secret
cannot expose its replacement before view-update callbacks run. Copy always
sends the original raw string through host policy, never the formatted label.
Unsupported/empty/future panels display an explanation without dispatching.
Theme light/dark presence and foreground/accent/surface roles are mapped;
invalid hex values use platform semantic defaults. Text uses scalable native
fonts. This foundation deliberately does not fetch remote fonts or images.

## Evidence and remaining work

The macOS SwiftPM tests decode and round-trip all 24 canonical panel fixtures,
preserve unknown wire arms, construct/layout real NSHostingViews without effects,
and exercise current policy, missing capability, empty/raw copy, raw commands,
unknown targets, pending duplicates, cancellation, safe errors, and retry.
Theme parsing/presence and Choice defaults are tested too.
The package's native tests also execute all 355 authored shared formatter
goldens (including 133 explicit-clock cases and their no-clock twins), all 16
authored regex cases, embedded NUL input, oversized/nonfinite rejection, and
visible/hidden CopyValue formatting through the actual static Rust library.

The test-only ViewInspector dependency is pinned to 0.10.5. Content-flow tests
inspect actual SwiftUI view bodies, compare an authored ordered Steps text
golden, and invoke real Picker/Button callbacks. They verify inactive-target
removal, raw clipboard bytes, current policy, malformed IDs, exact-byte selection
and asset keys, declared image alternatives, hidden-secret output, empty states,
and unknown-panel fallback. This is reflection-based runtime view inspection,
not a computed OS accessibility tree, VoiceOver test, pixel snapshot, overflow
check, or iOS runtime interaction test. It adds no production inspection hooks.
A local public AppKit accessibility probe returned no SwiftUI child tree in the
non-accessibility-trusted test process; that probe is not counted as passing
accessibility evidence and no permission changes are requested by the suite.

### Initial native view projections

`ViewDumpTests` inspects `MeridianPanel` over all 24 canonical panel fixtures.
The committed `schemas/conformance/swiftui/*.txt` files retain actual view paths,
text order within node categories, Label titles, button labels/disabled state,
picker labels/options/selection, image names, and declared accessibility labels.
Tooltip text is included when exposed by the inspected view. These are initial
view-body projections, not mounted application state or computed accessibility
trees. Unsupported arms intentionally snapshot their current explanation; the
golden does not claim they render their requested content. Separate callback
tests exercise selection, effects, and policy changes.

Ordinary `swift test` compares without writing and fails on missing/stale/extra
goldens. The shared presence gate independently requires one correctly formatted,
nonempty view dump for each declared panel arm plus the empty descriptor. It
does not register SwiftUI as a proven panel evidence owner or change coverage.
When a UI change is intentional, use the existing cross-renderer re-record path:

```sh
# macOS, with the build prerequisites above; also records browser goldens.
UPDATE_SNAPSHOTS=1 bazel run --announce_rc=false //:re_record_conformance -- --swiftui
# Read-only verification through the same entry point:
UPDATE_SNAPSHOTS=0 bazel run --announce_rc=false //:re_record_conformance -- --swiftui
```

The launcher runs from the actual Bazel workspace so explicit re-recording updates
source goldens, not runfiles. This is a developer entry point using installed
Xcode/Rust/Node prerequisites, not a hermetic Swift toolchain action. Native CI
executes the real Swift suite via `tools/swiftui.py --ios`; non-macOS callers of
`--swiftui` fail rather than substituting another renderer. No update flag is
enabled by default. Review recorded diffs and rerun read-only verification.

Native layout and view-body inspection are not accessibility-tree snapshots.
All 23 coverage cells remain `unverified`, with the existing full-parity waivers.
Remaining work includes all other panels; recursive view layouts; further shared
core request/normalization/form-validation bridging; populated state, bounded
streams and host RPC admission; full tone/emphasis/value-display/typography
mapping; actual native accessibility and interaction conformance; and iOS
runtime verification (iOS 16 device/simulator cross-builds and C link smokes do
not prove runtime UI behavior). Do not promote a cell based on
wire decoding or a layout smoke test. No issue closes with this foundation.
