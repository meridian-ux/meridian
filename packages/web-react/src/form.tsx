import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import type { FormPanel } from "@savvifi/meridian-proto-ts/proto/panel_pb.js";
import type { FormField } from "@savvifi/meridian-proto-ts/proto/form_pb.js";
import { createAdmissionGate } from "@savvifi/meridian-schemas/uiview";
import { useMeridian } from "./provider.js";
import { buildBindingRequest, selectionDeps, useMeridianSelection } from "./pagination.js";
import { FormFieldRow, FormInitialValues, type FormFieldClasses } from "./form_fields.js";

// Runtime form state. Serialized RPC requests use the existing RpcInvoker contract.
function readField(field: FormField, name: string, data: FormData): unknown {
  const kind = field.kind;
  if (kind.case === "nested") return readFields(kind.value.fields, data, name);
  if (kind.case === "repeated") {
    const count = Number(data.get(`${name}.__count`) || 0);
    if (!Number.isSafeInteger(count) || count < kind.value.minItems || (kind.value.maxItems > 0 && count > kind.value.maxItems))
      throw new Error(`${field.label || name}: invalid item count.`);
    const element = kind.value.element;
    return Array.from({ length: count }, (_, i) => element.case === "scalar"
      ? readField(element.value, `${name}[${i}]`, data)
      : element.case === "object" ? readFields(element.value.fields, data, `${name}[${i}]`) : null);
  }
  if (kind.case === "keyValueMap") {
    const value = JSON.parse(String(data.get(name) || "{}"));
    if (!value || typeof value !== "object" || Array.isArray(value) || Object.values(value).some(item => typeof item !== "string") ||
      (kind.value.maxItems > 0 && Object.keys(value).length > kind.value.maxItems)) throw new Error(`${field.label || name}: invalid map.`);
    return value;
  }
  if (kind.case === "boolean") return data.has(name);
  const text = String(data.get(name) ?? "");
  if (kind.case === "integer" || kind.case === "number") {
    const value = Number(text);
    const { min, max } = kind.value;
    if (!text || !Number.isFinite(value) || (kind.case === "integer" && !Number.isInteger(value)) ||
        (min !== 0 && value < min) || (max !== 0 && value > max)) throw new Error(`${field.label || name}: invalid number.`);
    return value;
  }
  if (kind.case === "text") {
    const spec = kind.value;
    if ((spec.minLength && text.length < spec.minLength) || (spec.maxLength && text.length > spec.maxLength))
      throw new Error(`${field.label || name}: invalid length.`);
    if (spec.pattern && !new RegExp(spec.pattern).test(text)) throw new Error(spec.patternErrorMsg || `${field.label || name}: invalid value.`);
  }
  if (kind.case === "enumSelection" && !kind.value.allowedValues.includes(text)) throw new Error(`${field.label || name}: select an allowed value.`);
  return text;
}
function readFields(fields: FormField[], data: FormData, prefix = ""): Record<string, unknown> {
  return Object.fromEntries(fields.map(field => [field.fieldId, readField(field,
    `${prefix ? `${prefix}.` : ""}${field.requestField || field.fieldId}`, data)]));
}

function inputValues(fields: FormField[], values: Record<string, unknown>, prefix = ""): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const field of fields) {
    const name = `${prefix ? `${prefix}.` : ""}${field.requestField || field.fieldId}`;
    const value = Object.hasOwn(values, field.fieldId) ? values[field.fieldId] : undefined;
    result[name] = value;
    if (field.kind.case === "nested" && value && typeof value === "object" && !Array.isArray(value))
      Object.assign(result, inputValues(field.kind.value.fields, value as Record<string, unknown>, name));
    if (field.kind.case === "repeated" && Array.isArray(value)) {
      const element = field.kind.value.element;
      value.forEach((item, i) => {
        const path = `${name}[${i}]`;
        result[path] = item;
        if (element.case === "object" && item && typeof item === "object") Object.assign(result, inputValues(element.value.fields, item, path));
      });
    }
  }
  return result;
}

export function FormContent({ panel, c, className }: { panel: FormPanel; c: FormFieldClasses; className: string }) {
  const { invoker, mutationInvoker, admission } = useMeridian();
  const selection = useMeridianSelection();
  const deps = selectionDeps(panel.prefill, selection.values);
  const request = useMemo(() => buildBindingRequest(panel.prefill, selection.values), [panel.prefill, deps]);
  // A changed descriptor/selection starts a fresh instance, isolating late responses.
  const key = JSON.stringify([panel, request]);
  return <FormSession key={key} {...{ panel, c, className, invoker, mutationInvoker, admission, request, selection }} />;
}

function FormSession({ panel, c, className, invoker, mutationInvoker, admission, request, selection }:
  Parameters<typeof FormContent>[0] & Pick<ReturnType<typeof useMeridian>, "invoker" | "mutationInvoker" | "admission"> & {
    request: Record<string, unknown>; selection: ReturnType<typeof useMeridianSelection>;
  }) {
  const edit = panel.mode === 2;
  const prefill = edit && panel.prefill?.service && panel.prefill.method ? panel.prefill : undefined;
  const [loading, setLoading] = useState(Boolean(prefill));
  const [initial, setInitial] = useState<Record<string, unknown>>({});
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const busy = useRef(false);
  const alive = useRef(true);
  const call = panel.submit;
  const allowed = Boolean(call?.service && call.method && createAdmissionGate(admission).admits("mutation", call.service, call.method));
  useEffect(() => {
    alive.current = true;
    let active = true;
    if (prefill) void Promise.resolve().then(() => invoker.invoke(prefill.service, prefill.method, request)).then(value => {
      if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid prefill response.");
      if (active) setInitial(inputValues(panel.fields, value as Record<string, unknown>));
    }).catch(reason => { if (active) setError(`Could not load initial values: ${String(reason instanceof Error ? reason.message : reason)}`); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; alive.current = false; };
  }, [prefill, invoker, request]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!edit || !allowed || !call || loading || busy.current) return;
    setError(""); setStatus("");
    try {
      const values = readFields(panel.fields, new FormData(event.currentTarget));
      busy.current = true; setStatus("Saving…");
      await mutationInvoker.invoke(call.service, call.method, { ...buildBindingRequest(call, selection.values), ...values });
      if (alive.current) setStatus("Saved.");
    } catch (reason) {
      if (alive.current) { setStatus(""); setError(reason instanceof Error ? reason.message : String(reason)); }
    } finally { busy.current = false; }
  }
  return <form className={className} data-mode={panel.mode} onSubmit={submit}>
    {loading ? <p role="status">Loading…</p> : <FormInitialValues.Provider value={initial}>
      {panel.fields.map(field => <FormFieldRow key={field.fieldId} c={c} field={field} mode={panel.mode} />)}
    </FormInitialValues.Provider>}
    {edit && call && <button type="submit" disabled={loading || status === "Saving…" || !allowed}>{`Save ${panel.itemNoun}`.trim()}</button>}
    {edit && call && !allowed && <p role="status">Saving is not permitted.</p>}
    {status && <p role="status">{status}</p>}
    {error && <p role="alert">{error}</p>}
  </form>;
}
