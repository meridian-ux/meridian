export declare function escHtml(value: string | number | null | undefined): string;
export declare function shortName(resourceName: string | null | undefined): string;
/** Minimal inline markdown → HTML: **bold**, `code`, newlines. Escapes first. */
export declare function mdInline(text: string): string;
