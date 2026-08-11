export function escHtml(value: string | number | null | undefined): string {
  return (value || '')
    .toString()
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function shortName(resourceName: string | null | undefined): string {
  if (!resourceName) return '';
  const idx = resourceName.lastIndexOf('/');
  return idx >= 0 ? resourceName.slice(idx + 1) : resourceName;
}
