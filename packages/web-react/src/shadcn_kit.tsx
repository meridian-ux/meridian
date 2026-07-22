// shadcnKit — a second reference ComponentKit, dependency-free, emitting the
// shadcn/ui Tailwind class + CSS-variable conventions.
//
// It exists to prove **Swap B** (swap the kit → same PanelRenderer dispatch,
// different look) with a real second kit beyond the minimal htmlKit, and to give
// the savvi `mui-kit` (wrapping @aion/ui) a richer structural template. Like
// htmlKit it pulls NO component library: a production shadcn-kit (Radix
// primitives) would be its own package, a peer of mui-kit — this is the
// in-core reference that keeps web-react kit-agnostic.

import type { CSSProperties } from "react";

import type { Theme } from "@savvifi/meridian-proto-ts/proto/theme_pb.js";

import type { ComponentKit } from "./component_kit.js";
import {
  AffordanceControl,
  CatalogContent,
  ChoiceContent,
  ConnectFlowContent,
  CopyValueContent,
  GrammarContent,
  SnippetContent,
  StatContent,
  classesFor,
} from "./content_shapes.js";
import { FormFieldRow, SHADCN_FORM_CLASSES } from "./form_fields.js";

// The six content shapes delegate to the shared, field-complete content_shapes
// module (same code as htmlKit) with shadcn's Tailwind class table — so the two
// reference kits are guaranteed field-parity (icon / description / language /
// secret-reveal / placeholder). Different classes, identical dispatch: Swap B.
const c = classesFor("shadcn");

// Bind the meridian palette to shadcn/ui's CSS custom properties so shadcn
// Tailwind classes (bg-card, text-muted-foreground, border, …) paint the skin.
// (Hex here for the reference; a production shadcn-kit would emit hsl triplets
// for the `hsl(var(--token))` convention.)
function themeToStyle(theme: Theme | undefined): CSSProperties {
  if (!theme) return {};
  const pal = theme.dark ?? theme.light;
  if (!pal) return {};
  return {
    ["--background" as string]: pal.bg,
    ["--card" as string]: pal.surface,
    ["--foreground" as string]: pal.fg,
    ["--muted-foreground" as string]: pal.muted,
    ["--border" as string]: pal.border,
    ["--primary" as string]: pal.accent,
    ["--primary-foreground" as string]: pal.onAccent,
    ["--destructive" as string]: pal.danger,
    background: "var(--background)",
    color: "var(--foreground)",
  };
}

export const shadcnKit: ComponentKit = {
  id: "shadcn",
  themeToStyle,
  Chrome: ({ descriptor, children }) => (
    <section className="rounded-lg border bg-card text-card-foreground shadow-sm">
      <header className="border-b px-4 py-3">
        <h3 className="text-sm font-semibold leading-none tracking-tight">
          {descriptor.title || descriptor.panelId}
        </h3>
      </header>
      <div className="p-4">{children}</div>
    </section>
  ),
  Table: ({ panel }) => (
    <div className="relative w-full overflow-auto">
      <table className="w-full caption-bottom text-sm">
        <thead className="[&_tr]:border-b">
          <tr className="border-b transition-colors">
            {panel.columns.map((col, i) => (
              <th
                key={i}
                className="h-10 px-2 text-left align-middle font-medium text-muted-foreground"
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="[&_tr:last-child]:border-0">
          <tr className="border-b transition-colors hover:bg-muted/50">
            <td
              className="p-2 align-middle text-muted-foreground"
              colSpan={panel.columns.length || 1}
            >
              {panel.placeholder || "(load to populate)"}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  ),
  // Gallery — image/media card grid. Reference kit (no fetch): the scaffold +
  // placeholder; mui-kit renders the fetched image cards / lightbox.
  Gallery: ({ panel }) => (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3" role="list" data-rows-field={panel.rowsField} data-image-field={panel.card?.imageField}>
      <p className="col-span-full text-sm text-muted-foreground">{panel.placeholder || "(load to populate)"}</p>
    </div>
  ),
  Prompt: ({ panel }) => (
    <form className="grid gap-4">
      {panel.fields.map((field) => (
        <div key={field.fieldId} className="grid gap-2">
          <label className="text-sm font-medium leading-none">{field.label}</label>
        </div>
      ))}
    </form>
  ),
  Lro: ({ panel }) => (
    <div className="flex items-center gap-2">
      <button
        type="button"
        className="inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
      >
        {panel.runButtonLabel || "Run"}
      </button>
    </div>
  ),
  Form: ({ panel }) => (
    // FORM_MODE_EDIT = 2; anything else renders read-only.
    <form className="grid gap-4" data-mode={panel.mode}>
      {panel.fields.map((field) => (
        <FormFieldRow
          key={field.fieldId}
          c={SHADCN_FORM_CLASSES}
          field={field}
          mode={panel.mode}
        />
      ))}
    </form>
  ),
  // ── content shapes (shared, field-complete renderers) ───────────────────────
  Choice: ({ panel }) => <ChoiceContent c={c} panel={panel} />,
  Snippet: ({ panel }) => (panel.snippet ? <SnippetContent c={c} snippet={panel.snippet} /> : null),
  Action: ({ panel }) => (
    <div className="grid gap-2">
      {panel.description && (
        <p className="text-sm text-muted-foreground">{panel.description}</p>
      )}
      {panel.action && <AffordanceControl c={c} affordance={panel.action} />}
    </div>
  ),
  CopyValue: ({ panel }) => (panel.value ? <CopyValueContent c={c} value={panel.value} /> : null),
  ConnectFlow: ({ panel }) => <ConnectFlowContent c={c} panel={panel} />,
  Catalog: ({ panel }) => <CatalogContent c={c} panel={panel} />,
  Grammar: ({ panel }) => <GrammarContent c={c} panel={panel} />,
  Stat: ({ panel }) => <StatContent c={c} panel={panel} />,
  Fallback: ({ descriptor }) => (
    <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
      {descriptor.body.case
        ? `unsupported panel shape: ${descriptor.body.case}`
        : "(empty panel)"}
    </div>
  ),
};
