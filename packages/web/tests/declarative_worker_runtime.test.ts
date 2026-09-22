import { afterEach, describe, expect, it, vi } from "vitest";

import { defineDeclarativeMeridianWorker } from "../src/declarative_worker_runtime.js";

type WorkerMessageHandler = (event: MessageEvent) => Promise<void>;

function installWorker() {
  let handler: WorkerMessageHandler | undefined;
  const postMessage = vi.fn();
  vi.stubGlobal("self", {
    addEventListener: (_name: string, callback: WorkerMessageHandler) => {
      handler = callback;
    },
    postMessage,
  });
  return {
    postMessage,
    dispatch: async (data: unknown) => {
      if (!handler) throw new Error("worker message handler was not installed");
      await handler({ data } as MessageEvent);
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("declarative worker fetch admission", () => {
  it("fetches an admitted interpolated HTTP target", async () => {
    const worker = installWorker();
    const fetchMock = vi.fn().mockResolvedValue({ json: async () => ({ ok: true }) });
    vi.stubGlobal("fetch", fetchMock);
    defineDeclarativeMeridianWorker({
      transitions: {
        run: [{ effect: "fetch", params: { url: "/api/${payload.id}", body: "${payload}" } }],
      },
    });

    await worker.dispatch({ type: "event", name: "run", payload: { id: "42" } });

    expect(fetchMock).toHaveBeenCalledWith("/api/42", {
      method: "POST",
      body: JSON.stringify({ id: "42" }),
    });
  });

  it("rejects an interpolated active target before fetch and follows onError", async () => {
    const worker = installWorker();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    defineDeclarativeMeridianWorker({
      transitions: {
        run: [{
          effect: "fetch",
          params: { url: "${payload.url}" },
          onError: [{ type: "failed" }],
        }],
        failed: [{ effect: "postMessage", params: { type: "fetchRejected" } }],
      },
    });

    await worker.dispatch({
      type: "event",
      name: "run",
      payload: { url: "javascript:alert(1)" },
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(worker.postMessage).toHaveBeenCalledWith({ type: "fetchRejected" });
  });
});
