import { fromJson, type JsonObject } from "@bufbuild/protobuf";
import { StructSchema, type Struct } from "@bufbuild/protobuf/wkt";

/** In-process host callback, not an RPC. Values use the canonical protobuf
 * Struct: form fields keyed by field_id, or a confirmation bool keyed by panel
 * ID. null means cancellation, distinct from a submitted false confirmation. */
export type PromptResponseHandler = (panelId: string, values: Struct | null) => void | Promise<void>;

export function promptValues(values: Record<string, unknown>): Struct {
  return fromJson(StructSchema, values as JsonObject);
}

/** Local lifecycle state, never serialized. Shared by DOM and React renderers. */
export function createPromptResponder() {
  let state = { busy: false, done: false, error: "", status: "" };
  let alive = true, generation = 0;
  const listeners = new Set<() => void>();
  const notify = (next: typeof state) => { state = next; for (const listener of listeners) listener(); };
  const inputError = (reason: unknown) => {
    if (alive && !state.busy && !state.done) notify({ ...state, error: reason instanceof Error ? reason.message : String(reason) });
  };
  return {
    getSnapshot: () => state,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    // React StrictMode can reactivate a mounted instance after effect cleanup.
    // Generations still invalidate every response from before that cleanup.
    activate() { alive = true; },
    dispose() {
      alive = false; generation++; listeners.clear();
      if (state.busy) state = { ...state, busy: false, status: "" };
    },
    inputError,
    async respond(handler: PromptResponseHandler | undefined, panelId: string, values: Struct | null) {
      if (!alive || state.busy || state.done) return;
      if (!handler) { inputError(new Error("No prompt handler configured.")); return; }
      const current = ++generation;
      notify({ busy: true, done: false, error: "", status: "Submitting…" });
      try {
        await handler(panelId, values);
        if (alive && generation === current) notify({ busy: false, done: true, error: "", status: values === null ? "Canceled." : "Submitted." });
      } catch (reason) {
        if (alive && generation === current) notify({ busy: false, done: false, error: reason instanceof Error ? reason.message : String(reason), status: "" });
      }
    },
  };
}
