// shadcnKit — a second reference ComponentKit, dependency-free, emitting the
// shadcn/ui Tailwind class + CSS-variable conventions.
//
// It exists to prove **Swap B** (swap the kit → same PanelRenderer dispatch,
// different look) with a real second kit beyond the minimal htmlKit, and to give
// the `mui-kit` (wrapping a host's internal MUI component library) a richer structural template. Like
// htmlKit it pulls NO component library: a production shadcn-kit (Radix
// primitives) would be its own package, a peer of mui-kit — this is the
// in-core reference that keeps web-react kit-agnostic.

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
import { SHADCN_FORM_CLASSES } from "./form_fields.js";
import { FormContent } from "./form.js";
import { MeridianViewContext } from "./view_renderer.js";
import { useHrefResolver } from "./provider.js";
import { resolvePath, useRecord } from "./pagination.js";
import { useDisplayNow } from "./display_now.js";
import { LlmPromptContent } from "./llm_prompt.js";
import { StepMedia } from "./step_media.js";
import { GalleryContent } from "./gallery.js";
import { TableContent } from "./table.js";
import { ReferenceActionBar } from "./reference_action_bar.js";
import { MediaContent } from "./media.js";
import { ChartContent } from "./chart.js";

// The six content shapes delegate to the shared, field-complete content_shapes
// module (same code as htmlKit) with shadcn's Tailwind class table — so the two
// reference kits are guaranteed field-parity (icon / description / language /
// secret-reveal / placeholder). Different classes, identical dispatch: Swap B.
const c = classesFor("shadcn");

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
  ActionBar: (props) => <ReferenceActionBar {...props} variant="shadcn" />,
  themeToStyle,
  Chrome: ({ descriptor, children }) => (
    <section
      className="rounded-lg border bg-card text-card-foreground shadow-sm"
      data-panel={descriptor.panelId}
      data-panel-shape={descriptor.body.case || "unset"}
    >
      <header className="border-b px-4 py-3">
        <h3 className="text-sm font-semibold leading-none tracking-tight">
          {descriptor.title || descriptor.panelId}
        </h3>
      </header>
      <div className="p-4">{children}</div>
    </section>
  ),
  Table: ({ panel, invoker }) => (
    <div className="relative w-full overflow-auto">
      <TableContent panel={panel} invoker={invoker} styled />
    </div>
  ),
  Gallery: ({ panel, invoker }) => <GalleryContent panel={panel} invoker={invoker} className="grid grid-cols-2 gap-3 sm:grid-cols-3" emptyClassName="col-span-full text-sm text-muted-foreground" />,
  Prompt: ({ panel }) => (
    <form className="grid gap-4">
      {panel.fields.map((field) => (
        <div key={field.fieldId} className="grid gap-2">
          <label className="text-sm font-medium leading-none">{field.label}</label>
        </div>
      ))}
    </form>
  ),
  LlmPrompt: ({ panel }) => <LlmPromptContent key={JSON.stringify(panel)} panel={panel} c={SHADCN_FORM_CLASSES} />,
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
  Form: ({ panel }) => <FormContent panel={panel} c={SHADCN_FORM_CLASSES} className="grid gap-4" />,
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
      <header className="grid gap-2" data-title-path={panel.titleSourcePath || undefined}>
        <h2 className="text-xl font-semibold">{title}</h2>
        {subtitle && <p className="text-sm text-muted-foreground">{subtitle}</p>}
        {status && <span className="inline-flex w-fit rounded-full border px-2 py-0.5 text-xs">{status}</span>}
        {panel.descriptorRows.length > 0 && (
          <dl className="grid gap-2" aria-label="Record summary">
            {panel.descriptorRows.map((row) => (
              <div key={row.sourcePath} className="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)] gap-2">
                <dt className="text-sm text-muted-foreground">{row.label}</dt>
                <dd className="text-sm">
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
      <dl className="grid gap-2" aria-label={panel.itemNoun || "Record details"}>
        {panel.fields.map((field) => (
          <div key={field.fieldId} className="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)] gap-2">
            <dt className="text-sm text-muted-foreground">{field.label || field.fieldId}</dt>
            <dd className="text-sm">
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
  Chart: ({ panel, invoker }) => <ChartContent panel={panel} invoker={invoker} classes={{
    figure: "rounded-md border p-4",
    title: "text-sm font-semibold",
    summary: "text-sm text-muted-foreground",
    status: "text-sm text-muted-foreground",
    table: "w-full text-sm",
  }} />,
  ResourceCard: ({ panel, invoker }) => <ResourceCardsView panel={panel} invoker={invoker} />,
  Steps: ({ panel }) => (
    <section className="grid gap-3" aria-label="Steps">
      {panel.intro && <p className="text-sm text-muted-foreground">{panel.intro}</p>}
      <ol className="grid gap-3">
        {panel.steps.map((step, index) => (
          <li key={`${index}-${step.label}`} className="rounded-md border p-3">
            <div className="flex items-baseline gap-2">
              <span className="text-sm font-semibold">{index + 1}.</span>
              <span className="text-sm font-medium">{step.label}</span>
              {step.actor && <span className="text-xs text-muted-foreground">{step.actor}</span>}
            </div>
            {step.detail && <p className="mt-1 text-sm text-muted-foreground">{step.detail}</p>}
            <StepMedia step={step} className="mt-3 rounded-md border" fallbackClassName="mt-1 text-sm text-muted-foreground" />
            {step.action && <AffordanceControl c={c} affordance={step.action} />}
          </li>
        ))}
      </ol>
      {panel.outro && <p className="text-sm text-muted-foreground">{panel.outro}</p>}
    </section>
  ),
  Stream: ({ panel }) => (
    <section className="mer-stream" aria-live="polite" data-follow-mode={panel.followMode}>
      <p className="text-sm text-muted-foreground">
        {panel.placeholder || `Waiting for ${panel.itemNoun || "stream"}...`}
      </p>
    </section>
  ),
  Media: ({ panel }) => <MediaContent panel={panel} classes={{
    figure: "grid gap-2",
    caption: "text-sm text-muted-foreground",
    chapters: "text-sm",
    chapterButton: "underline",
  }} />,
  Terminal: ({ panel }) => (
    <section className="grid gap-1 rounded-md border p-3 text-sm" aria-label={panel.tool || "Terminal"}>
      <span className="font-medium">Interactive terminal connection</span>
      <a href={panel.url} className="underline">{panel.url}</a>
      {(panel.cols || panel.rows) && <span className="text-muted-foreground">{panel.cols || "auto"} × {panel.rows || "auto"}</span>}
    </section>
  ),
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
