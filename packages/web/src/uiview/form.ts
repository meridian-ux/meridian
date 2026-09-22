import type { FormPanel } from "@savvifi/meridian-proto-ts/proto/panel_pb.js";
import type { FormField } from "@savvifi/meridian-proto-ts/proto/form_pb.js";
import type { RpcCall } from "@savvifi/meridian-proto-ts/proto/rpc_pb.js";
import { formatByDisplay } from "@savvifi/meridian-schemas/uiview";

// Runtime DOM state only; requests and descriptors retain their protobuf contracts.
export function buildInteractiveForm(panel: FormPanel, host: {
  allowed(call: RpcCall): boolean;
  invoke(call: RpcCall, values: Record<string, unknown>, mutation: boolean): Promise<unknown>;
}) {
  const element = document.createElement("form");
  element.className = "meridian-uiview-form";
  const fields = document.createElement("fieldset");
  const status = document.createElement("p"); status.setAttribute("role", "status");
  const error = document.createElement("p"); error.setAttribute("role", "alert");
  const edit = panel.mode === 2;
  const call = panel.submit;
  const allowed = !!(call?.service && call.method && host.allowed(call));
  const save = document.createElement("button"); save.type = "submit";
  save.textContent = `Save ${panel.itemNoun}`.trim();
  let alive = true, busy = false, loading = false;
  let read = () => ({} as Record<string, unknown>);
  const update = () => { fields.disabled = busy || loading; save.disabled = !allowed || busy || loading; };
  const draw = (values: Record<string, unknown> = {}) => {
    fields.replaceChildren();
    read = buildFields(fields, panel.fields, values, edit);
  };
  draw(); element.append(fields);
  if (edit && call) element.append(save);
  element.append(status, error);
  if (edit && call && !allowed) status.textContent = "Saving is not permitted.";
  element.addEventListener("submit", async event => {
    event.preventDefault();
    if (!alive || !edit || !allowed || !call || busy || loading) return;
    error.textContent = ""; status.textContent = "";
    try {
      const values = read();
      busy = true; update(); status.textContent = "Saving…";
      await host.invoke(call, values, true);
      if (alive) status.textContent = "Saved.";
    } catch (reason) {
      if (alive) { status.textContent = ""; error.textContent = reason instanceof Error ? reason.message : String(reason); }
    } finally { busy = false; if (alive) update(); }
  });
  if (edit && panel.prefill?.service && panel.prefill.method) {
    loading = true; status.textContent = "Loading…";
    void Promise.resolve().then(() => host.invoke(panel.prefill!, {}, false)).then(value => {
      if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid prefill response.");
      if (alive) draw(value as Record<string, unknown>);
    }).catch(reason => {
      if (alive) error.textContent = `Could not load initial values: ${reason instanceof Error ? reason.message : String(reason)}`;
    }).finally(() => { loading = false; if (alive) { status.textContent = allowed ? "" : "Saving is not permitted."; update(); } });
  }
  update();
  return { element, dispose: () => { alive = false; } };
}

function buildFields(parent: HTMLElement, fields: FormField[], values: Record<string, unknown>, edit: boolean) {
  const entries = fields.map(field => [field.fieldId, buildField(parent, field,
    Object.hasOwn(values, field.fieldId) ? values[field.fieldId] : undefined, edit)] as const);
  return () => Object.fromEntries(entries.map(([key, get]) => [key, get()]));
}

function buildField(parent: HTMLElement, field: FormField, initial: unknown, edit: boolean): () => unknown {
  const box = document.createElement("fieldset");
  box.className = "meridian-uiview-field";
  const legend = document.createElement("legend"); legend.textContent = field.label;
  box.append(legend); parent.append(box);
  const kind = field.kind;
  if (kind.case === "nested") return buildFields(box, kind.value.fields,
    initial && typeof initial === "object" && !Array.isArray(initial) ? initial as Record<string, unknown> : {}, edit);
  if (kind.case === "repeated") {
    const spec = kind.value;
    const rows: Array<{ node: HTMLElement; get: () => unknown }> = [];
    const add = document.createElement("button"); add.type = "button"; add.textContent = spec.addLabel || "Add item";
    const sync = () => {
      add.disabled = !!spec.maxItems && rows.length >= spec.maxItems;
      rows.forEach(row => { const remove = row.node.querySelector<HTMLButtonElement>(":scope > button"); if (remove) remove.disabled = rows.length <= spec.minItems; });
    };
    const append = (value?: unknown) => {
      const node = document.createElement("div"); box.insertBefore(node, edit ? add : null);
      const get = spec.element.case === "scalar" ? buildField(node, spec.element.value, value, edit)
        : spec.element.case === "object" ? buildFields(node, spec.element.value.fields,
          value && typeof value === "object" ? value as Record<string, unknown> : {}, edit) : () => null;
      const row = { node, get }; rows.push(row);
      if (edit) {
        const remove = document.createElement("button"); remove.type = "button"; remove.textContent = "Remove item";
        remove.onclick = () => { rows.splice(rows.indexOf(row), 1); node.remove(); sync(); }; node.append(remove);
      }
      sync();
    };
    if (edit) { box.append(add); add.onclick = () => append(); }
    (Array.isArray(initial) ? initial : Array.from({ length: spec.minItems })).forEach(append);
    return () => {
      if (rows.length < spec.minItems || (spec.maxItems && rows.length > spec.maxItems)) throw new Error(`${field.label}: invalid item count.`);
      return rows.map(row => row.get());
    };
  }
  const value = initial ?? (kind.value && "defaultValue" in kind.value ? kind.value.defaultValue : kind.case === "keyValueMap" ? {} : "");
  if (!edit) {
    const span = document.createElement("span"); span.dataset.field = field.fieldId;
    span.className = "meridian-uiview-field-value";
    span.textContent = kind.case === "masked" ? "••••••" : field.display ? formatByDisplay(value, field.display).text : String(value);
    box.append(span); return () => value;
  }
  const input = kind.case === "keyValueMap" ? document.createElement("textarea")
    : kind.case === "enumSelection" ? document.createElement("select") : document.createElement("input");
  input.name = field.fieldId; input.setAttribute("aria-label", field.label || field.fieldId);
  if (input instanceof HTMLInputElement) input.type = kind.case === "boolean" ? "checkbox" : kind.case === "masked" ? "password"
    : kind.case === "integer" || kind.case === "number" ? "number" : "text";
  if (input instanceof HTMLInputElement && kind.case === "boolean") input.checked = value === true;
  if (kind.case === "enumSelection") {
    const options = kind.value.options.length ? kind.value.options.map(item => ({ value: item.value, label: item.label || item.value }))
      : kind.value.allowedValues.map(item => ({ value: item, label: item }));
    for (const item of options) { const option = document.createElement("option"); option.value = item.value; option.textContent = item.label; input.append(option); }
  }
  input.value = kind.case === "keyValueMap" ? JSON.stringify(value) : String(value);
  if (input instanceof HTMLInputElement && kind.case === "number") input.step = "any";
  box.append(input);
  if (field.description) { const help = document.createElement("p"); help.textContent = field.description; box.append(help); }
  return () => {
    const text = input.value;
    const fail = (message = "invalid value") => { throw new Error(`${field.label || field.fieldId}: ${message}.`); };
    if (kind.case === "boolean") return (input as HTMLInputElement).checked;
    if (kind.case === "integer" || kind.case === "number") {
      const number = Number(text), { min, max } = kind.value;
      if (!text.trim() || !Number.isFinite(number) || (kind.case === "integer" && !Number.isInteger(number)) || (min !== 0 && number < min) || (max !== 0 && number > max)) fail("invalid number");
      return number;
    }
    if (kind.case === "text" || kind.case === "masked") {
      const spec = kind.value;
      if ((spec.minLength && text.length < spec.minLength) || (spec.maxLength && text.length > spec.maxLength)) fail("invalid length");
      if (spec.pattern && !new RegExp(spec.pattern).test(text)) fail(spec.patternErrorMsg || "invalid value");
    }
    if (kind.case === "enumSelection" && !Array.from((input as HTMLSelectElement).options).some(option => option.value === text)) fail("select an allowed value");
    if (kind.case === "keyValueMap") {
      const map = JSON.parse(text);
      if (!map || typeof map !== "object" || Array.isArray(map) || Object.values(map).some(item => typeof item !== "string") || (kind.value.maxItems && Object.keys(map).length > kind.value.maxItems)) fail("invalid map");
      return map;
    }
    return text;
  };
}
