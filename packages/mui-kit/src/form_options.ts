import { useEffect, useState } from "react";
import { create } from "@bufbuild/protobuf";
import { EnumOptionSchema } from "@savvifi/meridian-proto-ts/proto/value_pb.js";
import type { FormField } from "@savvifi/meridian-proto-ts/proto/form_pb.js";
import type { RpcInvoker } from "@savvifi/meridian-schemas/uiview";

function path(value: unknown, key: string): unknown {
  return key.split(".").reduce<unknown>((item, part) => item && typeof item === "object" && Object.hasOwn(item, part)
    ? (item as Record<string, unknown>)[part] : undefined, value);
}

function children(field: FormField): FormField[] {
  const kind = field.kind;
  if (kind.case === "nested") return kind.value.fields;
  if (kind.case === "repeated") {
    const element = kind.value.element;
    return element.case === "scalar" ? [element.value] : element.case === "object" ? element.value.fields : [];
  }
  return [];
}

function hasSource(fields: FormField[]): boolean {
  return fields.some(field => field.kind.case === "enumSelection" && Boolean(field.kind.value.optionsSource) || hasSource(children(field)));
}

async function resolveFields(fields: FormField[], invoker: RpcInvoker): Promise<FormField[]> {
  return Promise.all(fields.map(async field => {
    const kind = field.kind;
    if (kind.case === "enumSelection" && kind.value.optionsSource) {
      const source = kind.value.optionsSource;
      if (!source.service || !source.method) throw new Error("Invalid options source.");
      const rows = path(await invoker.invoke(source.service, source.method, {}), source.optionsField);
      if (!Array.isArray(rows)) throw new Error("Invalid options response.");
      const options = rows.map(row => {
        const value = path(row, source.valueField);
        if (typeof value !== "string" && typeof value !== "number") throw new Error("Invalid option value.");
        const label = source.labelField ? path(row, source.labelField) : value;
        return create(EnumOptionSchema, { value: String(value), label: String(label ?? value) });
      });
      if (!options.length) throw new Error(`No options available for ${field.label || field.fieldId}.`);
      return { ...field, kind: { case: "enumSelection" as const, value: { ...kind.value, options, allowedValues: [] } } };
    }
    if (kind.case === "nested") return { ...field, kind: { case: "nested" as const, value: { ...kind.value, fields: await resolveFields(kind.value.fields, invoker) } } };
    if (kind.case === "repeated") {
      const element = kind.value.element;
      if (element.case === "scalar") return { ...field, kind: { case: "repeated" as const, value: { ...kind.value, element: { case: "scalar" as const, value: (await resolveFields([element.value], invoker))[0]! } } } };
      if (element.case === "object") return { ...field, kind: { case: "repeated" as const, value: { ...kind.value, element: { case: "object" as const, value: { ...element.value, fields: await resolveFields(element.value.fields, invoker) } } } } };
    }
    return field;
  }));
}

// Only runtime descriptors are enriched; authored defaults and wire values stay intact.
export function useFormOptions(fields: FormField[], invoker?: RpcInvoker) {
  const needed = Boolean(invoker && hasSource(fields));
  const [result, setResult] = useState<{ source: FormField[]; invoker: RpcInvoker; fields?: FormField[]; error?: string }>();
  useEffect(() => {
    if (!needed || !invoker) return;
    let active = true;
    setResult(undefined);
    void resolveFields(fields, invoker).then(resolved => {
      if (active) setResult({ source: fields, invoker, fields: resolved });
    }, reason => {
      if (active) setResult({ source: fields, invoker, error: reason instanceof Error ? reason.message : String(reason) });
    });
    return () => { active = false; };
  }, [fields, invoker, needed]);
  const current = result?.source === fields && result.invoker === invoker ? result : undefined;
  return { fields: current?.fields ?? fields, pending: needed && !current, error: current?.error };
}

export function validateFormOptions(fields: FormField[], values: unknown): string | undefined {
  const validate = (field: FormField, value: unknown): string | undefined => {
    const kind = field.kind;
    if (kind.case === "enumSelection" && kind.value.optionsSource && !kind.value.options.some(option => option.value === value))
      return `${field.label || field.fieldId}: select an available option.`;
    if (kind.case === "nested") return validateFormOptions(kind.value.fields, value);
    if (kind.case === "repeated" && Array.isArray(value)) {
      const element = kind.value.element;
      for (const item of value) {
        const error = element.case === "scalar" ? validate(element.value, item) : element.case === "object" ? validateFormOptions(element.value.fields, item) : undefined;
        if (error) return error;
      }
    }
  };
  for (const field of fields) {
    const error = validate(field, values && typeof values === "object" ? (values as Record<string, unknown>)[field.fieldId] : undefined);
    if (error) return error;
  }
}
