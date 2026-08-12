// Shared renderers for meridian's six brand-neutral content shapes, used by BOTH
// reference kits (htmlKit + shadcnKit). Centralizing them here guarantees the
// two kits stay field-complete and in lock-step (they differ only in the class
// table below) — the divergence that let `option.description` / `icon` slip out
// of one kit but not the other cannot recur.
//
// Every descriptor field is realized:
//   • ChoiceOption / ConnectTarget / CatalogItem / Affordance `icon`  → host glyph
//     via useIcon(key) + a `data-icon={key}` attribute (never dropped).
//   • ChoiceOption.description, Affordance.description                → shown inline.
//   • Snippet.language                                                → caption + data-lang.
//   • CopyValue.secret                                                → masked + a
//     reveal affordance (host JS toggles; copy always yields plaintext).
//   • ConnectFlowPanel.placeholder / CatalogPanel.placeholder          → empty state.
//
// SSR-safe: no client state here (the demo/host wires copy + tab + reveal via the
// data-* attributes). mui-kit is a separate, stateful MUI implementation.

import type { ReactNode } from "react";

import type { Affordance } from "@savvifi/meridian-proto-ts/proto/affordance_pb.js";
import { AffordanceStyle } from "@savvifi/meridian-proto-ts/proto/affordance_pb.js";
import type { CatalogPanel, CatalogItem } from "@savvifi/meridian-proto-ts/proto/catalog_pb.js";
import type { ChoicePanel, ChoiceOption } from "@savvifi/meridian-proto-ts/proto/choice_pb.js";
import type { ConnectFlowPanel, ConnectTarget } from "@savvifi/meridian-proto-ts/proto/connect_flow_pb.js";
import type { CopyValue } from "@savvifi/meridian-proto-ts/proto/copy_value_pb.js";
import type { GrammarPanel } from "@savvifi/meridian-proto-ts/proto/grammar_pb.js";
import type { Snippet } from "@savvifi/meridian-proto-ts/proto/snippet_pb.js";
import type { StatPanel } from "@savvifi/meridian-proto-ts/proto/stat_pb.js";
import { computeStat, statSparklinePoints, trendArrow } from "@savvifi/meridian-schemas/uiview";

import { useGrammarResolver, useIcon } from "./provider.js";

/** Which reference kit's class vocabulary to paint with. */
export type KitStyle = "html" | "shadcn";

export interface ContentClasses {
  choice: string;
  choicePrompt: string;
  choiceOptions: string;
  choiceOption: string;
  choiceOptionLabel: string;
  choiceOptionDesc: string;
  snippet: string;
  snippetCaption: string;
  snippetCopy: string;
  snippetPre: string;
  affordanceItem: string;
  affordance: string;
  affordancePrimary: string;
  affordanceDesc: string;
  icon: string;
  copyValue: string;
  copyValueLabel: string;
  copyValueBtn: string;
  copyValueValue: string;
  copyValuePlain: string;
  reveal: string;
  copyValueHelp: string;
  catalog: string;
  catalogItem: string;
  catalogHead: string;
  catalogName: string;
  catalogState: string;
  catalogDesc: string;
  catalogTag: string;
  connect: string;
  connectPrompt: string;
  connectTabs: string;
  connectTab: string;
  connectBodies: string;
  connectBody: string;
  connectName: string;
  connectNote: string;
  connectActions: string;
  empty: string;
  grammar: string;
  grammarTitle: string;
  grammarSource: string;
  grammarMount: string;
  grammarMarkdown: string;
  grammarAlt: string;
  grammarFallback: string;
  grammarFallbackLabel: string;
  grammarCaption: string;
  stat: string;
  statLabel: string;
  statValueRow: string;
  statValue: string;
  statDelta: string;
  statSpark: string;
  statCaption: string;
}

const HTML: ContentClasses = {
  choice: "mer-choice",
  choicePrompt: "mer-choice-prompt",
  choiceOptions: "mer-choice-options",
  choiceOption: "mer-choice-option",
  choiceOptionLabel: "mer-choice-option-label",
  choiceOptionDesc: "mer-choice-option-desc",
  snippet: "mer-snippet",
  snippetCaption: "mer-snippet-caption",
  snippetCopy: "mer-copy mer-snippet-copy",
  snippetPre: "mer-snippet-pre",
  affordanceItem: "mer-affordance-item",
  affordance: "mer-affordance",
  affordancePrimary: "mer-affordance-primary",
  affordanceDesc: "mer-affordance-desc",
  icon: "mer-icon",
  copyValue: "mer-copyvalue",
  copyValueLabel: "mer-copyvalue-label",
  copyValueBtn: "mer-copy mer-copyvalue-btn",
  copyValueValue: "mer-copyvalue-value",
  copyValuePlain: "mer-copyvalue-plain",
  reveal: "mer-reveal",
  copyValueHelp: "mer-copyvalue-help",
  catalog: "mer-catalog",
  catalogItem: "mer-catalog-item",
  catalogHead: "mer-catalog-head",
  catalogName: "mer-catalog-name",
  catalogState: "mer-catalog-state",
  catalogDesc: "mer-catalog-desc",
  catalogTag: "mer-catalog-tag",
  connect: "mer-connect",
  connectPrompt: "mer-connect-prompt",
  connectTabs: "mer-connect-tabs",
  connectTab: "mer-connect-tab",
  connectBodies: "mer-connect-bodies",
  connectBody: "mer-connect-body",
  connectName: "mer-connect-name",
  connectNote: "mer-connect-note",
  connectActions: "mer-connect-actions",
  empty: "mer-empty",
  grammar: "mer-grammar",
  grammarTitle: "mer-grammar-title",
  grammarSource: "mer-grammar-source",
  grammarMount: "mer-grammar-mount",
  grammarMarkdown: "mer-grammar-markdown",
  grammarAlt: "mer-grammar-alt",
  grammarFallback: "mer-grammar-fallback",
  grammarFallbackLabel: "mer-grammar-fallback-label",
  grammarCaption: "mer-grammar-caption",
  stat: "mer-stat",
  statLabel: "mer-stat-label",
  statValueRow: "mer-stat-value-row",
  statValue: "mer-stat-value",
  statDelta: "mer-stat-delta",
  statSpark: "mer-stat-spark",
  statCaption: "mer-stat-caption",
};

const SHADCN: ContentClasses = {
  choice: "grid gap-2",
  choicePrompt: "text-sm text-muted-foreground",
  choiceOptions: "inline-flex flex-wrap gap-1 rounded-md border p-1",
  choiceOption:
    "rounded px-3 py-1 text-left text-sm aria-selected:bg-primary aria-selected:text-primary-foreground",
  choiceOptionLabel: "font-medium",
  choiceOptionDesc: "block text-xs text-muted-foreground",
  snippet: "relative rounded-md border bg-muted/50",
  snippetCaption: "border-b px-3 py-1.5 text-xs text-muted-foreground",
  snippetCopy: "mer-copy absolute right-2 top-2 rounded border px-2 py-0.5 text-xs",
  snippetPre: "overflow-auto p-3 text-sm",
  affordanceItem: "inline-flex flex-col gap-0.5",
  affordance:
    "inline-flex items-center gap-1.5 rounded-md border px-4 h-9 text-sm font-medium",
  affordancePrimary: "bg-primary text-primary-foreground border-transparent",
  affordanceDesc: "text-xs text-muted-foreground",
  icon: "mer-icon inline-flex",
  copyValue: "flex items-center gap-2 text-sm",
  copyValueLabel: "text-muted-foreground",
  copyValueBtn: "mer-copy inline-flex items-center gap-1 rounded-full border px-3 py-1 font-mono text-xs",
  copyValueValue: "",
  copyValuePlain: "font-mono text-xs",
  reveal: "mer-reveal rounded border px-2 py-0.5 text-xs",
  copyValueHelp: "text-xs text-muted-foreground",
  catalog: "grid gap-3 sm:grid-cols-2",
  catalogItem: "rounded-lg border bg-card p-4",
  catalogHead: "flex items-center justify-between gap-2",
  catalogName: "text-sm font-semibold",
  catalogState: "rounded-full border px-2 py-0.5 text-xs text-muted-foreground",
  catalogDesc: "mt-1 text-sm text-muted-foreground",
  catalogTag: "mt-2 inline-block rounded border px-2 py-0.5 text-xs",
  connect: "grid gap-4",
  connectPrompt: "text-sm text-muted-foreground",
  connectTabs: "inline-flex flex-wrap gap-1 rounded-md border p-1",
  connectTab:
    "rounded px-3 py-1 text-sm aria-selected:bg-primary aria-selected:text-primary-foreground",
  connectBodies: "",
  connectBody: "grid gap-3",
  connectName: "text-sm font-semibold",
  connectNote: "text-sm text-muted-foreground",
  connectActions: "flex flex-wrap gap-2",
  empty: "text-sm text-muted-foreground",
  grammar: "grid gap-2",
  grammarTitle: "text-sm font-semibold",
  grammarSource: "",
  grammarMount: "rounded-md border p-3",
  grammarMarkdown: "prose prose-sm max-w-none",
  grammarAlt: "text-sm text-muted-foreground",
  grammarFallback: "rounded-md border bg-muted/50",
  grammarFallbackLabel: "border-b px-3 py-1.5 text-xs text-muted-foreground",
  grammarCaption: "text-xs text-muted-foreground",
  stat: "rounded-lg border bg-card p-4 inline-block",
  statLabel: "text-xs text-muted-foreground uppercase tracking-wide",
  statValueRow: "flex items-baseline gap-2 mt-1",
  statValue: "text-2xl font-semibold",
  statDelta:
    "text-sm font-medium data-[semantics=good]:text-emerald-600 data-[semantics=bad]:text-red-600 data-[semantics=neutral]:text-muted-foreground",
  statSpark: "mt-2 block text-primary",
  statCaption: "text-xs text-muted-foreground mt-1",
};

const table: Record<KitStyle, ContentClasses> = { html: HTML, shadcn: SHADCN };

// ── icon leaf (a component so useIcon obeys the rules of hooks per-instance) ──
function Glyph({ c, name }: { c: ContentClasses; name: string }): ReactNode {
  const glyph = useIcon(name);
  if (!glyph && !name) return null;
  return (
    <span className={c.icon} data-icon={name || undefined}>
      {glyph}
    </span>
  );
}

// ── Affordance (realizes icon + description; used standalone AND nested) ──────
export function AffordanceControl({ c, affordance }: { c: ContentClasses; affordance: Affordance }): ReactNode {
  const primary = affordance.style === AffordanceStyle.PRIMARY;
  const cls = `${c.affordance}${primary ? ` ${c.affordancePrimary}` : ""}`;
  const inner = (
    <>
      <Glyph c={c} name={affordance.icon} />
      <span>{affordance.label}</span>
    </>
  );
  const control =
    affordance.invoke.case === "uri" ? (
      <a className={cls} href={affordance.invoke.value} data-icon={affordance.icon || undefined} title={affordance.description || undefined}>
        {inner}
      </a>
    ) : (
      <button
        type="button"
        className={`${cls} mer-copy`}
        data-copy={affordance.invoke.case === "command" ? affordance.invoke.value : ""}
        data-icon={affordance.icon || undefined}
        title={affordance.description || undefined}
      >
        {inner}
      </button>
    );
  return (
    <span className={c.affordanceItem}>
      {control}
      {affordance.description && <span className={c.affordanceDesc}>{affordance.description}</span>}
    </span>
  );
}

// ── Snippet (realizes language) ──────────────────────────────────────────────
export function SnippetContent({ c, snippet }: { c: ContentClasses; snippet: Snippet }): ReactNode {
  const caption = snippet.path || snippet.label;
  return (
    <figure className={c.snippet} data-lang={snippet.language || undefined}>
      {(caption || snippet.language) && (
        <figcaption className={c.snippetCaption}>
          {caption}
          {snippet.language && <span> ({snippet.language})</span>}
        </figcaption>
      )}
      <button type="button" className={c.snippetCopy} data-copy={snippet.content}>
        Copy
      </button>
      <pre className={c.snippetPre}>
        <code>{snippet.content}</code>
      </pre>
    </figure>
  );
}

// ── CopyValue (realizes secret mask + reveal) ────────────────────────────────
export function CopyValueContent({ c, value }: { c: ContentClasses; value: CopyValue }): ReactNode {
  return (
    <div className={c.copyValue} data-secret={value.secret || undefined}>
      {value.label && <span className={c.copyValueLabel}>{value.label}</span>}
      <button type="button" className={c.copyValueBtn} data-copy={value.value}>
        <code className={c.copyValueValue}>{value.secret ? "••••••••" : value.value}</code>
      </button>
      {value.secret && (
        <>
          <button type="button" className={c.reveal} data-reveal aria-pressed="false">
            Reveal
          </button>
          {/* plaintext, host JS unhides on reveal; copy already yields it */}
          <code className={c.copyValuePlain} data-plain hidden>
            {value.value}
          </code>
        </>
      )}
      {value.help && <span className={c.copyValueHelp}>{value.help}</span>}
    </div>
  );
}

// ── Choice (realizes option.description + option.icon) ───────────────────────
function ChoiceOptionButton({
  c,
  option,
  selected,
}: {
  c: ContentClasses;
  option: ChoiceOption;
  selected: boolean;
}): ReactNode {
  return (
    <button
      type="button"
      role="tab"
      className={c.choiceOption}
      data-option={option.id}
      data-icon={option.icon || undefined}
      aria-selected={selected}
    >
      <Glyph c={c} name={option.icon} />
      <span className={c.choiceOptionLabel}>{option.label}</span>
      {option.description && <span className={c.choiceOptionDesc}>{option.description}</span>}
    </button>
  );
}

export function ChoiceContent({ c, panel }: { c: ContentClasses; panel: ChoicePanel }): ReactNode {
  const defId = panel.defaultOptionId || panel.options[0]?.id;
  return (
    <div className={c.choice} data-style={panel.style} role="tablist">
      {panel.prompt && <p className={c.choicePrompt}>{panel.prompt}</p>}
      <div className={c.choiceOptions}>
        {panel.options.map((opt) => (
          <ChoiceOptionButton key={opt.id} c={c} option={opt} selected={opt.id === defId} />
        ))}
      </div>
    </div>
  );
}

// ── Catalog (realizes placeholder + item.icon + item.action) ─────────────────
function CatalogItemCard({ c, item }: { c: ContentClasses; item: CatalogItem }): ReactNode {
  return (
    <article className={c.catalogItem} data-icon={item.icon || undefined}>
      <header className={c.catalogHead}>
        <span className={c.catalogName}>
          <Glyph c={c} name={item.icon} />
          {item.name}
        </span>
        {item.state && <span className={c.catalogState}>{item.state}</span>}
      </header>
      {item.description && <p className={c.catalogDesc}>{item.description}</p>}
      {item.tag && <span className={c.catalogTag}>{item.tag}</span>}
      {item.action && <AffordanceControl c={c} affordance={item.action} />}
    </article>
  );
}

export function CatalogContent({ c, panel }: { c: ContentClasses; panel: CatalogPanel }): ReactNode {
  return (
    <div className={c.catalog} data-style={panel.style}>
      {panel.items.length === 0 && <p className={c.empty}>{panel.placeholder || "(empty)"}</p>}
      {panel.items.map((item) => (
        <CatalogItemCard key={item.id} c={c} item={item} />
      ))}
    </div>
  );
}

// ── ConnectFlow (realizes placeholder + target.icon; actions/configs field-complete) ──
function ConnectTab({ c, target, selected }: { c: ContentClasses; target: ConnectTarget; selected: boolean }): ReactNode {
  return (
    <button
      type="button"
      role="tab"
      className={c.connectTab}
      data-target={target.id}
      data-icon={target.icon || undefined}
      aria-selected={selected}
    >
      <Glyph c={c} name={target.icon} />
      {target.label}
    </button>
  );
}

export function ConnectFlowContent({ c, panel }: { c: ContentClasses; panel: ConnectFlowPanel }): ReactNode {
  if (panel.targets.length === 0) {
    return (
      <div className={c.connect}>
        {panel.prompt && <p className={c.connectPrompt}>{panel.prompt}</p>}
        {panel.endpoint && <CopyValueContent c={c} value={panel.endpoint} />}
        <p className={c.empty}>{panel.placeholder || "(no targets)"}</p>
      </div>
    );
  }
  const defId = panel.defaultTargetId || panel.targets[0]?.id;
  return (
    <div className={c.connect}>
      {panel.prompt && <p className={c.connectPrompt}>{panel.prompt}</p>}
      {panel.endpoint && <CopyValueContent c={c} value={panel.endpoint} />}
      <div className={c.connectTabs} role="tablist">
        {panel.targets.map((t) => (
          <ConnectTab key={t.id} c={c} target={t} selected={t.id === defId} />
        ))}
      </div>
      <div className={c.connectBodies}>
        {panel.targets.map((t) => (
          <section key={t.id} className={c.connectBody} data-target={t.id} hidden={t.id !== defId}>
            {t.name && <h3 className={c.connectName}>{t.name}</h3>}
            {t.description && <p className={c.connectNote}>{t.description}</p>}
            {t.actions.length > 0 && (
              <div className={c.connectActions}>
                {t.actions.map((a, i) => (
                  <AffordanceControl key={a.id || i} c={c} affordance={a} />
                ))}
              </div>
            )}
            {t.configs.map((s, i) => (
              <SnippetContent key={i} c={c} snippet={s} />
            ))}
          </section>
        ))}
      </div>
    </div>
  );
}

// ── GrammarPanel (content negotiation + degradation ladder) ──────────────────
// GrammarLanguage: 1=markdown 2=mermaid 3=plantuml 4=graphviz 5=vega-lite 6=vega.
export function grammarLanguageName(language: number): string {
  return ["", "markdown", "mermaid", "plantuml", "graphviz", "vega-lite", "vega"][language] ?? "";
}

export function GrammarContent({ c, panel }: { c: ContentClasses; panel: GrammarPanel }): ReactNode {
  const lang = grammarLanguageName(panel.language);
  const resolver = useGrammarResolver();
  // 1) the surface's transcoder, if it can display this language.
  const rendered = resolver?.({ language: lang, source: panel.source, data: panel.data });
  let mount: ReactNode;
  if (rendered != null && rendered !== false) {
    mount = rendered;
  } else if (lang === "markdown") {
    // 2a) markdown is text — native md → React (no library).
    mount = <div className={c.grammarMarkdown}>{renderMarkdown(panel.source)}</div>;
  } else if (panel.alt) {
    // 2b) author text fallback.
    mount = <p className={c.grammarAlt}>{panel.alt}</p>;
  } else {
    // 2c) the source verbatim, labeled with its language.
    mount = (
      <figure className={c.grammarFallback}>
        <figcaption className={c.grammarFallbackLabel}>{lang || "source"}</figcaption>
        <pre>
          <code>{panel.source}</code>
        </pre>
      </figure>
    );
  }
  return (
    <div className={c.grammar} data-grammar-language={lang}>
      {panel.title && <div className={c.grammarTitle}>{panel.title}</div>}
      {/* SSR-safe: the source stays available for host hydration (never executes). */}
      <script type="text/plain" className={c.grammarSource}>
        {panel.source}
      </script>
      <div className={c.grammarMount}>{mount}</div>
      {panel.caption && <div className={c.grammarCaption}>{panel.caption}</div>}
    </div>
  );
}

// Minimal, dependency-free markdown → React for the degradation ladder: ATX
// headings, fenced code, unordered lists, inline **bold** / `code`. A legible
// native fallback; a host wanting fidelity wires renderGrammar with a real lib.
// Exported so other kits (mui) reuse one markdown implementation.
export function renderMarkdown(source: string): ReactNode {
  const out: ReactNode[] = [];
  const lines = source.split("\n");
  let list: ReactNode[] | null = null;
  let key = 0;
  const flush = () => {
    if (list) {
      out.push(<ul key={key++}>{list}</ul>);
      list = null;
    }
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith("```")) {
      flush();
      const buf: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) buf.push(lines[i++]);
      out.push(
        <pre key={key++}>
          <code>{buf.join("\n")}</code>
        </pre>,
      );
      continue;
    }
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      flush();
      const level = Math.min(h[1].length + 2, 6);
      const Tag = `h${level}` as "h3";
      out.push(<Tag key={key++}>{inlineMarkdown(h[2])}</Tag>);
    } else if (/^\s*[-*]\s+/.test(line)) {
      if (!list) list = [];
      list.push(<li key={list.length}>{inlineMarkdown(line.replace(/^\s*[-*]\s+/, ""))}</li>);
    } else if (line.trim() === "") {
      flush();
    } else {
      flush();
      out.push(<p key={key++}>{inlineMarkdown(line)}</p>);
    }
  }
  flush();
  return out;
}

// Inline **bold** + `code` → React nodes (text via JSX children = auto-escaped).
function inlineMarkdown(text: string): ReactNode {
  const parts: ReactNode[] = [];
  const re = /(\*\*([^*]+)\*\*|`([^`]+)`)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let key = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    if (m[2] !== undefined) parts.push(<strong key={key++}>{m[2]}</strong>);
    else parts.push(<code key={key++}>{m[3]}</code>);
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

// ── StatPanel (KPI tile) — full-parity content shape ─────────────────────────
// Delta / trend / formatting come from the SHARED computeStat
// (@savvifi/meridian-schemas/uiview), identical to the mui / web-components /
// tui renderers — the delta/trend is COMPUTED, never author-marked. Semantic
// color only when higher_is_better is set (via data-semantics).

// A tiny inline-SVG sparkline — drawn by hand (no chart library): a polyline over
// a 100×24 viewBox, y-inverted so higher = up.
function Sparkline({ series, className }: { series: number[]; className: string }): ReactNode {
  const points = statSparklinePoints(series);
  if (!points) return null;
  return (
    <svg className={className} viewBox="0 0 100 24" width="100" height="24" preserveAspectRatio="none" aria-hidden="true">
      <polyline points={points} fill="none" stroke="currentColor" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

export function StatContent({ c, panel }: { c: ContentClasses; panel: StatPanel }): ReactNode {
  const s = computeStat(panel);
  const arrow = trendArrow(s.trend);
  return (
    <div className={c.stat} data-trend={s.trend} data-semantics={s.semantics}>
      <div className={c.statLabel}>{panel.label}</div>
      <div className={c.statValueRow}>
        <span className={c.statValue}>{s.formattedValue}</span>
        {s.formattedDelta && (
          <span className={c.statDelta} data-semantics={s.semantics} data-trend={s.trend}>
            {arrow ? `${arrow} ` : ""}
            {s.formattedDelta}
          </span>
        )}
      </div>
      {s.series.length >= 2 && <Sparkline series={s.series} className={c.statSpark} />}
      {panel.caption && <div className={c.statCaption}>{panel.caption}</div>}
    </div>
  );
}

/** Resolve the class table for a kit style. */
export function classesFor(style: KitStyle): ContentClasses {
  return table[style];
}
