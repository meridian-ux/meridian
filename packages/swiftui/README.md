# MeridianUI — local SwiftUI preview

This is the public monorepo's native renderer foundation, not an external
`meridian-ui` dependency and not a claim of full v1 parity.

## Build and test

Use Xcode 26.2 or later / Swift 6.2 or later on macOS, Node 22, and the repository's
pinned pnpm dependencies:

```sh
pnpm install --frozen-lockfile --ignore-scripts
python3 tools/swiftui.py
# Optional iOS 16 cross-build (does not sign, install, or deploy):
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
copy, masked/revealable CopyValue with host-gated raw copy, Action, and Catalog.
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

Native layout is not an accessibility-tree snapshot or user-interaction test.
All 23 coverage cells remain `unverified`, with the existing full-parity waivers.
Remaining work includes all other panels; recursive view layouts; the shared
Rust core formatter/normalizer/form-validation bridge; populated state, bounded
streams and host RPC admission; full tone/emphasis/value-display/typography
mapping; actual native accessibility and interaction conformance; and iOS
runtime verification (the iOS 16 arm64 cross-build passes). In particular, CopyValue currently shows its raw
literal rather than implementing ValueDisplay. Do not promote a cell based on
wire decoding or a layout smoke test. No issue closes with this foundation.
