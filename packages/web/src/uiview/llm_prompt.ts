import { clone } from "@bufbuild/protobuf";
import { FormFieldSchema, type FormField } from "@savvifi/meridian-proto-ts/proto/form_pb.js";
import type { LlmPromptPanel } from "@savvifi/meridian-proto-ts/proto/llm_prompt_pb.js";
import type { RpcInvoker } from "@savvifi/meridian-schemas/uiview";
import { buildFormField } from "./form.js";
import { renderPromptTemplate } from "@savvifi/meridian-schemas/uiview";

// All state here is local DOM state. The descriptor stays a canonical protobuf;
// preview does not execute an LLM, invoke mutations, or serialize a new DTO.
export function buildLlmPrompt(panel: LlmPromptPanel, invoker: RpcInvoker) {
  const element = document.createElement("section"); element.className = "mer-llm-prompt";
  const text = (tag: string, value: string, parent: HTMLElement = element) => {
    const node = document.createElement(tag); node.textContent = value; parent.append(node); return node;
  };
  if (panel.description) text("p", panel.description);
  const model = panel.modelHint;
  if (model) {
    const details = document.createElement("dl"); details.setAttribute("aria-label", "Model settings");
    for (const [label, value] of [["Provider", model.provider], ["Model", model.model],
      ["Max output tokens", model.maxTokens], ["Temperature", model.temperature]] as const) {
      if (value !== "" && value !== 0) { text("dt", label, details); text("dd", String(value), details); }
    }
    element.append(details);
  }
  const form = document.createElement("form");
  const fields = document.createElement("fieldset"); form.append(fields);
  const preview = document.createElement("button"); preview.type = "submit"; preview.textContent = "Preview";
  const retry = document.createElement("button"); retry.type = "button"; retry.textContent = "Retry options"; retry.hidden = true;
  const loading = text("p", "", form); loading.setAttribute("role", "status");
  const error = text("p", "", form); error.setAttribute("role", "alert");
  if (panel.slots.some(slot => slot.field)) form.append(preview);
  form.append(retry); element.append(form);
  const values = new Map<string, string>();
  const templates: Array<{ source: string; output: HTMLElement }> = [];
  for (const [label, source] of [["System prompt", panel.systemTemplate], ["User prompt", panel.userTemplate]]) {
    if (!source && label === "System prompt") continue;
    const section = document.createElement("section"); section.setAttribute("aria-label", label);
    text("h3", label, section); const output = text("pre", source, section);
    templates.push({ source, output }); element.append(section);
  }
  const unresolved = text("p", ""); unresolved.setAttribute("role", "status");
  if (panel.outputJsonSchema) {
    const section = document.createElement("section"); section.setAttribute("aria-label", "Output JSON schema");
    text("h3", "Output JSON schema", section); text("pre", panel.outputJsonSchema, section); element.append(section);
  }
  const updatePreview = () => {
    const missing = new Set<string>();
    for (const { source, output } of templates) {
      const rendered = renderPromptTemplate(source, values); output.textContent = rendered.text;
      rendered.unresolved.forEach(name => missing.add(name));
    }
    unresolved.textContent = missing.size ? `Unresolved slots: ${[...missing].join(", ")}` : "";
  };
  updatePreview();
  let alive = true, pending = false, ready = false;
  let readers: Array<{ name: string; read: () => unknown }> = [];
  const draw = (inputs: Array<FormField | undefined>) => {
    fields.replaceChildren(); readers = [];
    panel.slots.forEach((slot, index) => {
      const field = inputs[index];
      if (!field) { text("p", `No input declared for ${slot.name}.`, fields); return; }
      field.fieldId = `slot-${index}`; field.label ||= slot.name;
      readers.push({ name: slot.name, read: buildFormField(fields, field, undefined, true,
        slot.multiLine ? slot.rows > 0 ? slot.rows : 4 : 0) });
    });
  };
  const load = async () => {
    if (!alive || pending) return;
    pending = true; ready = false; fields.disabled = true; preview.disabled = true; retry.hidden = true;
    loading.textContent = "Loading inputs…"; error.textContent = "";
    try {
      const inputs = await Promise.all(panel.slots.map(slot => slot.field ? resolveOptions(slot.field, invoker) : undefined));
      if (!alive) return;
      draw(inputs); ready = true;
    } catch (reason) {
      if (alive) { error.textContent = `Could not load inputs: ${reason instanceof Error ? reason.message : String(reason)}`; retry.hidden = false; }
    } finally {
      pending = false;
      if (alive) { loading.textContent = ""; fields.disabled = !ready; preview.disabled = !ready; }
    }
  };
  // Static descriptors render synchronously, including before an options RPC
  // resolves; the disabled fieldset prevents editing data that must be redrawn.
  draw(panel.slots.map(slot => slot.field ? clone(FormFieldSchema, slot.field) : undefined));
  form.addEventListener("submit", event => {
    event.preventDefault(); if (!alive || !ready) return;
    try {
      const next = readers.map(({ name, read }) => { const value = read(); return [name,
        typeof value === "string" ? value : JSON.stringify(value)] as const; });
      values.clear(); for (const [name, value] of next) values.set(name, value);
      error.textContent = ""; updatePreview();
    } catch (reason) { error.textContent = reason instanceof Error ? reason.message : String(reason); }
  });
  retry.addEventListener("click", () => { void load(); });
  if (panel.slots.some(slot => slot.field && hasOptionsSource(slot.field))) void load();
  else ready = true;
  return { element, dispose: () => { alive = false; } };
}

export function hasOptionsSource(field: FormField): boolean {
  const kind = field.kind;
  if (kind.case === "enumSelection") return !!kind.value.optionsSource;
  if (kind.case === "nested") return kind.value.fields.some(hasOptionsSource);
  if (kind.case === "repeated") {
    const element = kind.value.element;
    return element.case === "scalar" ? hasOptionsSource(element.value)
      : element.case === "object" && element.value.fields.some(hasOptionsSource);
  }
  return false;
}

export async function resolveOptions(authored: FormField, invoker: RpcInvoker): Promise<FormField> {
  const field = clone(FormFieldSchema, authored), kind = field.kind;
  if (kind.case === "nested") kind.value.fields = await Promise.all(kind.value.fields.map(child => resolveOptions(child, invoker)));
  if (kind.case === "repeated") {
    const element = kind.value.element;
    if (element.case === "scalar") element.value = await resolveOptions(element.value, invoker);
    if (element.case === "object") element.value.fields = await Promise.all(element.value.fields.map(child => resolveOptions(child, invoker)));
  }
  if (kind.case === "enumSelection" && kind.value.optionsSource) {
    const source = kind.value.optionsSource;
    if (!source.service || !source.method || !source.optionsField || !source.valueField) throw new Error("Invalid options source.");
    const at = (value: unknown, path: string): unknown => path.split(".").reduce<unknown>((record, part) =>
      record && typeof record === "object" && Object.hasOwn(record, part) ? (record as Record<string, unknown>)[part] : undefined, value);
    const rows = at(await invoker.invoke(source.service, source.method, {}), source.optionsField);
    if (!Array.isArray(rows)) throw new Error("Invalid options response.");
    kind.value.options = rows.map(row => {
      const value = at(row, source.valueField);
      if (typeof value !== "string" && !(typeof value === "number" && Number.isFinite(value))) throw new Error("Invalid option value.");
      const label = source.labelField ? at(row, source.labelField) : value;
      return { $typeName: "meridian.ui.v1.EnumOption", value: String(value), label: String(label ?? value), tone: 0 };
    });
    kind.value.allowedValues = [];
    kind.value.optionsSource = undefined;
  }
  return field;
}
