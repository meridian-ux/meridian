import type { FormField } from "@savvifi/meridian-proto-ts/proto/form_pb.js";

/** Aggregates containing masked children are concealed as a whole by default. */
export function hasMaskedField(field: FormField | undefined): boolean {
  const kind = field?.kind;
  if (kind?.case === "masked") return true;
  if (kind?.case === "nested") return kind.value.fields.some(hasMaskedField);
  if (kind?.case === "repeated") {
    const element = kind.value.element;
    return element.case === "scalar" ? hasMaskedField(element.value)
      : element.case === "object" && element.value.fields.some(hasMaskedField);
  }
  return false;
}

/** Local preview computation, not a transport DTO. Scan original tokens once:
 * replacement strings are literal and cannot recursively expand other slots. */
export function renderPromptTemplate(template: string, values: ReadonlyMap<string, string>, concealed: ReadonlySet<string> = new Set()) {
  const unresolved = new Set<string>();
  const text = template.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (token, name: string) => {
    if (!values.has(name)) unresolved.add(name);
    if (values.has(name) && concealed.has(name)) return "••••••";
    return values.get(name) ?? token;
  });
  return { text, unresolved: [...unresolved] };
}
