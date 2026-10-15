import type { FormField } from "@savvifi/meridian-proto-ts/proto/form_pb.js";

/** Validate local form values before any host callback/RPC. No coercion: empty
 * numbers, fractions in integer fields, and string booleans are not defaults. */
export function validateFormValues(fields: readonly FormField[], values: unknown): string | undefined {
  const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
  const validate = (field: FormField, value: unknown): string | undefined => {
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
        const options = kind.value.options.length ? kind.value.options.map(option => option.value) : kind.value.allowedValues;
        return typeof value === "string" && options.includes(value) ? undefined : fail("select an allowed value");
      }
      case "nested": return object(value) ? validateFormValues(kind.value.fields, value) : fail("invalid object");
      case "repeated": {
        if (!Array.isArray(value) || value.length < kind.value.minItems || (kind.value.maxItems && value.length > kind.value.maxItems)) return fail("invalid item count");
        const element = kind.value.element;
        if (!element.case) return fail("unsupported repeated element");
        for (const item of value) {
          const error = element.case === "scalar" ? validate(element.value, item)
            : element.case === "object" ? validateFormValues(element.value.fields, item) : fail("unsupported repeated element");
          if (error) return error;
        }
        return;
      }
      case "keyValueMap": return object(value) && Object.values(value).every(item => typeof item === "string") &&
        (!kind.value.maxItems || Object.keys(value).length <= kind.value.maxItems) ? undefined : fail("invalid map");
      default: return fail("unsupported field kind");
    }
  };
  if (!object(values)) return "Invalid form values.";
  for (const field of fields) {
    const error = validate(field, Object.hasOwn(values, field.fieldId) ? values[field.fieldId] : undefined);
    if (error) return error;
  }
  return undefined;
}
