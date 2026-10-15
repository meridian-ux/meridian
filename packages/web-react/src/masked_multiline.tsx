import { useLayoutEffect, useRef, useState } from "react";
import { editMaskedSelection, maskedLines, replaceMaskedLine } from "@savvifi/meridian-schemas/uiview";

/** A multiline editor made of native password controls. No plaintext textarea,
 * CSS-only concealment, or secret-bearing visible text. Hidden form data keeps
 * the exact raw value, including CRLF, blank lines, and trailing separators. */
export function MaskedMultiline({ value, defaultValue = "", onChange, name, label, rows = 4, disabled, className, inputClassName }: {
  value?: string; defaultValue?: string; onChange?: (value: string) => void;
  name?: string; label: string; rows?: number; disabled?: boolean; className?: string; inputClassName?: string;
}) {
  const [local, setLocal] = useState(defaultValue);
  const [page, setPage] = useState(0);
  const raw = value ?? local, lines = maskedLines(raw);
  const visiblePage = Math.min(page, Math.floor((lines.length - 1) / 100) * 100);
  const inputs = useRef(new Map<number, HTMLInputElement>());
  const cursor = useRef<{ line: number; column: number } | undefined>(undefined);
  useLayoutEffect(() => {
    const next = cursor.current; cursor.current = undefined;
    if (next) { const input = inputs.current.get(next.line); input?.focus(); input?.setSelectionRange(next.column, next.column); }
  }, [raw, page]);
  const change = (next: string) => { if (value === undefined) setLocal(next); onChange?.(next); };
  const edit = (index: number, input: HTMLInputElement, action: Parameters<typeof editMaskedSelection>[4], text?: string) => {
    const next = editMaskedSelection(raw, index, input.selectionStart ?? 0, input.selectionEnd ?? 0, action, text);
    if (!next) return false;
    cursor.current = next; setPage(Math.floor(next.line / 100) * 100); change(next.value); return true;
  };
  return <fieldset className={className} disabled={disabled} aria-label={label}>
    <legend>{label}</legend>
    {name && <input type="hidden" name={name} value={raw} />}
    <div style={{ maxHeight: "60vh", overflow: "auto", minHeight: `min(${Math.max(1, rows) * 2}em, 60vh)` }}>
      {lines.slice(visiblePage, visiblePage + 100).map((line, relative) => { const index = visiblePage + relative; return <label key={index} style={{ display: "block" }}>
        <span>Line {index + 1}</span>
        <input type="password" autoComplete="off" className={inputClassName} aria-label={`${label}, line ${index + 1}`}
          ref={input => { if (input) inputs.current.set(index, input); else inputs.current.delete(index); }} value={line.value}
          onChange={event => change(replaceMaskedLine(raw, index, event.currentTarget.value))}
          onPaste={event => { const text = event.clipboardData?.getData("text/plain"); if (text !== undefined) { event.preventDefault(); edit(index, event.currentTarget, "insert", text); } }}
          onDrop={event => { const text = event.dataTransfer?.getData("text/plain"); if (text !== undefined) { event.preventDefault(); edit(index, event.currentTarget, "insert", text); } }}
          onKeyDown={event => {
            if (event.defaultPrevented || event.nativeEvent.isComposing || event.ctrlKey || event.metaKey || event.altKey) return;
            const action = event.key === "Enter" ? "break" : event.key === "Backspace" ? "backspace" : event.key === "Delete" ? "delete" : undefined;
            if (action && edit(index, event.currentTarget, action)) event.preventDefault();
            if (event.key === "ArrowUp" || event.key === "ArrowDown") {
              const target = index + (event.key === "ArrowUp" ? -1 : 1);
              if (lines[target]) { event.preventDefault(); const col = Math.min(lines[target].value.length, event.currentTarget.selectionStart ?? 0);
                const input = inputs.current.get(target); if (input) { input.focus(); input.setSelectionRange(col, col); }
                else { cursor.current = { line: target, column: col }; setPage(Math.floor(target / 100) * 100); }
              }
            }
          }} />
      </label>; })}
    </div>
    <button type="button" onClick={() => {
      const last = lines.length - 1, next = editMaskedSelection(raw, last, lines[last].value.length, lines[last].value.length, "break");
      if (next) { cursor.current = next; setPage(Math.floor(next.line / 100) * 100); change(next.value); }
    }}>Add line</button>
    {visiblePage > 0 && <button type="button" onClick={() => { const next = Math.max(0, visiblePage - 100); cursor.current = { line: next, column: 0 }; setPage(next); }}>Previous lines</button>}
    {visiblePage + 100 < lines.length && <button type="button" onClick={() => { cursor.current = { line: visiblePage + 100, column: 0 }; setPage(visiblePage + 100); }}>Next lines</button>}
    <p>Contents are masked. Press Enter to add a line; use Up and Down to move between lines.</p>
  </fieldset>;
}
