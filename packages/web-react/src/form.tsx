import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import type { FormPanel } from "@savvifi/meridian-proto-ts/proto/panel_pb.js";
import type { FormField } from "@savvifi/meridian-proto-ts/proto/form_pb.js";
import { assertFormDefaultBudget, createAdmissionGate, validateFormValues } from "@savvifi/meridian-schemas/uiview";
import { useMeridian } from "./provider.js";
import { bindingRequestJson, boundedDescriptorJson, buildBindingRequest, useMeridianSelection } from "./pagination.js";
import { FormEnumValues, FormFieldRow, FormInitialValues, FormRepeatedCounts, type FormFieldClasses } from "./form_fields.js";

// Runtime form state. Serialized RPC requests use the existing RpcInvoker contract.
export function formDefaultsError(fields: readonly FormField[]): string | undefined {
  try { assertFormDefaultBudget(fields); }
  catch (reason) { return reason instanceof Error ? reason.message : String(reason); }
  return undefined;
}

function readField(field: FormField, name: string, data: FormData, counts: Map<string, number>, depth: number): unknown {
  if (depth > 64) throw new Error("Form nesting exceeds 64 levels.");
  const kind = field.kind;
  if (!kind.case) throw new Error(`${field.label || name}: unsupported field kind.`);
  if (kind.case === "nested") return collectFields(kind.value.fields, data, counts, name, depth + 1);
  if (kind.case === "repeated") {
    const count = counts.get(name);
    if (count === undefined || !Number.isSafeInteger(count) || count < kind.value.minItems || (kind.value.maxItems > 0 && count > kind.value.maxItems))
      throw new Error(`${field.label || name}: invalid item count.`);
    const element = kind.value.element;
    return Array.from({ length: count }, (_, i) => element.case === "scalar"
      ? readField(element.value, `${name}[${i}]`, data, counts, depth + 1)
      : element.case === "object" ? collectFields(element.value.fields, data, counts, `${name}[${i}]`, depth + 1) : null);
  }
  if (kind.case === "keyValueMap") {
    return JSON.parse(String(data.get(name) || "{}"));
  }
  if (kind.case === "boolean") return data.has(name);
  const text = String(data.get(name) ?? "");
  if (kind.case === "integer" || kind.case === "number") {
    return text.trim() ? Number(text) : NaN;
  }
  return text;
}
function collectFields(fields: FormField[], data: FormData, counts: Map<string, number>, prefix: string, depth = 0): Record<string, unknown> {
  if (depth > 64) throw new Error("Form nesting exceeds 64 levels.");
  return Object.fromEntries(fields.map(field => [field.fieldId, readField(field,
    `${prefix ? `${prefix}.` : ""}${field.requestField || field.fieldId}`, data, counts, depth)]));
}
export function readFormFields(fields: FormField[], data: FormData, enums: Map<string, readonly string[]>, counts: Map<string, number>, prefix = ""): Record<string, unknown> {
  const values = collectFields(fields, data, counts, prefix);
  const error = validateFormValues(fields, values, (_field, path) => enums.get(path) ?? [], prefix);
  if (error) throw new Error(error);
  return values;
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

export function FormContent({ panel, c, className, submitLabel, submittingLabel = "Saving…", successLabel = "Saved." }: {
  panel: FormPanel; c: FormFieldClasses; className: string;
  submitLabel?: string; submittingLabel?: string; successLabel?: string;
}) {
  const { invoker, mutationInvoker, admission } = useMeridian();
  const selection = useMeridianSelection();
  const requestJson = bindingRequestJson(panel.prefill, selection.values);
  const request = useMemo(() => requestJson === undefined ? undefined : JSON.parse(requestJson) as Record<string, unknown>, [requestJson]);
  let descriptor: string | undefined;
  try { descriptor = boundedDescriptorJson(panel); } catch { /* Reject before mounting form fields or dispatching. */ }
  // A changed descriptor/selection starts a fresh instance, isolating late responses.
  const key = JSON.stringify([descriptor, requestJson]);
  if (!request || descriptor === undefined) return <p role="alert">{formDefaultsError(panel.fields) || "Form request or descriptor rejected."}</p>;
  return <FormSession key={key} {...{ panel, c, className, submitLabel, submittingLabel, successLabel, invoker, mutationInvoker, admission, request, selection }} />;
}

function FormSession({ panel, c, className, submitLabel, submittingLabel, successLabel, invoker, mutationInvoker, admission, request, selection }:
  Parameters<typeof FormContent>[0] & Pick<ReturnType<typeof useMeridian>, "invoker" | "mutationInvoker" | "admission"> & {
    request: Record<string, unknown>; selection: ReturnType<typeof useMeridianSelection>;
  }) {
  const edit = panel.mode === 2;
  const defaultError = useMemo(() => formDefaultsError(panel.fields), [panel.fields]);
  const prefill = !defaultError && edit && panel.prefill?.service && panel.prefill.method ? panel.prefill : undefined;
  const [loading, setLoading] = useState(Boolean(prefill));
  const [initial, setInitial] = useState<Record<string, unknown>>({});
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const busy = useRef(false);
  const enums = useRef(new Map<string, readonly string[]>());
  const counts = useRef(new Map<string, number>());
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
    if (defaultError || !edit || !allowed || !call || loading || busy.current) return;
    setError(""); setStatus("");
    try {
      const values = readFormFields(panel.fields, new FormData(event.currentTarget), enums.current, counts.current);
      busy.current = true; setStatus(submittingLabel ?? "Saving…");
      await mutationInvoker.invoke(call.service, call.method, { ...buildBindingRequest(call, selection.values), ...values });
      if (alive.current) setStatus(successLabel ?? "Saved.");
    } catch (reason) {
      if (alive.current) { setStatus(""); setError(reason instanceof Error ? reason.message : String(reason)); }
    } finally { busy.current = false; }
  }
  return <form className={className} data-mode={panel.mode} onSubmit={submit}>
    {defaultError ? <p role="alert">{defaultError}</p> : loading ? <p role="status">Loading…</p> : <FormEnumValues.Provider value={enums.current}><FormRepeatedCounts.Provider value={counts.current}><FormInitialValues.Provider value={initial}>
      {panel.fields.map(field => <FormFieldRow key={field.fieldId} c={c} field={field} mode={panel.mode} />)}
    </FormInitialValues.Provider></FormRepeatedCounts.Provider></FormEnumValues.Provider>}
    {edit && call && <button type="submit" disabled={!!defaultError || loading || status === (submittingLabel ?? "Saving…") || !allowed}>{submitLabel ?? `Save ${panel.itemNoun}`.trim()}</button>}
    {edit && call && !allowed && <p role="status">Saving is not permitted.</p>}
    {status && <p role="status">{status}</p>}
    {error && <p role="alert">{error}</p>}
  </form>;
}
