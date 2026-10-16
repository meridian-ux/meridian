import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type FormEvent } from "react";
import type { PromptPanel } from "@savvifi/meridian-proto-ts/proto/prompt_pb.js";
import { createPromptResponder, promptValues } from "@savvifi/meridian-schemas/uiview";
import { FormEnumValues, FormFieldRow, type FormFieldClasses } from "./form_fields.js";
import { formDefaultsError, readFormFields } from "./form.js";
import { useMeridian } from "./provider.js";

/** Runtime response lifecycle shared by all React kits; values cross the host
 * callback as the existing protobuf Struct, not a parallel response DTO. */
export function usePromptResponse(panelId: string) {
  const { onPromptResponse, invoker } = useMeridian();
  const [responder] = useState(createPromptResponder);
  const state = useSyncExternalStore(responder.subscribe, responder.getSnapshot, responder.getSnapshot);
  useEffect(() => { responder.activate(); return () => responder.dispose(); }, [responder]);
  return {
    ...state, invoker,
    disabled: !onPromptResponse || state.busy || state.done,
    status: state.status || (!onPromptResponse ? "No prompt handler configured." : ""),
    inputError: responder.inputError,
    async submit(values: Record<string, unknown>) {
      try { await responder.respond(onPromptResponse, panelId, promptValues(values)); }
      catch (reason) { responder.inputError(reason); }
    },
    confirm(value: boolean) { return responder.respond(onPromptResponse, panelId, promptValues({ [panelId]: value })); },
    cancel() { return responder.respond(onPromptResponse, panelId, null); },
  };
}

export function PromptContent({ panel, panelId, c }: { panel: PromptPanel; panelId: string; c: FormFieldClasses }) {
  const response = usePromptResponse(panelId);
  const enums = useRef(new Map<string, readonly string[]>());
  const defaultError = useMemo(() => panel.isConfirmation ? undefined : formDefaultsError(panel.fields), [panel.isConfirmation, panel.fields]);
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (response.disabled || defaultError) return;
    if (panel.isConfirmation) { void response.confirm(true); return; }
    try { void response.submit(readFormFields(panel.fields, new FormData(event.currentTarget), enums.current)); }
    catch (reason) { response.inputError(reason); }
  };
  return <form className={c.nested} onSubmit={submit} onKeyDown={event => {
    if (event.key === "Escape" && !event.defaultPrevented) { event.preventDefault(); void response.cancel(); }
  }}>
    {panel.description && <p>{panel.description}</p>}
    {panel.detail && <pre>{panel.detail}</pre>}
    {defaultError ? <p role="alert">{defaultError}</p> : !panel.isConfirmation && <fieldset disabled={response.disabled}><FormEnumValues.Provider value={enums.current}>
      {panel.fields.map((field, index) => <FormFieldRow key={`${field.fieldId}:${index}`} c={c} field={field} mode={2} />)}
    </FormEnumValues.Provider></fieldset>}
    <button className={c.addBtn} type="submit" disabled={response.disabled || !!defaultError}>{panel.acceptLabel || (panel.isConfirmation ? "Yes" : "Submit")}</button>
    <button className={c.addBtn} type="button" disabled={response.disabled} onClick={() => { void (panel.isConfirmation ? response.confirm(false) : response.cancel()); }}>{panel.cancelLabel || (panel.isConfirmation ? "No" : "Cancel")}</button>
    {response.status && <p role="status">{response.status}</p>}
    {response.error && <p role="alert">{response.error}</p>}
  </form>;
}
