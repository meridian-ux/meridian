# @savvifi/meridian-chat

The **conversation / agent-chat** renderer of the [meridian](https://github.com/meridian-ux)
renderer family. It renders a modality-neutral `meridian.ui.v1.Conversation`
stream (`conversation.proto` in `meridian-schemas` — the neutral promotion of
botnoc's `chat.v1`): a turn-based transcript of composable **blocks** (a
meridian-native block kit) + a transient **status**, over **SSE + POST**.

Two renderer tiers, one wire:

| tier | entry | deps | consumer |
| --- | --- | --- | --- |
| vanilla `<m-assistant-panel>` | `@savvifi/meridian-chat/web` + the Bazel `//:browser_bundle` | none (framework-free, ~11 KB) | botnoc's static frontend |
| React `<Conversation>` | `@savvifi/meridian-chat` | `react` (optional peer) | aion/web + React hosts |

The wire types (`src/wire.ts`) are **structural** (the proto3-JSON of
`ConversationEvent`), so the runtime has **no protobuf-es dependency** and the
bundle stays tiny; a conformance test feeds real `toJson(ConversationEventSchema,…)`
frames through the model to keep them aligned to the canonical proto.

## Transport

- `sse-url` (default `/api/noc-agent/view`) — SSE of `ConversationEvent` frames,
  deduped by `seq`, blocks upserted by `blockId` (a `tool` block flips
  running→ok in place).
- `turn-url` (default `/api/noc-agent/turn`) — POST `{ message }`.

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
