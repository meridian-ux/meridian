export function patchText(
  root: ParentNode | null | undefined,
  selector: string,
  text: string | number | null | undefined,
): boolean {
  const node = root?.querySelector<HTMLElement>(selector);
  if (!node) {
    return false;
  }
  const next = text == null ? '' : String(text);
  if (node.textContent !== next) {
    node.textContent = next;
    return true;
  }
  return false;
}

export function patchHtml(
  root: ParentNode | null | undefined,
  selector: string,
  html: string | null | undefined,
): boolean {
  const node = root?.querySelector<HTMLElement>(selector);
  if (!node) {
    return false;
  }
  const next = html == null ? '' : String(html);
  if (node.innerHTML !== next) {
    node.innerHTML = next;
    return true;
  }
  return false;
}

export function patchClassName(
  root: ParentNode | null | undefined,
  selector: string,
  className: string | null | undefined,
): boolean {
  const node = root?.querySelector<HTMLElement>(selector);
  if (!node) {
    return false;
  }
  const next = className == null ? '' : String(className);
  if (node.className !== next) {
    node.className = next;
    return true;
  }
  return false;
}
