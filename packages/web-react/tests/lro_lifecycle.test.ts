// @vitest-environment jsdom
import { create } from "@bufbuild/protobuf";
import { act, createElement, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { PanelDescriptorSchema } from "@savvifi/meridian-proto-ts/proto/panel_pb.js";
import { FieldBindingSchema } from "@savvifi/meridian-proto-ts/proto/rpc_pb.js";
import { htmlKit } from "../src/html_kit.js";
import { shadcnKit } from "../src/shadcn_kit.js";
import { MeridianProvider } from "../src/provider.js";
import { MeridianSelectionContext } from "../src/pagination.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
function fixture() {
  return create(PanelDescriptorSchema, { body: { case: "lro", value: {
    start: { service: "demo.Jobs", method: "Start" }, runButtonLabel: "Run job",
    inputs: [{ fieldId: "value", label: "Value", kind: { case: "text", value: { defaultValue: "001.20" } } }],
    finalize: { service: "demo.Jobs", method: "Finalize", bindings: [
      { requestField: "token", source: { case: "rowField", value: "token" } },
      { requestField: "input", source: { case: "formField", value: "value" } },
    ] },
    result: { rowsField: "items", columns: [{ header: "Result", fieldPath: "name" }],
      populate: { service: "must.not", method: "Read" } },
  } } });
}
function deferred() { let resolve!: (value: object) => void; const promise = new Promise<object>(done => { resolve = done; }); return { promise, resolve }; }

describe.each([["HTML", htmlKit], ["Shadcn", shadcnKit]] as const)("%s LRO lifecycle", (_, kit) => {
  async function mount(invoke: (service: string, method: string, request: object) => Promise<object>, mutations = ["demo.Jobs/Start", "demo.Jobs/Finalize"], reads?: string[]) {
    const container = document.createElement("div"), root = createRoot(container), onDenied = vi.fn();
    document.body.append(container);
    const invoker = { invoke }, admission = { mutations, reads, onDenied };
    const render = async (descriptor = fixture(), values: Record<string, string> = {}) => {
      if (descriptor.body.case !== "lro") throw new Error("fixture arm");
      await act(async () => root.render(createElement(StrictMode, { children: createElement(MeridianProvider, {
        kit, adhoc: {}, invoker, admission,
        children: createElement(MeridianSelectionContext.Provider, { value: { values, set: () => {} },
          children: createElement(kit.Lro, { descriptor, panel: descriptor.body.value, invoker }) }),
      }) })));
    };
    await render();
    return { container, render, onDenied, close: async () => { await act(async () => root.unmount()); container.remove(); } };
  }
  const submit = (container: HTMLElement) => container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));

  it("polls then finalizes with raw bindings and renders results without result-populate RPCs", async () => {
    const poll = deferred();
    const invoke = vi.fn(async (_s: string, method: string, _request: object) => method === "Start"
      ? { name: "operations/scoped", done: false, metadata: { status_message: "Working" } } : method === "WaitOperation" ? poll.promise : { items: [{ name: "Finished raw 001.20" }] });
    const view = await mount(invoke);
    try {
      expect(invoke).not.toHaveBeenCalled();
      await act(async () => { submit(view.container); submit(view.container); });
      expect(invoke).toHaveBeenCalledTimes(2);
      expect(view.container.textContent).not.toContain("Done.");
      expect(view.container.textContent).toContain("Working");
      expect(view.container.querySelector<HTMLButtonElement>('[type="submit"]')!.disabled).toBe(true);
      expect(invoke).toHaveBeenNthCalledWith(2, "google.longrunning.Operations", "WaitOperation", { name: "operations/scoped", timeout: { seconds: 5 } });
      await act(async () => poll.resolve({ name: "operations/scoped", done: true, response: { "@type": "type.googleapis.com/demo.Result", token: "raw-token" } }));
      expect(invoke).toHaveBeenCalledTimes(3);
      expect(invoke).toHaveBeenLastCalledWith("demo.Jobs", "Finalize", { token: "raw-token", input: "001.20" });
      expect(view.container.querySelector("table")?.textContent).toContain("Finished raw 001.20");
      expect(view.container.textContent).toContain("Done.");
      expect(view.container.querySelector<HTMLButtonElement>('[type="submit"]')!.disabled).toBe(false);
    } finally { await view.close(); }
  });

  it.each(["start", "poll", "operation", "finalize", "denied-finalize", "denied-poll"])("shows %s failure and retains raw inputs for retry", async phase => {
    let fail = true;
    const invoke = vi.fn(async (_s: string, method: string, _request: object) => {
      if (fail && ((phase === "start" && method === "Start") || (phase === "poll" && method === "WaitOperation") || (phase === "finalize" && method === "Finalize"))) throw new Error(`${phase} offline`);
      if (method === "Start") return { name: "operations/test", done: false };
      if (method === "WaitOperation") return fail && phase === "operation" ? { name: "operations/test", done: true, error: { message: "operation failed" } } : { name: "operations/test", done: true, response: { token: "token" } };
      return { items: [{ name: "recovered" }] };
    });
    const view = await mount(invoke, phase === "denied-finalize" ? ["demo.Jobs/Start"] : undefined, phase === "denied-poll" ? [] : undefined);
    try {
      await act(async () => { submit(view.container); });
      expect(view.container.querySelector('[role="alert"]')?.textContent).toBeTruthy();
      expect(view.container.textContent).not.toContain("Done.");
      expect(view.container.querySelector<HTMLInputElement>("input")!.value).toBe("001.20");
      expect(view.container.querySelector<HTMLButtonElement>('[type="submit"]')!.disabled).toBe(false);
      if (phase.startsWith("denied")) {
        expect(view.onDenied).toHaveBeenCalledWith(expect.objectContaining({ tier: phase === "denied-poll" ? "read" : "mutation" }));
        expect(invoke.mock.calls.some(call => call[1] === "Finalize")).toBe(false);
      } else {
        fail = false; await act(async () => { submit(view.container); });
        expect(view.container.querySelector('[role="alert"]')).toBeNull();
        expect(view.container.textContent).toContain("recovered");
      }
    } finally { await view.close(); }
  });

  it("discards a replaced panel's pending poll and never finalizes it", async () => {
    const oldPoll = deferred();
    const invoke = vi.fn(async (_s: string, method: string) => method === "Start" ? { name: "operations/old", done: false } : oldPoll.promise);
    const view = await mount(invoke);
    try {
      await act(async () => { submit(view.container); });
      const replacement = fixture(); if (replacement.body.case !== "lro") throw new Error();
      replacement.body.value.runButtonLabel = "Replacement";
      await view.render(replacement);
      await act(async () => oldPoll.resolve({ name: "operations/old", done: true, response: {} }));
      expect(invoke).toHaveBeenCalledTimes(2);
      expect(view.container.textContent).not.toContain("Done.");
      expect(view.container.querySelector("table")).toBeNull();
    } finally { await view.close(); }
  });

  it("renders an immediate operation response without a finalize call", async () => {
    const invoke = vi.fn(async () => ({ done: true, response: { items: [{ name: "Immediate result" }] } }));
    const view = await mount(invoke);
    const p = fixture(); if (p.body.case !== "lro") throw new Error();
    p.body.value.finalize = undefined;
    try {
      await view.render(p); await act(async () => { submit(view.container); });
      expect(invoke).toHaveBeenCalledOnce();
      expect(view.container.querySelector("table")?.textContent).toContain("Immediate result");
      expect(view.container.textContent).toContain("Done.");
    } finally { await view.close(); }
  });

  it("invalidates observation when a finalize selection dependency changes", async () => {
    const poll = deferred(), invoke = vi.fn(async (_s: string, method: string) => method === "Start" ? { name: "operations/old", done: false } : poll.promise);
    const p = fixture(); if (p.body.case !== "lro") throw new Error();
    p.body.value.finalize!.bindings.push(create(FieldBindingSchema, { requestField: "scope", source: { case: "selectionKey", value: "scope" } }));
    const view = await mount(invoke);
    try {
      await view.render(p, { scope: "old" });
      await act(async () => { submit(view.container); });
      await view.render(p, { scope: "new" });
      await act(async () => poll.resolve({ name: "operations/old", done: true, response: { token: "old" } }));
      expect(invoke).toHaveBeenCalledTimes(2);
      expect(view.container.textContent).not.toContain("Done.");
      expect(view.container.querySelector("table")).toBeNull();
      expect(view.container.querySelector<HTMLButtonElement>('[type="submit"]')!.disabled).toBe(false);
    } finally { await view.close(); }
  });

  it("times out a hanging host call and ignores its late completion", async () => {
    vi.useFakeTimers();
    const pending = deferred(), invoke = vi.fn(() => pending.promise);
    const view = await mount(invoke);
    try {
      await act(async () => { submit(view.container); });
      await act(async () => { await vi.advanceTimersByTimeAsync(30 * 60 * 1000); });
      expect(view.container.querySelector('[role="alert"]')?.textContent).toContain("Timed out");
      expect(view.container.querySelector<HTMLButtonElement>('[type="submit"]')!.disabled).toBe(false);
      await act(async () => pending.resolve({ name: "operations/late", done: true, response: {} }));
      expect(invoke).toHaveBeenCalledOnce();
      expect(view.container.textContent).not.toContain("Done.");
    } finally { await view.close(); vi.useRealTimers(); }
  });

  it("bounds a host that returns unfinished polls immediately", async () => {
    const invoke = vi.fn(async () => ({ name: "operations/no-wait", done: false }));
    const view = await mount(invoke);
    try {
      await act(async () => { submit(view.container); });
      expect(invoke).toHaveBeenCalledTimes(361); // One start, at most 360 polls.
      expect(view.container.querySelector('[role="alert"]')?.textContent).toContain("Timed out");
      expect(view.container.querySelector<HTMLButtonElement>('[type="submit"]')!.disabled).toBe(false);
    } finally { await view.close(); }
  });

  it.each(["identity", "malformed", "oversize", "unsafe-finalize", "payload-type"])("rejects %s responses/requests before follow-up dispatch", async failure => {
    const p = fixture(); if (p.body.case !== "lro") throw new Error();
    if (failure === "unsafe-finalize") p.body.value.finalize!.bindings.push(create(FieldBindingSchema, { requestField: "__proto__.bad", source: { case: "literal", value: "no" } }));
    if (failure === "payload-type") p.body.value.responseType = "demo.Expected";
    const invoke = vi.fn(async (_s: string, method: string) => method === "Start" ? { name: "operations/test", done: false }
      : failure === "identity" ? { name: "operations/other", done: true } : failure === "malformed" ? { name: "operations/test", done: "true" }
      : { name: "operations/test", done: true, response: { "@type": "type.googleapis.com/demo.Result", token: failure === "oversize" ? "x".repeat(800_000) : "ok" } });
    const view = await mount(invoke);
    try {
      await view.render(p); await act(async () => { submit(view.container); });
      expect(view.container.querySelector('[role="alert"]')?.textContent).toBeTruthy();
      expect(invoke).toHaveBeenCalledTimes(2);
      expect(view.container.querySelector("table")).toBeNull();
    } finally { await view.close(); }
  });
});
