import { describe, expect, it } from "vitest";

import { ConversationModel } from "../src/model.js";
import type { ConversationEvent } from "../src/wire.js";
import { conformanceMarkdownEvent, conformanceViewEvent } from "./fixtures.js";

describe("ConversationModel", () => {
  it("ingests a canonical proto3-JSON event (conformance)", () => {
    const ev = conformanceMarkdownEvent();
    // The structural type sees the promoted proto's JSON shape.
    expect(ev.block?.markdown?.text).toBe("hello **world**");
    const m = new ConversationModel();
    expect(m.ingest(ev)).toBe(true);
    expect(m.blocks).toHaveLength(1);
    expect(m.blocks[0].markdown?.text).toBe("hello **world**");
  });

  it("dedups by seq", () => {
    const m = new ConversationModel();
    const ev: ConversationEvent = {
      seq: 5,
      block: { blockId: "a", role: "assistant", markdown: { text: "x" } },
    };
    expect(m.ingest(ev)).toBe(true);
    expect(m.ingest(ev)).toBe(false);
    expect(m.blocks).toHaveLength(1);
  });

  it("upserts a block by blockId (streaming) preserving arrival order", () => {
    const m = new ConversationModel();
    m.ingest({ seq: 1, block: { blockId: "t", role: "assistant", tool: { name: "forge·list", state: "RUNNING" } } });
    m.ingest({ seq: 2, block: { blockId: "m", role: "assistant", markdown: { text: "hi" } } });
    m.ingest({ seq: 3, block: { blockId: "t", role: "assistant", tool: { name: "forge·list", state: "OK", summary: "3 repos" } } });
    expect(m.blocks.map((b) => b.blockId)).toEqual(["t", "m"]);
    expect(m.blocks[0].tool?.state).toBe("OK");
    expect(m.blocks[0].tool?.summary).toBe("3 repos");
  });

  it("tracks transient status and clears it on done", () => {
    const m = new ConversationModel();
    m.ingest({ seq: 1, status: { state: "THINKING" } });
    expect(m.status_?.state).toBe("THINKING");
    m.ingest({ seq: 2, status: { state: "WORKING", detail: "Calling forge" } });
    expect(m.status_?.state).toBe("WORKING");
    m.ingest({ seq: 3, done: { stopReason: "end_turn" } });
    expect(m.status_).toBeNull();
  });

  it("records a turn error and clears status", () => {
    const m = new ConversationModel();
    m.ingest({ seq: 1, status: { state: "THINKING" } });
    m.ingest({ seq: 2, error: { message: "boom" } });
    expect(m.error_).toBe("boom");
    expect(m.status_).toBeNull();
  });

  it("coerces a string seq (canonical uint64 JSON)", () => {
    const m = new ConversationModel();
    m.ingest({ seq: "7", block: { blockId: "a", markdown: { text: "x" } } });
    expect(m.ingest({ seq: "7", block: { blockId: "a", markdown: { text: "y" } } })).toBe(false);
  });
});

describe("conformance: the view arm (schemas 0.21.0)", () => {
  it("a real proto view block decodes into the structural wire type", () => {
    const ev = conformanceViewEvent();
    const model = new ConversationModel();
    expect(model.ingest(ev)).toBe(true);

    const [block] = model.blocks;
    expect(block?.blockId).toBe("v1");
    // The descriptor must arrive INTACT — meridian-chat forwards it opaquely, so
    // anything it silently reshaped here would reach the host renderer wrong.
    const view = block?.view as Record<string, unknown> | undefined;
    expect(view?.id).toBe("demo");
    expect(view?.title).toBe("Demo");

    // proto3-JSON flattens both oneofs: the layout mode and the panel body arm
    // sit as sibling keys, never nested under `mode` / `body`. Getting this wrong
    // is what makes a renderer draw nothing, so pin it here against the REAL
    // generated encoder rather than against our own assumption.
    const layout = view?.layout as Record<string, unknown>;
    expect(layout).toHaveProperty("stacked");
    expect(layout).not.toHaveProperty("mode");

    const slots = view?.slots as Array<Record<string, unknown>>;
    const panel = slots[0]!.panel as Record<string, unknown>;
    expect(panel).toHaveProperty("stat");
    expect(panel).not.toHaveProperty("body");
    // A double stays a number through proto3-JSON — the StatPanel.value trap.
    expect((panel.stat as Record<string, unknown>).value).toBe(42);
  });
});
