# @savvifi/meridian-chat

The **conversation / agent-chat** renderer of the [meridian](https://github.com/meridian-ux)
renderer family. It renders a modality-neutral `meridian.ui.v1.Conversation`
stream (`conversation.proto` in `meridian-schemas` — the neutral promotion of
botnoc's `chat.v1`): a turn-based transcript of composable **blocks** (a
meridian-native block kit) + a transient **status**, over **SSE + POST**.

Two renderer tiers, one wire:

| tier | entry | deps | consumer |
| --- | --- | --- | --- |
| vanilla `<m-assistant-panel>` | `@savvifi/meridian-chat/web` + the Bazel `//:browser_bundle` | schemas, proto-ts, protobuf (bundled in browser ESM) | botnoc's static frontend |
| React `<Conversation>` | `@savvifi/meridian-chat` | shared schema dependencies + `react` (optional peer) | a Next.js host + React hosts |

The wire types (`src/wire.ts`) are **structural** (the proto3-JSON of
`ConversationEvent`). Optional `Block.Field.display` metadata is decoded with
protobuf-es and formatted by the shared schema formatter; a conformance test feeds real `toJson(ConversationEventSchema,…)`
frames through the model to keep them aligned to the canonical proto.

Field values remain strings. Absent, unspecified, unknown, or malformed display
metadata preserves the original text; numeric and boolean strings are never
coerced. Relative timestamps use absolute text without a supplied clock, and
principal email titles are retained on web surfaces. Field links remain text:
this transcript surface has no host route resolver. Table cells retain their
existing behavior.

## Embedded views

Without a React `renderView` callback, both transcript tiers show an escaped,
read-only text projection of `Block.view`, using the same Rust/WASM kernel as
the native transcript. Headers, sections, nested views, all labeled tabs, and
authored panel content remain readable. A supplied callback still takes precedence.

This fallback has no transport, clock, selection context, or route resolver.
Actions and destinations are inert text; remote data is explicitly unavailable.
Canonical header, slot and table collections take precedence as a whole,
including explicitly empty collections. Canonical form submission metadata also
suppresses legacy submission even when no target is supplied. All seven typed
destinations are described without execution; copy payloads stay hidden and
open-panel destinations never expand their target content. This uses the same
bounded Rust projection in both browser transcript tiers and native transcripts.
Selection gates stay closed, repeated views show one labeled template, masked
defaults are hidden, and LLM prompt templates are not expanded. This is not a
substitute for a composed interactive host or its integration tests.

Projection is bounded to 1 MiB, 4,096 newline characters, 1,000 visited nodes,
and depth 64. The WASM input limit is 4 MiB. Before protobuf JSON decoding, the
chat adapter admits bounded own data (65,536 nodes, depth 256, and a conservative
4 MiB text-work budget), rejecting cycles and accessors without calling them.
This is not a sandbox for arbitrary JavaScript Proxy traps. Control characters
other than newline/tab are escaped. Rejected input produces a fixed unavailable
message without echoing the input.

For an interactive React host, decode the callback's proto3-JSON with the host's
canonical `ViewDescriptorSchema`, then render `ViewRenderer` under a
`MeridianProvider`. The host owns descriptor admission, selection/record context,
transport, mutation allowlists, and component identity on view replacement.
Supply explicit `MeridianProvider.invocation` capabilities and target policy for
non-RPC targets; there is no implicit router, command runner, clipboard or
panel/view mount. User-triggered RPC targets require mutation admission, including
Get/List. A streamed descriptor, visible button or focus event grants nothing.
Composed-view rows receive full available transcript width rather than the
ordinary 82% message-bubble cap; ordinary messages keep their existing sizing.

The [rich-host conformance adapter](../mui-kit/harness/conversation.tsx) and
[real-browser test](../mui-kit/tests_browser/conversation.cjs) exercise this seam
using local canonical HTTP/SSE fixtures, all three React kits, the fourteen shared
layouts, same-ID replacements, replay suppression, denied/admitted actions, and
late-read isolation. This example's fake fixture invoker is not a production
backend or authorization implementation. Run
`bazel test --announce_rc=false //packages/mui-kit:conversation_browser_test`.

The same real HTTP/SSE test also exercises 75 unified invocation mounts across
the three kits: all seven targets admitted/denied, missing host capabilities,
canonical empty/missing intents, safe destination denial, actual Rust RPC
bindings with false/zero/raw Unicode, failed retry, same-ID streamed replacement,
noncooperative duplicate suppression/cancellation, focus return and stale refresh
suppression. It verifies no legacy transport, clipboard or implicit panel fallback
and no posted conversation turn. This is evidence for this explicitly wired rich
host, not permission for arbitrary chat hosts or full native interactive adoption.

## Transport

- `sse-url` (default `/api/noc-agent/view`) — SSE of `ConversationEvent` frames,
  deduped by `seq`, blocks upserted by `blockId` (a `tool` block flips
  running→ok in place).
- `turn-url` (default `/api/noc-agent/turn`) — POST `{ message }`.

`seq` is a protobuf `uint64`: send canonical decimal strings for the full range
`0` through `18446744073709551615`. Deduplication preserves the exact integer,
including adjacent IDs above JavaScript's safe-integer limit. Safe nonnegative
legacy numeric IDs remain accepted and deduplicate with the equivalent decimal
string. Missing, malformed, out-of-range, or already-rounded numeric IDs do not
receive a deduplication key; the event still follows the existing rendering path.
This is replay suppression, not authentication, ordering, or replay protection
across independent connections. Do not convert canonical sequence strings to
JavaScript numbers in a transport adapter.

A mounted React component or one web-component instance owns one conversation's
transcript and replay identities. Changing the SSE URL reconnects the transport;
it does not reset that conversation. Remount with a new React `key`, or create a
new web-component instance, when switching conversations. Removing/reinserting
the same element retains its rows and unsent draft, closes the old stream, and
opens one current stream. Frames from closed/replaced streams are ignored before
they can mutate state or consume replay identities. Reconnecting never posts a
turn by itself. Hosts must scope both transport endpoints to their conversation;
these lifecycle rules are not an authorization boundary.

## React usage

```tsx
import { Conversation, CONVERSATION_CSS } from "@savvifi/meridian-chat";

<style>{CONVERSATION_CSS}</style>
<Conversation sseUrl="/api/noc-agent/view" turnUrl="/api/noc-agent/turn" />
```

## Vanilla usage (bundler-free host)

```html
<m-assistant-panel sse-url="/api/noc-agent/view" turn-url="/api/noc-agent/turn"></m-assistant-panel>
<script type="module">
  import { registerAssistantPanel, ASSISTANT_PANEL_CSS } from "/meridian/meridian_chat.bundle.js";
  document.head.append(Object.assign(document.createElement("style"), { textContent: ASSISTANT_PANEL_CSS }));
  registerAssistantPanel();
</script>
```

The DOM (`form.asst-input` / `input.asst-text`) is preserved so a host driving
the composer externally (e.g. botnoc's voice layer) keeps working; a cleaner
imperative `panel.submit(text?)` is also provided.

## Development

See the repository's [v1 API review](../../API_STABILITY.md) for the exported
surface, submission events, and declaration-consumer regression checks.

```bash
pnpm install
pnpm test               # vitest: model + renderers + proto conformance
bazel build //:pkg //:browser_bundle
```
