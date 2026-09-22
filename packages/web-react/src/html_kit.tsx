// htmlKit — a minimal, dependency-free reference ComponentKit. It paints plain
// semantic HTML (styleable via the kit's CSS classes + the `--mer-*` theme vars)
// and proves the React renderer end to end without MUI/shadcn. The real
// `mui-kit` (wrapping a host's internal MUI component library) and a future `shadcn-kit` are richer
// implementations of the same ComponentKit interface.

import { useContext, type CSSProperties } from "react";

import type { Theme } from "@savvifi/meridian-proto-ts/proto/theme_pb.js";
import { formatByDisplay, isSafeHttpUrl, resolveValueLink } from "@savvifi/meridian-schemas/uiview";

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
import { ResourceCardsView } from "./resource_cards.js";
import { HTML_FORM_CLASSES } from "./form_fields.js";
import { FormContent } from "./form.js";
import { MeridianViewContext } from "./view_renderer.js";
import { useHrefResolver } from "./provider.js";
import { resolvePath, useRecord } from "./pagination.js";
import { useDisplayNow } from "./display_now.js";
import { LlmPromptContent } from "./llm_prompt.js";
import { StepMedia } from "./step_media.js";
import { GalleryContent } from "./gallery.js";
import { TableContent } from "./table.js";

// The six content shapes are rendered by the shared, field-complete
// content_shapes module (icon / description / language / secret-reveal /
// placeholder all realized) with htmlKit's `mer-*` class vocabulary. shadcnKit
// delegates to the SAME module (different class table), so the two reference
// kits cannot drift.
const c = classesFor("html");

function renderDisplayedValue(
  value: unknown,
  display: Parameters<typeof formatByDisplay>[1],
  shown: { text: string; title?: string },
  resolveHref: ReturnType<typeof useHrefResolver>,
) {
  const link = resolveValueLink(value, display);
  const valueHref = link && resolveHref?.(link.targetKind, link.id);
  return valueHref
    ? <a href={valueHref} rel="noreferrer noopener" title={shown.title}>{shown.text}</a>
    : !display?.link && isSafeHttpUrl(value, display)
      ? <a href={value} rel="noreferrer noopener" target="_blank" title={shown.title}>{shown.text}</a>
    : <span title={shown.title}>{shown.text}</span>;
}

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
    <section
      className="mer-panel"
      data-panel={descriptor.panelId}
      data-panel-shape={descriptor.body.case || "unset"}
      style={themeToStyle(undefined)}
    >
      <h2 className="mer-panel-title">{descriptor.title || descriptor.panelId}</h2>
      {children}
    </section>
  ),
  Table: ({ panel, invoker }) => <TableContent panel={panel} invoker={invoker} />,
  Gallery: ({ panel, invoker }) => <GalleryContent panel={panel} invoker={invoker} className="mer-gallery" emptyClassName="mer-empty" />,
  Prompt: ({ panel }) => (
    <form className="mer-prompt">
      {panel.fields.map((field) => (
        <label key={field.fieldId} className="mer-field">
          <span>{field.label}</span>
        </label>
      ))}
    </form>
  ),
  LlmPrompt: ({ panel }) => <LlmPromptContent key={JSON.stringify(panel)} panel={panel} c={HTML_FORM_CLASSES} />,
  Lro: ({ panel }) => (
    <div className="mer-lro">
      <button type="button">{panel.runButtonLabel || "Run"}</button>
    </div>
  ),
  Form: ({ panel }) => <FormContent panel={panel} c={HTML_FORM_CLASSES} className="mer-form" />,
  DetailHeader: ({ panel, invoker }) => {
    const { subjectId } = useContext(MeridianViewContext);
    const resolveHref = useHrefResolver();
    const { record } = useRecord(panel.populate, panel.idField, subjectId, invoker);
    const now = useDisplayNow();
    const hasRecord = record !== undefined;
    const title = hasRecord
      ? String(resolvePath(record, panel.titleSourcePath) ?? panel.title)
      : panel.title || "Details";
    const subtitle = hasRecord
      ? String(resolvePath(record, panel.subtitleSourcePath) ?? "")
      : panel.subtitleSourcePath;
    const status = hasRecord
      ? String(resolvePath(record, panel.statusSourcePath) ?? "")
      : panel.statusSourcePath;

    return (
      <header className="mer-detail-header">
        <h3>{title}</h3>
        {subtitle && <p className="mer-detail-subtitle">{subtitle}</p>}
        {status && <span className="mer-detail-status" role="status">{status}</span>}
        {panel.descriptorRows.length > 0 && (
          <dl className="mer-detail-rows">
            {panel.descriptorRows.map((row) => (
              <div key={row.sourcePath}>
                <dt>{row.label}</dt>
                <dd>
                  {(() => {
                    const shown = hasRecord
                      ? formatByDisplay(resolvePath(record, row.sourcePath), row.display, now)
                      : { text: row.sourcePath };
                    return renderDisplayedValue(resolvePath(record, row.sourcePath), row.display, shown, resolveHref);
                  })()}
                </dd>
              </div>
            ))}
          </dl>
        )}
      </header>
    );
  },
  RecordCard: ({ panel, invoker }) => {
    const { subjectId } = useContext(MeridianViewContext);
    const resolveHref = useHrefResolver();
    const { record } = useRecord(panel.populate, panel.idField, subjectId, invoker);
    const now = useDisplayNow();
    const hasRecord = record !== undefined;
    return (
      <dl className="mer-record-card" aria-label={panel.itemNoun || "Record details"}>
        {panel.fields.map((field) => (
          <div key={field.fieldId}>
            <dt>{field.label || field.fieldId}</dt>
            <dd>
              {(() => {
                const shown = hasRecord
                  ? formatByDisplay(resolvePath(record, field.fieldId), field.display, now)
                  : { text: field.fieldId };
                return renderDisplayedValue(resolvePath(record, field.fieldId), field.display, shown, resolveHref);
              })()}
            </dd>
          </div>
        ))}
      </dl>
    );
  },
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
  Chart: ({ panel }) => (
    <figure className="mer-chart" data-mark={panel.chart?.mark}>
      {panel.chart?.title && <figcaption className="mer-chart-title">{panel.chart.title}</figcaption>}
      <p className="mer-chart-summary">
        {panel.chart?.y?.fieldName || "value"} by {panel.chart?.x?.fieldName || "category"}
      </p>
    </figure>
  ),
  ResourceCard: ({ panel, invoker }) => <ResourceCardsView panel={panel} invoker={invoker} />,
  Stream: ({ panel }) => (
    <section className="mer-stream" aria-live="polite" data-follow-mode={panel.followMode}>
      <p className="mer-stream-placeholder">
        {panel.placeholder || `Waiting for ${panel.itemNoun || "stream"}...`}
      </p>
    </section>
  ),
  Media: ({ panel }) => {
    const details = panel.durationMs ? ` (${Math.round(panel.durationMs / 1000)}s)` : "";
    if (panel.kind === 3) {
      return (
        <figure className="mer-media mer-media-image">
          <img src={panel.srcUri} alt={panel.alt} />
          {(panel.caption || panel.alt) && <figcaption>{panel.caption || panel.alt}{details}</figcaption>}
        </figure>
      );
    }
    const player = panel.kind === 2 ? (
      <audio controls src={panel.srcUri} aria-label={panel.alt || panel.caption} />
    ) : (
      <video controls src={panel.srcUri} poster={panel.posterUri || undefined} aria-label={panel.alt || panel.caption}>
        {panel.captionsUri && <track kind="captions" src={panel.captionsUri} />}
      </video>
    );
    return (
      <figure className="mer-media">
        {player}
        <figcaption>{panel.caption || panel.alt || panel.srcUri}{details}</figcaption>
        {panel.chapters.length > 0 && <ol className="mer-media-chapters">{panel.chapters.map((chapter, i) => <li key={i}>{chapter.label}</li>)}</ol>}
      </figure>
    );
  },
  Terminal: ({ panel }) => (
    <section className="mer-terminal" aria-label={panel.tool || "Terminal"}>
      <p className="mer-terminal-note">Interactive terminal connection</p>
      <a href={panel.url}>{panel.url}</a>
      {(panel.cols || panel.rows) && <p className="mer-terminal-size">{panel.cols || "auto"} × {panel.rows || "auto"}</p>}
    </section>
  ),
  Steps: ({ panel }) => (
    <section className="mer-steps">
      {panel.intro && <p className="mer-steps-intro">{panel.intro}</p>}
      <ol>
        {panel.steps.map((step, index) => (
          <li key={index} className="mer-step">
            <div className="mer-step-label">
              {step.label}
              {step.actor && <span className="mer-step-actor"> ({step.actor})</span>}
            </div>
            {step.detail && <p className="mer-step-detail">{step.detail}</p>}
            <StepMedia step={step} className="mer-step-media" fallbackClassName="mer-step-detail" />
          </li>
        ))}
      </ol>
      {panel.outro && <p className="mer-steps-outro">{panel.outro}</p>}
    </section>
  ),
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
