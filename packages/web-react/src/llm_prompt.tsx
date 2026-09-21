import { useState, type FormEvent } from "react";
import type { FormField } from "@savvifi/meridian-proto-ts/proto/form_pb.js";
import type { LlmPromptPanel } from "@savvifi/meridian-proto-ts/proto/llm_prompt_pb.js";
import { FormFieldRow, type FormFieldClasses } from "./form_fields.js";

// Read the shared FormField controls using their documented FormData paths.
// Runtime values stay local to this preview; they never cross an RPC boundary.
function readField(field: FormField, name: string, data: FormData): unknown {
  const kind = field.kind;
  if (kind.case === "boolean") return data.has(name);
  if (kind.case === "nested") return Object.fromEntries(kind.value.fields.map((child) => {
    const key = child.requestField || child.fieldId;
    return [key, readField(child, `${name}.${key}`, data)];
  }));
  if (kind.case === "repeated") {
    const count = Number(data.get(`${name}.__count`) || 0);
    const element = kind.value.element;
    return Array.from({ length: count }, (_, index) => {
      const path = `${name}[${index}]`;
      if (element.case === "scalar") return readField(element.value, path, data);
      if (element.case === "object") return Object.fromEntries(element.value.fields.map((child) => {
        const key = child.requestField || child.fieldId;
        return [key, readField(child, `${path}.${key}`, data)];
      }));
      return null;
    });
  }
  if (kind.case === "keyValueMap") return JSON.parse(String(data.get(name) || "{}"));
  const value = String(data.get(name) ?? "");
  return (kind.case === "integer" || kind.case === "number") && value !== "" ? Number(value) : value;
}

/** Preview-only realization shared by the two reference kits. */
export function LlmPromptContent({ panel, c }: { panel: LlmPromptPanel; c: FormFieldClasses }) {
  const [values, setValues] = useState<Map<string, string>>(new Map());
  const renderTemplate = (template: string) => template.replace(/\{\{\s*([^{}]+?)\s*\}\}/g,
    (token, name: string) => values.get(name) ?? token);
  const unresolved = [...new Set(
    [...`${panel.systemTemplate}\n${panel.userTemplate}`.matchAll(/\{\{\s*([^{}]+?)\s*\}\}/g)]
      .map((match) => match[1]).filter((name) => !values.has(name)),
  )];
  const model = panel.modelHint;

  function preview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setValues(new Map(panel.slots.flatMap((slot, index) => {
      if (!slot.field) return [];
      const value = readField(slot.field, `slot-${index}`, data);
      return [[slot.name, typeof value === "string" ? value : JSON.stringify(value)] as const];
    })));
  }

  return (
    <div className={c.nested}>
      {panel.description && <p>{panel.description}</p>}
      {model && <dl aria-label="Model settings">
        {model.provider && <><dt>Provider</dt><dd>{model.provider}</dd></>}
        {model.model && <><dt>Model</dt><dd>{model.model}</dd></>}
        {model.maxTokens !== 0 && <><dt>Max output tokens</dt><dd>{model.maxTokens}</dd></>}
        {model.temperature !== 0 && <><dt>Temperature</dt><dd>{model.temperature}</dd></>}
      </dl>}
      <form className={c.nested} onSubmit={preview}>
        {panel.slots.map((slot, index) => {
          const field = slot.field;
          if (!field) return <p key={index} role="status">No input declared for {slot.name}.</p>;
          const multiline = slot.multiLine && (field.kind.case === "text" || field.kind.case === "masked");
          return multiline ? (
            <label key={index} className={c.field}>
              <span className={c.fieldLabel}>{field.label || slot.name}</span>
              {field.description && <span className={c.fieldDesc}>{field.description}</span>}
              <textarea className={c.fieldInput} name={`slot-${index}`} rows={slot.rows > 0 ? slot.rows : 4}
                defaultValue={field.kind.case === "text" || field.kind.case === "masked" ? field.kind.value.defaultValue : ""} />
            </label>
          ) : (
            <FormFieldRow key={index} c={c} mode={2}
              field={{ ...field, fieldId: `slot-${index}`, requestField: `slot-${index}`, label: field.label || slot.name }} />
          );
        })}
        {panel.slots.some((slot) => slot.field) && <button type="submit" className={c.addBtn}>Preview</button>}
      </form>
      {panel.systemTemplate && <section aria-label="System prompt"><h4>System prompt</h4><pre>{renderTemplate(panel.systemTemplate)}</pre></section>}
      <section aria-label="User prompt"><h4>User prompt</h4><pre>{renderTemplate(panel.userTemplate)}</pre></section>
      {unresolved.length > 0 && <p role="status">Unresolved slots: {unresolved.join(", ")}</p>}
      {panel.outputJsonSchema && <section aria-label="Output JSON schema"><h4>Output JSON schema</h4><pre>{panel.outputJsonSchema}</pre></section>}
    </div>
  );
}
