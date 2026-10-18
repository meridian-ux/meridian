# Browser invocation dispatcher candidate

`src/uiview/invocation.ts` consumes `NormalizedAction` through one host-owned
activation path. This is migration infrastructure, not evidence that a renderer
has adopted the contract or that the canonical schema can cut over.

## Adapter lifecycle requirement

Create one dispatcher per logical control. Its `readCurrent` callback must return
the current immutable `InvocationSnapshot`, or `undefined` after removal. Retain
that exact object until something changes. Replace it whenever the descriptor,
row/subject, form values, selection, identity, policy, capabilities, or semantic
resolver changes. Do not capture the initial descriptor in a click closure, mutate
nested context in place, or allocate a new snapshot on every read. Those patterns
do not satisfy this API's contract. Renderer adoption tests must exercise actual
updates and unmounts, not just call the engine with static fixtures.

Rendering, inspection, filtering, and focus do not call `activate`. On activation,
the dispatcher reads the current scope, performs optional pure legacy semantic
resolution/confirmation, evaluates `enabled_when` with the shared Rust predicate,
and admits the selected target. It checks scope identity after callbacks and
asynchronous work. A changed scope stops execution; retry starts again with the
new scope rather than executing the changed target under old confirmation.

Every RPC uses the existing mutation admission gate, including Get/List. The
existing denial observer remains active. Its request is built by the bounded
Rust `buildRequest` bridge. An optional contextual policy may further restrict
RPCs, never replace mutation admission. Non-RPC targets require both an explicit
typed capability and explicit contextual policy; there is no default router,
clipboard, shell, panel mount, or fallback invocation.

Legacy no-call action IDs are semantic keys. The resolver receives the original
Action proto, current context, and original subject identity; it returns a typed
Affordance plus an optional host confirmation callback. It must not execute the
old `onAction` callback. Confirmation cancellation stops execution; confirmation
acceptance is not an admission grant. Canonical targets never consult the legacy
resolver after denial. An empty semantic ID remains invalid.

## Results and cancellation

The runtime-only outcome contains static states/reasons, not raw payloads or
transport errors. Adapters must display/announce denied and failed outcomes,
expose pending state, and restore focus appropriately. This engine does not
implement a UI or claim accessibility acceptance for any modality.

`cancel` aborts best effort; it cannot reverse an already-sent request. Duplicate
activation stays blocked until the underlying operation settles, including when
an older three-argument `RpcInvoker` ignores abort. `dispose` permanently stops
that control. Late success or failure for a replaced scope does not refresh or
report failure against the replacement.

Only successful execution may refresh. Canonical false suppresses refresh;
normalized legacy rows retain observed always-refresh behavior. A refresh error
or missing requested refresh capability returns `succeeded` with `refresh:
"failed"`: the effect already happened and must not be replayed as a failed
mutation. Adapters should offer a separate read refresh, not an action retry.

## Remaining integration

### Submission builder foundation

An optional renderer-owned `InvocationSubmission` selects the existing bounded
Rust submission builder for an admitted RPC, with automatic field mapping and
bindings in one budget. Field declarations remain protobuf; validated collected
values must be captured in `context.formValues`. A protobuf PanelDescriptor
envelope is built only from those fields and the selected admitted call, never
from a competing legacy submit/start target. Form IDs remain literal, and
explicit bindings win automatic collisions. LRO retains its distinct existing
`request_field` path mapping. Row-id compatibility hints do not apply to either
mode. Construction failure never falls back to ordinary RPC request building.
Non-RPC targets still require explicit capabilities/policy and receive the same
current context; this marker is not a capability or an RPC permission grant.

Adapters must bound and own declarations, validate fields and dynamic options,
read the current collected values at activation and after asynchronous consent,
and replace snapshot identity on any form/input/policy/context change. The
builder does not perform input validation or decide that a UI is current. The
React form controls still use their legacy paths at this foundation stage;
connecting them, preserving validation and reset semantics, is required next.
No renderer-adoption acceptance box is satisfied by engine tests alone.

### Renderer adoption

Adopt this engine in actual web-components and React controls (all kits), header
and row actions, palette commands, conversation blocks, ActionPanel, and form
submission. Form adoption must retain validation and the existing bounded Rust
submission builder for automatic field mapping; a plain RPC binding test does
not establish form behavior. Coordinate native/TUI and private/public producer
adoption, document the compatibility window, and test real controls and host
updates. Keep the renderer issue acceptance boxes open until that evidence exists.

No FILE baseline, release scope, issue field, or production authority changes
are part of this dispatcher candidate. The canonical migration stack remains
approval-gated.
