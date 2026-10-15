import { clone } from "@bufbuild/protobuf";
import { FormFieldSchema, type FormField } from "@savvifi/meridian-proto-ts/proto/form_pb.js";
import type { PromptPanel } from "@savvifi/meridian-proto-ts/proto/prompt_pb.js";
import { createPromptResponder, promptValues, validateFormValues, type PromptResponseHandler, type RpcInvoker } from "@savvifi/meridian-schemas/uiview";
import { buildFormField } from "./form.js";
import { hasOptionsSource, resolveOptions } from "./llm_prompt.js";

export function buildPrompt(panel: PromptPanel, panelId: string, handler: PromptResponseHandler | undefined, invoker: RpcInvoker) {
  const element = document.createElement("form"); element.className = "meridian-uiview-prompt";
  const text = (tag: string, value: string) => { const node = document.createElement(tag); node.textContent = value; element.append(node); return node; };
  if (panel.description) text("p", panel.description);
  if (panel.detail) text("pre", panel.detail);
  const fields = document.createElement("fieldset"); if (!panel.isConfirmation) element.append(fields);
  const buttons: HTMLButtonElement[] = [];
  const responder = createPromptResponder();
  let alive = true, ready = true, loading = false, optionError = "";
  let read = () => ({} as Record<string, unknown>);
  const button = (label: string, submit: boolean, respond?: () => void) => {
    const node = document.createElement("button"); node.type = submit ? "submit" : "button"; node.textContent = label;
    if (respond) node.addEventListener("click", respond); element.append(node); buttons.push(node); return node;
  };
  button(panel.acceptLabel || (panel.isConfirmation ? "Yes" : "Submit"), true);
  button(panel.cancelLabel || (panel.isConfirmation ? "No" : "Cancel"), false, () => {
    void responder.respond(handler, panelId, panel.isConfirmation ? promptValues({ [panelId]: false }) : null);
  });
  const retry = document.createElement("button"); retry.type = "button"; retry.textContent = "Retry options"; retry.hidden = true; element.append(retry);
  const status = text("p", ""); status.setAttribute("role", "status");
  const error = text("p", ""); error.setAttribute("role", "alert");
  const refresh = () => {
    const state = responder.getSnapshot();
    fields.disabled = !handler || !ready || state.busy || state.done;
    buttons.forEach((node, index) => { node.disabled = !handler || (index === 0 && !ready) || state.busy || state.done; });
    if (state.done) { optionError = ""; loading = false; }
    retry.hidden = !optionError; retry.disabled = loading;
    status.textContent = loading ? "Loading inputs…" : state.status || (!handler ? "No prompt handler configured." : "");
    error.textContent = optionError || state.error;
  };
  responder.subscribe(refresh);
  const draw = (inputs: FormField[]) => {
    fields.replaceChildren();
    const readers = inputs.map(field => [field.fieldId, buildFormField(fields, field, undefined, true)] as const);
    read = () => {
      const values = Object.fromEntries(readers.map(([name, get]) => [name, get()]));
      const error = validateFormValues(inputs, values); if (error) throw new Error(error);
      return values;
    };
  };
  const load = async () => {
    if (!alive || loading) return;
    ready = false; loading = true; optionError = ""; refresh();
    try {
      const inputs = await Promise.all(panel.fields.map(field => resolveOptions(field, invoker)));
      if (alive && !responder.getSnapshot().done) { draw(inputs); ready = true; }
    } catch (reason) { if (alive && !responder.getSnapshot().done) optionError = `Could not load inputs: ${reason instanceof Error ? reason.message : String(reason)}`; }
    finally { loading = false; if (alive) refresh(); }
  };
  if (!panel.isConfirmation) {
    draw(panel.fields.map(field => clone(FormFieldSchema, field)));
    if (panel.fields.some(hasOptionsSource)) void load();
  }
  element.addEventListener("submit", event => {
    event.preventDefault(); if (!ready) return;
    try { void responder.respond(handler, panelId, promptValues(panel.isConfirmation ? { [panelId]: true } : read())); }
    catch (reason) { responder.inputError(reason); }
  });
  element.addEventListener("keydown", event => {
    if (event.key === "Escape" && !event.defaultPrevented) { event.preventDefault(); void responder.respond(handler, panelId, null); }
  });
  retry.addEventListener("click", () => { void load(); });
  refresh();
  return { element, dispose() { alive = false; responder.dispose(); } };
}
