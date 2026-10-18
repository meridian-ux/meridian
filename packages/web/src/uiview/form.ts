import type { FormPanel } from "@savvifi/meridian-proto-ts/proto/panel_pb.js";
import type { FormField } from "@savvifi/meridian-proto-ts/proto/form_pb.js";
import type { RpcCall } from "@savvifi/meridian-proto-ts/proto/rpc_pb.js";
import { assertFormDefaultBudget, defaultFormValue, formatByDisplay, hasMaskedField, validateFormValues } from "@savvifi/meridian-schemas/uiview";
import { ValueType } from "@savvifi/meridian-proto-ts/proto/value_pb.js";
import { buildMaskedMultiline } from "./masked_multiline.js";
import { assertInvocationDescriptorData, ownInvocationData, type createInvocationControl } from "./invocation_control.js";

// Native option styling is platform-dependent; expose semantic roles without literal colors.
const enumTones: Readonly<Partial<Record<number, string>>> = { 1: "neutral", 2: "info", 3: "success", 4: "warning", 5: "danger", 6: "accent" };

// Runtime DOM state only; requests and descriptors retain their protobuf contracts.
export function buildInteractiveForm(panel: FormPanel, host: {
  initialValues?: Record<string, unknown>;
  prefill(call: RpcCall): Promise<unknown>;
  resolveFields?(fields: FormField[]): Promise<FormField[]>;
  createSubmit(fields: FormField[], read: () => Record<string, unknown>, pending: (value: boolean) => void, invalid: (reason: unknown) => void): ReturnType<typeof createInvocationControl>;
}) {
  const element = document.createElement("form");
  element.className = "meridian-uiview-form";
  const fields = document.createElement("fieldset");
  const status = document.createElement("p"); status.setAttribute("role", "status");
  const error = document.createElement("p"); error.setAttribute("role", "alert");
  const edit = panel.mode === 2;
  let control: ReturnType<typeof createInvocationControl> | undefined;
  let declarations = panel.fields;
  let alive = true, busy = false, loading = false, ready = false;
  let read = () => ({} as Record<string, unknown>);
  const update = () => { fields.disabled = !ready || busy || loading; };
  const draw = (values: Record<string, unknown> = {}) => {
    fields.replaceChildren();
    ready = false;
    try {
      assertInvocationDescriptorData(declarations);
      assertFormDefaultBudget(declarations);
      read = buildFields(fields, declarations, values, edit);
      ready = true;
    } catch (reason) {
      fields.replaceChildren();
      error.textContent = reason instanceof Error ? reason.message : String(reason);
    }
  };
  let initial: Record<string, unknown> | undefined;
  try { initial = boundedFormValues(declarations, host.initialValues ?? {}); }
  catch { status.textContent = "Initial values unavailable; showing descriptor defaults."; }
  draw(initial); element.append(fields);
  element.append(status, error);
  const readCurrent = () => {
    if (!alive || !ready || !edit || loading) throw Error("Form is not ready.");
    return boundedFormValues(declarations, read());
  };
  const invalid = (reason: unknown) => { if (alive) error.textContent = reason instanceof Error ? reason.message : "Invalid form values."; };
  const install = () => {
    if (!alive || !ready || !edit || loading || control || panel.submit === undefined && panel.submitAffordance === undefined) return;
    control = host.createSubmit(declarations, readCurrent, pending => { busy = pending; if (alive) update(); }, invalid);
    control.button.type = "submit"; control.button.onclick = null;
    element.insertBefore(control.element, status);
  };
  element.addEventListener("submit", async event => {
    event.preventDefault();
    if (!alive || !ready || !edit || !control || busy || loading) return;
    error.textContent = ""; // Nonfatal initial-value warnings remain visible on retry.
    try {
      readCurrent(); // Field validation must precede policy, capabilities and RPCs.
      await control.activate();
    } catch (reason) {
      invalid(reason);
    }
  });
  const retry = document.createElement("button"); retry.type = "button"; retry.textContent = "Retry options"; retry.hidden = true;
  element.append(retry);
  const load = async () => {
    if (!alive || loading) return;
    loading = true; retry.hidden = true; error.textContent = ""; status.textContent = "Loading…"; update();
    try {
      if (host.resolveFields) {
        try { const resolved = await host.resolveFields(panel.fields); if (!alive) return; declarations = resolved; assertFormDefaultBudget(declarations); }
        catch { if (alive) { ready = false; fields.replaceChildren(); error.textContent = "Options unavailable. Retry loading choices."; retry.hidden = false; } return; }
      }
      let values = initial;
      if (panel.prefill?.service && panel.prefill.method) {
        try { const result = await host.prefill(panel.prefill); if (!alive) return; values = boundedFormValues(declarations, result); }
        catch { if (alive) status.textContent = "Initial values unavailable; showing descriptor defaults."; }
      }
      if (alive) draw(values);
    } finally { loading = false; if (alive) { if (status.textContent === "Loading…") status.textContent = ""; install(); update(); } }
  };
  retry.onclick = () => { void load(); };
  if (ready && edit && (host.resolveFields || panel.prefill?.service && panel.prefill.method)) void load();
  install(); update();
  return { element, dispose: () => { alive = false; control?.dispose(); } };
}

// Project own declared data before retaining prefill or capturing submission.
// Reject repeated expansion before allocating DOM rows; omitted members retain
// descriptor defaults, including defaults inside repeated object elements.
function boundedFormValues(fields: readonly FormField[], raw: unknown): Record<string, unknown> {
  assertInvocationDescriptorData(fields);
  const source = ownInvocationData(raw);
  let remaining = 1000;
  const visit = (depth: number) => { if (depth > 64 || --remaining < 0) throw Error("Form values exceed supported limits."); };
  const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
  const group = (declared: readonly FormField[], value: unknown, depth: number): Record<string, unknown> => {
    if (!object(value)) throw Error("Invalid form values.");
    return Object.fromEntries(declared.map(field => [field.fieldId, copy(field,
      Object.hasOwn(value, field.fieldId) ? value[field.fieldId] : defaultFormValue(field), depth)]));
  };
  const copy = (field: FormField, value: unknown, depth: number): unknown => {
    visit(depth);
    if (field.kind.case === "nested") return group(field.kind.value.fields, value, depth + 1);
    if (field.kind.case === "repeated") {
      if (!Array.isArray(value) || value.length > remaining) throw Error("Form values exceed supported limits.");
      const element = field.kind.value.element;
      return value.map(item => {
        if (element.case === "scalar") return copy(element.value, item, depth + 1);
        visit(depth + 1);
        return element.case === "object" ? group(element.value.fields, item, depth + 1) : null;
      });
    }
    if (field.kind.case === "keyValueMap") {
      if (!object(value) || Object.keys(value).length > remaining || Object.values(value).some(item => typeof item !== "string")) throw Error("Invalid form values.");
      remaining -= Object.keys(value).length; return value;
    }
    if (field.kind.case === undefined) return value; // Legacy read-only display fields have no input kind.
    if (field.kind.case === "boolean" ? typeof value !== "boolean"
      : field.kind.case === "integer" || field.kind.case === "number" ? typeof value !== "number" || !Number.isFinite(value)
      : typeof value !== "string") throw Error("Invalid form values.");
    return value;
  };
  return group(fields, source, 0);
}

function buildFields(parent: HTMLElement, fields: FormField[], values: Record<string, unknown>, edit: boolean) {
  const entries = fields.map(field => [field.fieldId, buildFormField(parent, field,
    Object.hasOwn(values, field.fieldId) ? values[field.fieldId] : undefined, edit)] as const);
  return () => {
    const values = Object.fromEntries(entries.map(([key, get]) => [key, get()]));
    const error = validateFormValues(fields, values);
    if (error) throw new Error(error);
    return values;
  };
}

export function buildFormField(parent: HTMLElement, field: FormField, initial: unknown, edit: boolean, multilineRows = 0): () => unknown {
  const read = collectFormField(parent, field, initial, edit, multilineRows);
  return () => {
    const value = read();
    const error = validateFormValues([field], { [field.fieldId]: value });
    if (error) throw new Error(error);
    return value;
  };
}

function collectFormField(parent: HTMLElement, field: FormField, initial: unknown, edit: boolean, multilineRows: number): () => unknown {
  const box = document.createElement("fieldset");
  box.className = "meridian-uiview-field";
  const legend = document.createElement("legend"); legend.textContent = field.label;
  box.append(legend); parent.append(box);
  const kind = field.kind;
  if (!edit && field.display && field.display.type !== ValueType.UNSPECIFIED &&
      (kind.case === "nested" || kind.case === "repeated" || kind.case === "keyValueMap")) {
    try {
      const raw = initial === undefined ? defaultFormValue(field) : initial;
      const span = document.createElement("span"); span.dataset.field = field.fieldId;
      span.className = "meridian-uiview-field-value";
      span.textContent = hasMaskedField(field) ? "••••••" : formatByDisplay(raw, field.display).text;
      box.append(span); return () => raw;
    } catch (reason) {
      const error = document.createElement("p"); error.setAttribute("role", "alert");
      error.textContent = reason instanceof Error ? reason.message : String(reason); box.append(error);
      return () => { throw reason; };
    }
  }
  if (kind.case === "text" && field.display?.type === ValueType.MULTILINE_TEXT && multilineRows === 0) multilineRows = 4;
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
      // A scalar element is not an object member and need not carry a field ID.
      // Its parent repeated-field validator checks the element's kind/value.
      const get = spec.element.case === "scalar" ? collectFormField(node, spec.element.value, value, edit, 0)
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
    return () => rows.map(row => row.get());
  }
  const value = initial ?? (kind.value && "defaultValue" in kind.value ? kind.value.defaultValue : kind.case === "keyValueMap" ? {} : "");
  if (!edit) {
    const span = document.createElement("span"); span.dataset.field = field.fieldId;
    span.className = "meridian-uiview-field-value";
    const shown = kind.case === "masked" ? { text: "••••••" }
      : field.display ? formatByDisplay(value, field.display) : { text: String(value) };
    span.textContent = shown.text;
    if (shown.title !== undefined) span.title = shown.title;
    box.append(span); return () => value;
  }
  if (kind.case === "masked" && multilineRows > 0) {
    const editor = buildMaskedMultiline(field.fieldId, field.label || field.fieldId, String(value), multilineRows);
    box.append(editor.element);
    if (field.description) { const help = document.createElement("p"); help.textContent = field.description; box.append(help); }
    return () => editor.read();
  }
  const input = kind.case === "keyValueMap" || (multilineRows > 0 && kind.case === "text") ? document.createElement("textarea")
    : kind.case === "enumSelection" ? document.createElement("select") : document.createElement("input");
  input.name = field.fieldId; input.setAttribute("aria-label", field.label || field.fieldId);
  if (input instanceof HTMLTextAreaElement && multilineRows > 0) input.rows = multilineRows;
  if (input instanceof HTMLInputElement) input.type = kind.case === "boolean" ? "checkbox" : kind.case === "masked" ? "password"
    : kind.case === "integer" || kind.case === "number" ? "number" : "text";
  if (input instanceof HTMLInputElement && kind.case === "boolean") input.checked = value === true;
  if (kind.case === "enumSelection") {
    const options: { value: string; label: string; tone?: number }[] = kind.value.options.length ? kind.value.options.map(item => ({ value: item.value, label: item.label || item.value, tone: item.tone }))
      : kind.value.allowedValues.map(item => ({ value: item, label: item }));
    for (const item of options) {
      const option = document.createElement("option"); option.value = item.value; option.textContent = item.label;
      const tone = enumTones[item.tone ?? 0];
      if (tone) option.dataset.valueTone = tone;
      input.append(option);
    }
    if (!options.length) {
      const option = document.createElement("option"); option.value = ""; option.textContent = "No options"; option.disabled = true;
      input.append(option); input.disabled = true;
    }
  }
  input.value = kind.case === "keyValueMap" ? JSON.stringify(value) : String(value);
  if (input instanceof HTMLSelectElement) {
    if (value === "" && input.selectedIndex < 0 && input.options.length) input.selectedIndex = 0;
    const updateTone = () => {
      const tone = input.selectedOptions[0]?.dataset.valueTone;
      if (tone) input.dataset.valueTone = tone;
      else delete input.dataset.valueTone;
    };
    updateTone(); input.addEventListener("change", updateTone);
  }
  if (input instanceof HTMLInputElement && kind.case === "number") input.step = "any";
  box.append(input);
  if (field.description) { const help = document.createElement("p"); help.textContent = field.description; box.append(help); }
  return () => {
    const text = input.value;
    if (kind.case === "boolean") return (input as HTMLInputElement).checked;
    if (kind.case === "integer" || kind.case === "number") {
      return text.trim() ? Number(text) : NaN;
    }
    if (kind.case === "keyValueMap") {
      return JSON.parse(text);
    }
    return text;
  };
}
