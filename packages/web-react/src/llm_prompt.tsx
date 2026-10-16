import { useMemo, useRef, useState, type FormEvent } from "react";
import type { LlmPromptPanel } from "@savvifi/meridian-proto-ts/proto/llm_prompt_pb.js";
import { FormEnumValues, FormFieldRow, FormRepeatedCounts, type FormFieldClasses } from "./form_fields.js";
import { formDefaultsError, readFormFields } from "./form.js";
import { hasMaskedField, renderPromptTemplate } from "@savvifi/meridian-schemas/uiview";
import { MaskedMultiline } from "./masked_multiline.js";


/** Preview-only realization shared by the two reference kits. */
export function LlmPromptContent({ panel, c }: { panel: LlmPromptPanel; c: FormFieldClasses }) {
  const [values, setValues] = useState<Map<string, string>>(new Map());
  const [error, setError] = useState("");
  const [reveal, setReveal] = useState(false);
  const masked = new Set(panel.slots.filter(slot => hasMaskedField(slot.field)).map(slot => slot.name));
  const enums = useRef(new Map<string, readonly string[]>());
  const counts = useRef(new Map<string, number>());
  const fields = useMemo(() => panel.slots.flatMap((slot, index) => slot.field ? [{ ...slot.field,
    fieldId: `slot-${index}`, requestField: `slot-${index}`, label: slot.field.label || slot.name }] : []), [panel.slots]);
  const system = renderPromptTemplate(panel.systemTemplate, values, reveal ? undefined : masked);
  const defaultError = useMemo(() => formDefaultsError(fields), [fields]);
  const user = renderPromptTemplate(panel.userTemplate, values, reveal ? undefined : masked);
  const unresolved = [...new Set([...system.unresolved, ...user.unresolved])];
  const model = panel.modelHint;

  function preview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (defaultError) return;
    setReveal(false);
    try {
      const input = readFormFields(fields, new FormData(event.currentTarget), enums.current, counts.current);
      setValues(new Map(panel.slots.flatMap((slot, index) => {
        if (!slot.field) return [];
        const value = input[`slot-${index}`];
        return [[slot.name, typeof value === "string" ? value : JSON.stringify(value)] as const];
      }))); setError("");
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
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
        <FormEnumValues.Provider value={enums.current}><FormRepeatedCounts.Provider value={counts.current}>
        {defaultError ? <p role="alert">{defaultError}</p> : panel.slots.map((slot, index) => {
          const field = slot.field;
          if (!field) return <p key={index} role="status">No input declared for {slot.name}.</p>;
          const multiline = slot.multiLine && (field.kind.case === "text" || field.kind.case === "masked");
          if (multiline && field.kind.case === "masked") return <div key={index}>
            {field.description && <p>{field.description}</p>}
            <MaskedMultiline name={`slot-${index}`} label={field.label || slot.name} defaultValue={field.kind.value.defaultValue}
              rows={slot.rows > 0 ? slot.rows : 4} className={c.field} inputClassName={c.fieldInput} />
          </div>;
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
        </FormRepeatedCounts.Provider></FormEnumValues.Provider>
        {panel.slots.some((slot) => slot.field) && <button type="submit" className={c.addBtn} disabled={!!defaultError}>Preview</button>}
      </form>
      {[...masked].some(name => values.has(name)) && <button type="button" onClick={() => setReveal(value => !value)}>{reveal ? "Hide masked values in preview" : "Show masked values in preview"}</button>}
      {panel.systemTemplate && <section aria-label="System prompt"><h4>System prompt</h4><pre>{system.text}</pre></section>}
      <section aria-label="User prompt"><h4>User prompt</h4><pre>{user.text}</pre></section>
      {unresolved.length > 0 && <p role="status">Unresolved slots: {unresolved.join(", ")}</p>}
      {error && <p role="alert">{error}</p>}
      {panel.outputJsonSchema && <section aria-label="Output JSON schema"><h4>Output JSON schema</h4><pre>{panel.outputJsonSchema}</pre></section>}
    </div>
  );
}
