/** Local preview computation, not a transport DTO. Scan original tokens once:
 * replacement strings are literal and cannot recursively expand other slots. */
export function renderPromptTemplate(template: string, values: ReadonlyMap<string, string>) {
  const unresolved = new Set<string>();
  const text = template.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (token, name: string) => {
    if (!values.has(name)) unresolved.add(name);
    return values.get(name) ?? token;
  });
  return { text, unresolved: [...unresolved] };
}
