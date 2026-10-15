// Local edit state only, never serialized. Native password controls own text
// editing/IME within each line; this model owns line separators and joins.
export function maskedLines(value: string) {
  const lines: Array<{ start: number; end: number; value: string }> = [];
  let start = 0;
  for (const match of value.matchAll(/\r\n|\r|\n/g)) {
    lines.push({ start, end: match.index, value: value.slice(start, match.index) });
    start = match.index + match[0].length;
  }
  lines.push({ start, end: value.length, value: value.slice(start) });
  return lines;
}

export function replaceMaskedLine(value: string, index: number, text: string) {
  const line = maskedLines(value)[index];
  if (!line) return value;
  return value.slice(0, line.start) + text + value.slice(line.end);
}

export function editMaskedSelection(value: string, index: number, start: number, end: number, action: "insert" | "break" | "backspace" | "delete", text = "") {
  const lines = maskedLines(value), line = lines[index];
  if (!line) return undefined;
  start = Math.max(0, Math.min(start, line.value.length)); end = Math.max(start, Math.min(end, line.value.length));
  let from = line.start + start, to = line.start + end;
  if (action === "break") text = value.match(/\r\n|\r|\n/)?.[0] ?? "\n";
  if (action === "backspace") {
    if (start !== 0 || end !== 0 || index === 0) return undefined;
    from = lines[index - 1].end; to = line.start;
  }
  if (action === "delete") {
    if (start !== line.value.length || end !== start || index === lines.length - 1) return undefined;
    from = line.end; to = lines[index + 1].start;
  }
  const next = value.slice(0, from) + text + value.slice(to), offset = from + text.length;
  const nextLines = maskedLines(next);
  const cursorLine = nextLines.findIndex(item => offset <= item.end);
  return { value: next, line: cursorLine, column: Math.max(0, offset - nextLines[cursorLine].start) };
}
