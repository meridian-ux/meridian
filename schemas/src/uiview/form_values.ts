import type { FormField } from "@savvifi/meridian-proto-ts/proto/form_pb.js";

/** Allocation-free preflight for descriptor-driven initializers, including
 * legacy read-only fields without an input kind. This checks resource bounds,
 * not input validity; unknown kinds retain each surface's existing fallback. */
export function assertFormDefaultBudget(fields: readonly FormField[]): void {
  let remaining = 1000;
  const group = (fields: readonly FormField[], depth: number): void => {
    if (depth > 64) throw new Error("Default expansion exceeds 64 nested levels.");
    for (const field of fields) value(field, depth);
  };
  const value = (field: FormField, depth: number): void => {
    if (depth > 64 || --remaining < 0) throw new Error("Default expansion exceeds 1000 value nodes or 64 nested levels.");
    const kind = field.kind;
    if (kind.case === "nested") group(kind.value.fields, depth + 1);
    if (kind.case === "repeated") {
      if (kind.value.minItems > remaining) throw new Error("Default expansion exceeds 1000 value nodes.");
      const element = kind.value.element;
      for (let index = 0; index < kind.value.minItems; index++) {
        if (element.case === "scalar") value(element.value, depth + 1);
        else {
          if (--remaining < 0) throw new Error("Default expansion exceeds 1000 value nodes.");
          if (element.case === "object") group(element.value.fields, depth + 1);
        }
      }
    }
  };
  group(fields, 0);
}

/** Canonical local defaults. Bound recursive minimum-row expansion rather than
 * allocating producer-controlled arrays or silently truncating their values. */
export function defaultFormValues(fields: readonly FormField[]): Record<string, unknown> {
  let remaining = 1000;
  const defaults = (fields: readonly FormField[], depth: number): Record<string, unknown> => {
    if (depth > 64) throw new Error("Default expansion exceeds 64 nested levels.");
    return Object.fromEntries(fields.map(field => [field.fieldId, value(field, depth)]));
  };
  const value = (field: FormField, depth: number): unknown => {
    if (depth > 64 || --remaining < 0) throw new Error("Default expansion exceeds 1000 value nodes or 64 nested levels.");
    const kind = field.kind;
    switch (kind.case) {
      case "integer": case "number": case "boolean": case "text": case "masked": return kind.value.defaultValue;
      case "enumSelection": return kind.value.defaultValue || kind.value.options[0]?.value || kind.value.allowedValues[0] || "";
      case "keyValueMap": return {};
      case "nested": return defaults(kind.value.fields, depth + 1);
      case "repeated": {
        if (kind.value.minItems > remaining) throw new Error("Default expansion exceeds 1000 value nodes.");
        const element = kind.value.element;
        return Array.from({ length: kind.value.minItems }, () => {
          if (element.case === "scalar") return value(element.value, depth + 1);
          if (element.case === "object") {
            if (--remaining < 0) throw new Error("Default expansion exceeds 1000 value nodes.");
            return defaults(element.value.fields, depth + 1);
          }
          throw new Error("Missing repeated element kind.");
        });
      }
      default: throw new Error(`${field.label || field.fieldId}: unsupported field kind.`);
    }
  };
  return defaults(fields, 0);
}

export function defaultFormValue(field: FormField): unknown {
  return defaultFormValues([field])[field.fieldId];
}

/** Validate local form values before any host callback/RPC. No coercion: empty
 * numbers, fractions in integer fields, and string booleans are not defaults.
 * Match the native core's 64-level nesting limit and object-field identity rules. */
export function validateFormValues(fields: readonly FormField[], values: unknown,
  // Runtime-only option lookup supplied by a renderer's trusted loaded registry,
  // never by submitted form data. No callback means canonical static options.
  enumOptions?: (field: FormField, inputPath: string) => readonly string[] | undefined,
  prefix = ""): string | undefined {
  const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
  const validateObject = (fields: readonly FormField[], values: unknown, depth: number, prefix: string): string | undefined => {
    if (depth > 64) return "Form nesting exceeds 64 levels.";
    if (!object(values)) return "Invalid form values.";
    const names = new Set<string>();
    for (const field of fields) {
      if (!field.fieldId || names.has(field.fieldId)) return "Field identifiers must be nonempty and unique.";
      names.add(field.fieldId);
      const path = `${prefix ? `${prefix}.` : ""}${field.requestField || field.fieldId}`;
      const error = validate(field, Object.hasOwn(values, field.fieldId) ? values[field.fieldId] : undefined, depth, path);
      if (error) return error;
    }
    return undefined;
  };
  const validate = (field: FormField, value: unknown, depth: number, path: string): string | undefined => {
    if (depth > 64) return "Form nesting exceeds 64 levels.";
    const label = field.label || field.fieldId, kind = field.kind;
    const fail = (message: string) => `${label}: ${message}.`;
    switch (kind.case) {
      case "integer":
      case "number": {
        if (typeof value !== "number" || !Number.isFinite(value) || (kind.case === "integer" && !Number.isSafeInteger(value)) ||
          (kind.value.min !== 0 && value < kind.value.min) || (kind.value.max !== 0 && value > kind.value.max)) return fail("invalid number");
        return;
      }
      case "boolean": return typeof value === "boolean" ? undefined : fail("invalid boolean");
      case "text":
      case "masked": {
        if (typeof value !== "string") return fail("invalid text");
        const spec = kind.value;
        if ((spec.minLength && value.length < spec.minLength) || (spec.maxLength && value.length > spec.maxLength)) return fail("invalid length");
        try { if (spec.pattern && !new RegExp(spec.pattern).test(value)) return fail(spec.patternErrorMsg || "invalid value"); }
        catch { return fail("invalid pattern"); }
        return;
      }
      case "enumSelection": {
        const options = enumOptions?.(field, path) ?? (kind.value.options.length ? kind.value.options.map(option => option.value) : kind.value.allowedValues);
        return typeof value === "string" && options.includes(value) ? undefined : fail("select an allowed value");
      }
      case "nested": return object(value) ? validateObject(kind.value.fields, value, depth + 1, path) : fail("invalid object");
      case "repeated": {
        if (!Array.isArray(value) || value.length < kind.value.minItems || (kind.value.maxItems && value.length > kind.value.maxItems)) return fail("invalid item count");
        const element = kind.value.element;
        if (!element.case) return fail("unsupported repeated element");
        for (const [index, item] of value.entries()) {
          const itemPath = `${path}[${index}]`;
          const error = element.case === "scalar" ? validate(element.value, item, depth + 1, itemPath)
            : element.case === "object" ? validateObject(element.value.fields, item, depth + 1, itemPath) : fail("unsupported repeated element");
          if (error) return error;
        }
        return;
      }
      case "keyValueMap": return object(value) && Object.values(value).every(item => typeof item === "string") &&
        (!kind.value.maxItems || Object.keys(value).length <= kind.value.maxItems) ? undefined : fail("invalid map");
      default: return fail("unsupported field kind");
    }
  };
  return validateObject(fields, values, 0, prefix);
}
