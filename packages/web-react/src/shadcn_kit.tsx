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
import { formatByDisplay } from "@savvifi/meridian-schemas/uiview";

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
import { FormFieldRow, SHADCN_FORM_CLASSES } from "./form_fields.js";
import { MeridianViewContext } from "./view_renderer.js";
import { resolvePath, useRecord } from "./pagination.js";

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
  DetailHeader: ({ panel, invoker }) => {
    const { subjectId } = useContext(MeridianViewContext);
    const { record } = useRecord(panel.populate, panel.idField, subjectId, invoker);
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
                  {hasRecord
                    ? formatByDisplay(resolvePath(record, row.sourcePath), row.display).text
                    : row.sourcePath}
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
    const { record } = useRecord(panel.populate, panel.idField, subjectId, invoker);
    const hasRecord = record !== undefined;
    return (
      <dl className="grid gap-2" aria-label={panel.itemNoun || "Record details"}>
        {panel.fields.map((field) => (
          <div key={field.fieldId} className="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)] gap-2">
            <dt className="text-sm text-muted-foreground">{field.label || field.fieldId}</dt>
            <dd className="text-sm">
              {hasRecord
                ? formatByDisplay(resolvePath(record, field.fieldId), field.display).text
                : field.fieldId}
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
  Chart: ({ panel }) => (
    <figure className="rounded-md border p-4" data-mark={panel.chart?.mark}>
      {panel.chart?.title && <figcaption className="text-sm font-semibold">{panel.chart.title}</figcaption>}
      <p className="text-sm text-muted-foreground">
        {panel.chart?.y?.fieldName || "value"} by {panel.chart?.x?.fieldName || "category"}
      </p>
    </figure>
  ),
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
            {!step.detail && step.mediaAlt && <p className="mt-1 text-sm text-muted-foreground">{step.mediaAlt}</p>}
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
  Media: ({ panel }) => {
    const details = panel.durationMs ? ` (${Math.round(panel.durationMs / 1000)}s)` : "";
    if (panel.kind === 3) {
      return <figure className="grid gap-2"><img src={panel.srcUri} alt={panel.alt} /><figcaption className="text-sm text-muted-foreground">{panel.caption || panel.alt}{details}</figcaption></figure>;
    }
    const player = panel.kind === 2
      ? <audio controls src={panel.srcUri} aria-label={panel.alt || panel.caption} />
      : <video controls src={panel.srcUri} poster={panel.posterUri || undefined} aria-label={panel.alt || panel.caption}>{panel.captionsUri && <track kind="captions" src={panel.captionsUri} />}</video>;
    return <figure className="grid gap-2">{player}<figcaption className="text-sm text-muted-foreground">{panel.caption || panel.alt || panel.srcUri}{details}</figcaption>{panel.chapters.length > 0 && <ol className="text-sm">{panel.chapters.map((chapter, i) => <li key={i}>{chapter.label}</li>)}</ol>}</figure>;
  },
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
