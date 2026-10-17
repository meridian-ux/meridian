# Chat and launchpad: v1 API review

This records the existing public contract reviewed for roadmap issue #65. It does
not announce a 1.0 release or expand host execution permissions. The canonical
wire definitions remain `schemas/proto/conversation.proto` and
`schemas/proto/command_palette.proto`; the JSON shapes below are their existing
chat transport adapter, not a second serialization format.

## Entrypoints and dependency ownership

| Surface | Runtime exports |
| --- | --- |
| `@savvifi/meridian-chat` | `Conversation`, `BlockView`, `ConversationModel`, `CONVERSATION_CSS`, `isActiveStatus` |
| `@savvifi/meridian-chat/web` | `MAssistantPanel`, `registerAssistantPanel`, `ASSISTANT_PANEL_CSS`, `ConversationModel`, `isActiveStatus`, `renderBlockInner`, `escHtml`, `mdInline`, `shortName` |
| chat Bazel `browser_bundle` | `MAssistantPanel`, `registerAssistantPanel`, `ASSISTANT_PANEL_CSS` |
| `@savvifi/meridian-launchpad` | `Launchpad`, `filterLaunchpad`, `flatten`, `matchScore`, `commandHaystack` |

The chat root is the React tier. Vanilla consumers use `/web`, not the root;
React and React DOM are optional peers only for the vanilla tier. The standalone
ESM bundles shared schema/protobuf code but no React. Its exports are narrower
than `/web`. Registration is explicit and idempotent. The package export maps do
not promise arbitrary private `src/*` imports.

Chat exports `ConversationProps`, `ViewRenderer`, and the structural wire types
from both applicable entrypoints (`ConversationProps`/`ViewRenderer` are React
root only). `ViewBlock` stays an opaque JSON record: `renderView(view, block)`
returns a React node, and the host decodes the descriptor using its own generated
schema copy. Without the callback, React and vanilla HTML render a passive text
projection through the shared native/WASM core. This adds no panel kit or live
host: actions are text, gates stay closed without context, and repeated views
show their template once rather than fabricated rows. Malformed or oversized
descriptors produce a fixed unavailable message. The callback still takes
precedence and owns its own integration and authority boundaries.

View transcript rows use available width rather than the ordinary message-bubble
cap. Same-ID upserts recalculate view classification and role alignment in both
tiers; switching back to a primitive block restores ordinary message sizing.

Launchpad exports `LaunchpadProps` and `FilteredGroup`. Descriptors, commands,
resolver results, and `onRun` arguments use canonical protobuf-es messages, not
chat's JSON adapter. Hosts must resolve compatible `meridian-proto-ts` and
`meridian-web-react` peers; duplicating nominal generated types is not a supported
adapter. `FilteredGroup` is an in-memory view model, not a boundary DTO.

## Conversation props and transport

`Conversation` has optional `sseUrl`, `turnUrl`, `className`, `emptyState`
(React node), `placeholder`, `renderView`, and `initialMessage` props. SSE and
turn endpoints default to `/api/noc-agent/view` and `/api/noc-agent/turn`.
The composer trims a message, ignores blank submissions, and POSTs exactly
`{ message }` with JSON content type. It does not populate `conversationId`;
hosts scope endpoints/identity themselves. `TurnRequest.conversationId` remains
an optional canonical wire field for hosts that use it directly.

`initialMessage` sends at most once per mounted instance, including React
StrictMode effect replay. If initially absent, a later first nonempty value is
accepted; subsequent changes (including endpoint changes) do not resend it.
Whitespace-only input is not posted; a whitespace-only initial value consumes
the one-shot attempt without POSTing. This is a convenience submission, not an
authorization grant. React has no `turn-sent` event or completion callback prop.

For `<m-assistant-panel>`, `sse-url` reconnects the stream and `turn-url` is read
at submission. `submit(text?)` returns void; omitted text reads the composer.
It emits a `CustomEvent("turn-sent")` with `detail: { message: trimmedText }`
before invoking fetch. It bubbles, is not composed or cancelable, and reports
local intent even if the subsequent request fails. It is neither a server
acknowledgment nor a completion signal. HTTP/network failure re-enables sending;
a successful POST waits for stream `done`/`error`. No automatic retry of POST
or server-side idempotency is promised.

SSE data is canonical proto3 JSON: one event with `block`, `status`, `done`, or
`error`; a block uses `markdown`, `context`, `tool`, `list`, `fields`, `code`,
`divider`, `table`, or `view`. The JSON adapter's optional fields and permissive
tone values support absent/unknown data; they are not runtime validation of
arbitrary frames. Hosts should produce valid canonical oneofs and stable block
IDs. The model upserts by block ID in first-arrival order, tracks active status
and the last error, and exposes `blocks`, `status_`, `error_`, `ingest`, `reset`.
`ingest` returns false for a duplicate sequence, not as a validity predicate.
`reset` clears blocks, status, last error and replay identities.

Sequence IDs preserve full uint64 decimal strings. Safe legacy numbers remain
accepted; invalid IDs do not gain deduplication keys. Dedupe is instance-scoped,
not authentication or a monotonic ordering check. Endpoint replacement retains
the mounted conversation: use a fresh React key or new web-component instance
for another conversation. Closed/replaced-source frames must not mutate state
or consume IDs; same-instance DOM reconnection retains rows and draft. These
lifecycle requirements have dedicated regressions in PR #140.

## Launchpad props, callbacks, and pure helpers

Required props are a canonical `descriptor`, controlled `open`, and `onClose`.
Optional callbacks are `onNavigate(route)`, `onOpenView(viewId)`, `onRun(command)`,
and `onResolveQuery(query): Promise<Command[]>`; `agentGroupTitle` defaults to
`Ask the agent`. It needs a `MeridianProvider`. The host owns the open gesture;
opening resets transient query/focused-panel state. Escape/backdrop and terminal
dispatch request closing; an `openPanel` action enters a focused step instead.

Admitted deep links take precedence over actions and use browser navigation.
Navigate actions use `onNavigate` or browser navigation; unsafe destinations are
disabled and emit neither `onRun` nor `onClose`. Open-view actions use
`onOpenView` or the provider handler with `("open-view", viewId)`. RPC actions use
the provider mutation invoker with service, method and an empty request object;
the host's mutation allowlist remains authoritative and defaults to deny.

`onRun` receives the original canonical command after local dispatch, including
an attempted RPC denied by admission. It is synchronous telemetry, not a Promise
of RPC success: RPC failures are not surfaced by this callback. For terminal
actions, `onClose` runs before `onRun`. `openPanel` notifies without closing.
Host callback exceptions are not converted to transport failures by this API.

Resolver queries are trimmed and debounced 250 ms while open. Changing the
query/resolver, closing or unmounting invalidates previous results; it cannot
abort host work already started. Synchronous throws/rejections leave no agent
results. Resolving never dispatches commands. See the package README and agent
lifecycle tests for the full behavior.

`filterLaunchpad(descriptor, query)` returns groups of original command messages;
empty queries preserve declared order and prepend resolvable default IDs under
`Suggestions`. Nonempty queries use case-insensitive subsequence matching over
title, subtitle and keywords, ranked within each group. `flatten(groups)` returns
keyboard order. `commandHaystack(command)` joins searchable text;
`matchScore(haystack, query)` returns a lower-is-better score or null. These are
pure helpers, not a transport, authorization layer, or global ranking promise.

## Enforced review evidence and release boundary

The API runtime tests pin each tier's namespace and submission/notification
behavior. Compile-only `api_contract_types` targets consume emitted public
declarations and pin prop keys/types, callback signatures, model methods, named
wire exports, and canonical launchpad types. Existing suites additionally cover
canonical proto JSON, sequence identity, block upserts, value/tone rendering,
view forwarding, navigation admission and resolver cancellation.

Run `bazel build //packages/chat/tests:api_contract_types
//packages/launchpad:api_contract_types` and `bazel test //...`; the full build/test
pattern includes the declaration consumers. Source Vitest alone does not
typecheck those compile-only assertions. Export/signature changes require an
intentional review and corresponding contract/test updates, not silent removal
to make CI pass.

Versions remain pre-1.0 until the complete roadmap and release checks pass.
The selected distribution contracts are crates.io for the Rust packages and npm
for web-components; [DISTRIBUTION.md](DISTRIBUTION.md) defines preparation and
detached-consumer checks, not publication authorization. SwiftUI retains its
documented preview scope: existing preview tests remain required, but full native
parity is not a v1 gate and unverified coverage must stay explicit. Production
Affordance migration and any FILE-baseline transition still require separate
review and approval. Neither this contract nor passing checks authorizes package
publication or production deployment.
