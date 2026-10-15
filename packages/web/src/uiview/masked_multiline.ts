import { editMaskedSelection, maskedLines, replaceMaskedLine } from "@savvifi/meridian-schemas/uiview";

/** Native password lines, shared edit semantics, exact raw form value. */
export function buildMaskedMultiline(name: string, label: string, initial: string, rows: number) {
  const element = document.createElement("fieldset"); element.setAttribute("aria-label", label);
  const legend = document.createElement("legend"); legend.textContent = label; element.append(legend);
  const hidden = document.createElement("input"); hidden.type = "hidden"; hidden.name = name; element.append(hidden);
  const body = document.createElement("div"); body.style.maxHeight = "60vh"; body.style.overflow = "auto";
  body.style.minHeight = `min(${Math.max(1, rows) * 2}em, 60vh)`; element.append(body);
  const actions = document.createElement("div"); element.append(actions);
  const help = document.createElement("p"); help.textContent = "Contents are masked. Press Enter to add a line; use Up and Down to move between lines."; element.append(help);
  let raw = initial, page = 0;
  const inputs = new Map<number, HTMLInputElement>();
  const focus = (index: number, column: number) => { const input = inputs.get(index); input?.focus(); input?.setSelectionRange(column, column); };
  const apply = (next: ReturnType<typeof editMaskedSelection>) => {
    if (!next) return false;
    raw = next.value; page = Math.floor(next.line / 100) * 100; draw(); focus(next.line, next.column); return true;
  };
  const draw = () => {
    hidden.value = raw; body.replaceChildren(); actions.replaceChildren(); inputs.clear();
    const lines = maskedLines(raw);
    lines.slice(page, page + 100).forEach((line, relative) => {
      const index = page + relative, wrapper = document.createElement("label"); wrapper.style.display = "block";
      const caption = document.createElement("span"); caption.textContent = `Line ${index + 1}`; wrapper.append(caption);
      const input = document.createElement("input"); input.type = "password"; input.autocomplete = "off";
      input.setAttribute("aria-label", `${label}, line ${index + 1}`); input.value = line.value; inputs.set(index, input);
      input.addEventListener("input", () => { raw = replaceMaskedLine(raw, index, input.value); hidden.value = raw; });
      input.addEventListener("paste", event => {
        const text = event.clipboardData?.getData("text/plain");
        if (text !== undefined) { event.preventDefault(); apply(editMaskedSelection(raw, index, input.selectionStart ?? 0, input.selectionEnd ?? 0, "insert", text)); }
      });
      input.addEventListener("drop", event => {
        const text = event.dataTransfer?.getData("text/plain");
        if (text !== undefined) { event.preventDefault(); apply(editMaskedSelection(raw, index, input.selectionStart ?? 0, input.selectionEnd ?? 0, "insert", text)); }
      });
      input.addEventListener("keydown", event => {
        if (event.defaultPrevented || event.isComposing || event.ctrlKey || event.metaKey || event.altKey) return;
        const action = event.key === "Enter" ? "break" : event.key === "Backspace" ? "backspace" : event.key === "Delete" ? "delete" : undefined;
        if (action && apply(editMaskedSelection(raw, index, input.selectionStart ?? 0, input.selectionEnd ?? 0, action))) event.preventDefault();
        if (event.key === "ArrowUp" || event.key === "ArrowDown") {
          const target = index + (event.key === "ArrowUp" ? -1 : 1), current = maskedLines(raw);
          if (current[target]) { event.preventDefault(); const col = Math.min(current[target].value.length, input.selectionStart ?? 0);
            if (!inputs.has(target)) { page = Math.floor(target / 100) * 100; draw(); } focus(target, col);
          }
        }
      });
      wrapper.append(input); body.append(wrapper);
    });
    const button = (text: string, click: () => void) => { const node = document.createElement("button"); node.type = "button"; node.textContent = text; node.onclick = click; actions.append(node); };
    button("Add line", () => { const current = maskedLines(raw), last = current.length - 1; apply(editMaskedSelection(raw, last, current[last].value.length, current[last].value.length, "break")); });
    if (page > 0) button("Previous lines", () => { page = Math.max(0, page - 100); draw(); focus(page, 0); });
    if (page + 100 < lines.length) button("Next lines", () => { page += 100; draw(); focus(page, 0); });
  };
  draw();
  return { element, read: () => raw };
}
