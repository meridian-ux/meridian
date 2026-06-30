// htmlKit — a minimal, dependency-free reference ComponentKit. It paints plain
// semantic HTML (styleable via the kit's CSS classes + the `--mer-*` theme vars)
// and proves the React renderer end to end without MUI/shadcn. The real savvi
// `mui-kit` (wrapping @aion/ui) and a future `shadcn-kit` are richer
// implementations of the same ComponentKit interface.

import type { CSSProperties } from "react";

import type { Theme } from "@savvifi/meridian-proto-ts/proto/theme_pb.js";

import type { ComponentKit } from "./component_kit.js";

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
  Fallback: ({ descriptor }) => (
    <pre className="mer-fallback">
      {descriptor.body.case
        ? `unsupported panel shape: ${descriptor.body.case}`
        : "(empty panel)"}
    </pre>
  ),
};
