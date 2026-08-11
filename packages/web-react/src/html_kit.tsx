// htmlKit — a minimal, dependency-free reference ComponentKit. It paints plain
// semantic HTML (styleable via the kit's CSS classes + the `--mer-*` theme vars)
// and proves the React renderer end to end without MUI/shadcn. The real savvi
// `mui-kit` (wrapping @aion/ui) and a future `shadcn-kit` are richer
// implementations of the same ComponentKit interface.

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
import { FormFieldRow, HTML_FORM_CLASSES } from "./form_fields.js";

// The six content shapes are rendered by the shared, field-complete
// content_shapes module (icon / description / language / secret-reveal /
// placeholder all realized) with htmlKit's `mer-*` class vocabulary. shadcnKit
// delegates to the SAME module (different class table), so the two reference
// kits cannot drift.
const c = classesFor("html");

function themeToStyle(theme: Theme | undefined): CSSProperties {
  if (!theme) return {};
  const pal = theme.dark ?? theme.light;
  if (!pal) return {};
  // Expose the palette as the same --mer-* custom properties the web-components
  // renderer uses, so one skin styles both web renderers identically.
  return {
    ["--mer-bg" as string]: pal.bg,
    ["--mer-surface" as string]: pal.surface,
    ["--mer-fg" as string]: pal.fg,
    ["--mer-accent" as string]: pal.accent,
    ["--mer-border" as string]: pal.border,
    background: "var(--mer-bg)",
    color: "var(--mer-fg)",
  };
}

export const htmlKit: ComponentKit = {
  id: "html",
  themeToStyle,
  Chrome: ({ descriptor, children }) => (
    <section className="mer-panel" style={themeToStyle(undefined)}>
      <h2 className="mer-panel-title">{descriptor.title || descriptor.panelId}</h2>
      {children}
    </section>
  ),
  Table: ({ panel }) => (
    <table className="mer-table">
      <thead>
        <tr>
          {panel.columns.map((col, i) => (
            <th key={i}>{col.header}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        <tr>
          <td className="mer-empty" colSpan={panel.columns.length || 1}>
            {panel.placeholder || "(load to populate)"}
          </td>
        </tr>
      </tbody>
    </table>
  ),
  // Gallery — the image/media card grid. Like Table, htmlKit is the minimal
  // reference kit (no fetch), so it paints the semantic scaffold + placeholder;
  // mui-kit renders the fetched image cards / lightbox. `card.image_field` is the
  // image src slot (distinct from the icon glyph).
  Gallery: ({ panel }) => (
    <div className="mer-gallery" role="list" data-rows-field={panel.rowsField} data-image-field={panel.card?.imageField}>
      <p className="mer-empty">{panel.placeholder || "(load to populate)"}</p>
    </div>
  ),
  Prompt: ({ panel }) => (
    <form className="mer-prompt">
      {panel.fields.map((field) => (
        <label key={field.fieldId} className="mer-field">
          <span>{field.label}</span>
        </label>
      ))}
    </form>
  ),
  Lro: ({ panel }) => (
    <div className="mer-lro">
      <button type="button">{panel.runButtonLabel || "Run"}</button>
    </div>
  ),
  Form: ({ panel }) => (
    // FORM_MODE_EDIT = 2; anything else renders read-only.
    <form className="mer-form" data-mode={panel.mode}>
      {panel.fields.map((field) => (
        <FormFieldRow
          key={field.fieldId}
          c={HTML_FORM_CLASSES}
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
    <div className="mer-action">
      {panel.description && <p className="mer-action-desc">{panel.description}</p>}
      {panel.action && <AffordanceControl c={c} affordance={panel.action} />}
    </div>
  ),
  CopyValue: ({ panel }) => (panel.value ? <CopyValueContent c={c} value={panel.value} /> : null),
  ConnectFlow: ({ panel }) => <ConnectFlowContent c={c} panel={panel} />,
  Catalog: ({ panel }) => <CatalogContent c={c} panel={panel} />,
  Grammar: ({ panel }) => <GrammarContent c={c} panel={panel} />,
  Stat: ({ panel }) => <StatContent c={c} panel={panel} />,
  Fallback: ({ descriptor }) => (
    <pre className="mer-fallback">
      {descriptor.body.case
        ? `unsupported panel shape: ${descriptor.body.case}`
        : "(empty panel)"}
    </pre>
  ),
};
