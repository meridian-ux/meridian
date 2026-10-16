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

```bash
pnpm install
pnpm test               # vitest: model + renderers + proto conformance
bazel build //:pkg //:browser_bundle
```
