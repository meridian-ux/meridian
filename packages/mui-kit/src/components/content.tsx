// MUI renderers for meridian's six brand-neutral *content* shapes — Choice,
// Snippet, ActionPanel (Affordance), ConnectFlowPanel, CopyValuePanel,
// CatalogPanel. The premium-kit (MUI) peers of the web-react reference kits'
// content components and the TUI's content.rs, so the same descriptors render as
// MUI Tabs / Chips / Cards / code blocks here.
//
// Field-complete (matches the parity contract the reference kits enforce):
//   • icon (ChoiceOption/Affordance/ConnectTarget/CatalogItem) → host glyph via
//     useIcon(key) (the MeridianProvider.renderIcon seam);
//   • ChoiceOption.description + Affordance.description shown inline;
//   • Snippet.language in the caption; CopyValue.secret masked + reveal toggle
//     (copy still yields plaintext); ConnectFlowPanel.placeholder empty state.
// Copy uses navigator.clipboard (guarded); selection + reveal are real React
// state (this is a client kit, jsdom-tested). Look comes from the MUI theme.

import { useState } from "react";
import type { ReactElement, ReactNode } from "react";

import {
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  IconButton,
  Link,
  Paper,
  Stack,
  Tab,
  Tabs,
  Typography,
} from "@mui/material";

import {
  grammarLanguageName,
  renderMarkdown,
  useGrammarResolver,
  useIcon,
  useMeridian,
} from "@savvifi/meridian-web-react";
import {
  computeStat,
  statSparklinePoints,
  trendArrow,
} from "@savvifi/meridian-schemas/uiview";
import type { Affordance } from "@savvifi/meridian-proto-ts/proto/affordance_pb.js";
import { AffordanceStyle } from "@savvifi/meridian-proto-ts/proto/affordance_pb.js";
import type { ActionPanel } from "@savvifi/meridian-proto-ts/proto/affordance_pb.js";
import type { CatalogPanel } from "@savvifi/meridian-proto-ts/proto/catalog_pb.js";
import type { ChoicePanel } from "@savvifi/meridian-proto-ts/proto/choice_pb.js";
import type { ConnectFlowPanel } from "@savvifi/meridian-proto-ts/proto/connect_flow_pb.js";
import type { CopyValue } from "@savvifi/meridian-proto-ts/proto/copy_value_pb.js";
import type { GrammarPanel } from "@savvifi/meridian-proto-ts/proto/grammar_pb.js";
import type { Snippet } from "@savvifi/meridian-proto-ts/proto/snippet_pb.js";
import type { StatPanel } from "@savvifi/meridian-proto-ts/proto/stat_pb.js";

function copyText(text: string): void {
  try {
    void navigator?.clipboard?.writeText(text);
  } catch {
    /* clipboard unavailable (SSR / permissions) — no-op */
  }
}

/** Host glyph for an icon key (or null); wrapped so `data-icon` always survives. */
function Glyph({ name }: { name: string }): ReactNode {
  const glyph = useIcon(name);
  if (!name) return null;
  return (
    <Box component="span" className="mer-icon" data-icon={name} sx={{ display: "inline-flex", mr: glyph ? 0.5 : 0 }}>
      {glyph}
    </Box>
  );
}

function AffordanceButton({ affordance }: { affordance: Affordance }): ReactNode {
  const primary = affordance.style === AffordanceStyle.PRIMARY;
  const glyph = useIcon(affordance.icon);
  const common = {
    variant: (primary ? "contained" : "outlined") as "contained" | "outlined",
    size: "small" as const,
    startIcon: glyph ?? undefined,
    title: affordance.description || undefined,
    "data-icon": affordance.icon || undefined,
  };
  const button =
    affordance.invoke.case === "uri" ? (
      <Button component={Link} href={affordance.invoke.value} {...common}>
        {affordance.label}
      </Button>
    ) : (
      <Button onClick={() => copyText(affordance.invoke.case === "command" ? affordance.invoke.value : "")} {...common}>
        {affordance.label}
      </Button>
    );
  // Render the description inline (not just as a tooltip) so it is never dropped.
  if (!affordance.description) return button;
  return (
    <Stack spacing={0.25} alignItems="flex-start">
      {button}
      <Typography variant="caption" color="text.secondary">
        {affordance.description}
      </Typography>
    </Stack>
  );
}

export function SnippetView({ snippet }: { snippet: Snippet }): ReactNode {
  const caption = snippet.path || snippet.label;
  return (
    <Paper variant="outlined" sx={{ position: "relative", overflow: "hidden" }} data-lang={snippet.language || undefined}>
      {(caption || snippet.language) && (
        <Typography
          variant="caption"
          sx={{ display: "block", px: 1.5, py: 0.5, borderBottom: 1, borderColor: "divider", color: "text.secondary" }}
        >
          {caption}
          {snippet.language ? ` (${snippet.language})` : ""}
        </Typography>
      )}
      <IconButton
        size="small"
        aria-label="copy snippet"
        onClick={() => copyText(snippet.content)}
        sx={{ position: "absolute", top: 4, right: 4, fontSize: 12 }}
      >
        <Box component="span" sx={{ fontSize: 11 }}>Copy</Box>
      </IconButton>
      <Box component="pre" sx={{ m: 0, p: 1.5, overflowX: "auto", fontFamily: "monospace", fontSize: 13 }}>
        <code>{snippet.content}</code>
      </Box>
    </Paper>
  );
}

export function CopyValueView({ value }: { value: CopyValue }): ReactNode {
  const [revealed, setRevealed] = useState(false);
  const shown = value.secret && !revealed ? "••••••••" : value.value;
  return (
    <Stack direction="row" spacing={1} alignItems="center" data-secret={value.secret || undefined}>
      {value.label && (
        <Typography variant="body2" color="text.secondary">
          {value.label}
        </Typography>
      )}
      <Chip
        label={shown}
        variant="outlined"
        onClick={() => copyText(value.value)} // copy always yields plaintext
        sx={{ fontFamily: "monospace" }}
      />
      {value.secret && (
        <Button
          size="small"
          variant="text"
          className="mer-reveal"
          aria-pressed={revealed}
          onClick={() => setRevealed((r) => !r)}
        >
          {revealed ? "Hide" : "Reveal"}
        </Button>
      )}
      {value.help && (
        <Typography variant="caption" color="text.secondary">
          {value.help}
        </Typography>
      )}
    </Stack>
  );
}

/** A Tab label carrying the option/target label + optional per-option blurb. */
function TabLabel({ label, description }: { label: string; description: string }): ReactNode {
  if (!description) return <>{label}</>;
  return (
    <Stack spacing={0}>
      <span>{label}</span>
      <Typography variant="caption" color="text.secondary" sx={{ textTransform: "none" }}>
        {description}
      </Typography>
    </Stack>
  );
}

export function ChoiceView({ panel }: { panel: ChoicePanel }): ReactNode {
  const initial = panel.defaultOptionId || panel.options[0]?.id || "";
  const [selected, setSelected] = useState(initial);
  // MUI Tabs require direct <Tab> children, so per-option icons can't be a child
  // component — resolve the glyph via the resolver read ONCE here (not a hook in
  // the loop, keeping the rules of hooks intact).
  const resolveIcon = useMeridian().renderIcon;
  return (
    <Box>
      {panel.prompt && (
        <Typography variant="body2" color="text.secondary" gutterBottom>
          {panel.prompt}
        </Typography>
      )}
      <Tabs value={selected} onChange={(_e, v) => setSelected(v as string)} variant="scrollable" scrollButtons="auto">
        {panel.options.map((opt) => (
          <Tab
            key={opt.id}
            value={opt.id}
            data-icon={opt.icon || undefined}
            icon={((opt.icon && resolveIcon?.(opt.icon)) || undefined) as ReactElement | undefined}
            iconPosition="start"
            label={<TabLabel label={opt.label} description={opt.description} />}
          />
        ))}
      </Tabs>
    </Box>
  );
}

export function ActionView({ panel }: { panel: ActionPanel }): ReactNode {
  return (
    <Stack spacing={1}>
      {panel.description && (
        <Typography variant="body2" color="text.secondary">
          {panel.description}
        </Typography>
      )}
      {panel.action && <AffordanceButton affordance={panel.action} />}
    </Stack>
  );
}

export function CatalogView({ panel }: { panel: CatalogPanel }): ReactNode {
  if (panel.items.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary">
        {panel.placeholder || "(empty)"}
      </Typography>
    );
  }
  return (
    <Box sx={{ display: "grid", gap: 2, gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" } }}>
      {panel.items.map((item) => (
        <Card key={item.id} variant="outlined" data-icon={item.icon || undefined}>
          <CardContent>
            <Stack direction="row" justifyContent="space-between" alignItems="center">
              <Stack direction="row" spacing={0.5} alignItems="center">
                <Glyph name={item.icon} />
                <Typography variant="subtitle2">{item.name}</Typography>
              </Stack>
              {item.state && <Chip size="small" label={item.state} variant="outlined" />}
            </Stack>
            {item.description && (
              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                {item.description}
              </Typography>
            )}
            {item.tag && <Chip size="small" label={item.tag} sx={{ mt: 1 }} variant="outlined" />}
            {item.action && (
              <Box sx={{ mt: 1.5 }}>
                <AffordanceButton affordance={item.action} />
              </Box>
            )}
          </CardContent>
        </Card>
      ))}
    </Box>
  );
}

export function ConnectFlowView({ panel }: { panel: ConnectFlowPanel }): ReactNode {
  const initial = panel.defaultTargetId || panel.targets[0]?.id || "";
  const [selected, setSelected] = useState(initial);
  const resolveIcon = useMeridian().renderIcon;
  const target = panel.targets.find((t) => t.id === selected) ?? panel.targets[0];
  return (
    <Stack spacing={2}>
      {panel.prompt && (
        <Typography variant="body2" color="text.secondary">
          {panel.prompt}
        </Typography>
      )}
      {panel.endpoint && <CopyValueView value={panel.endpoint} />}
      {panel.targets.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          {panel.placeholder || "(no targets)"}
        </Typography>
      ) : (
        <>
          <Tabs value={selected} onChange={(_e, v) => setSelected(v as string)} variant="scrollable" scrollButtons="auto">
            {panel.targets.map((t) => (
              <Tab
                key={t.id}
                value={t.id}
                data-icon={t.icon || undefined}
                icon={((t.icon && resolveIcon?.(t.icon)) || undefined) as ReactElement | undefined}
                iconPosition="start"
                label={t.label}
              />
            ))}
          </Tabs>
          {target && (
            <Stack spacing={1.5}>
              {target.name && <Typography variant="subtitle1">{target.name}</Typography>}
              {target.description && (
                <Typography variant="body2" color="text.secondary">
                  {target.description}
                </Typography>
              )}
              {target.actions.length > 0 && (
                <Stack direction="row" spacing={1} flexWrap="wrap">
                  {target.actions.map((a, i) => (
                    <AffordanceButton key={a.id || i} affordance={a} />
                  ))}
                </Stack>
              )}
              {target.configs.map((s, i) => (
                <SnippetView key={i} snippet={s} />
              ))}
            </Stack>
          )}
        </>
      )}
    </Stack>
  );
}

// GrammarPanel (markdown / mermaid / plantuml / graphviz / vega) — content
// negotiation + the degradation ladder, MUI-flavored. Tries the host's
// renderGrammar (the surface's capability set); on absent/null degrades: native
// markdown (shared renderMarkdown) → alt → source in a Paper. The wired path
// mounts the host's live node (interactive). No grammar library here.
export function GrammarView({ panel }: { panel: GrammarPanel }): ReactNode {
  const lang = grammarLanguageName(panel.language);
  const resolver = useGrammarResolver();
  const rendered = resolver?.({ language: lang, source: panel.source, data: panel.data });
  let mount: ReactNode;
  if (rendered != null && rendered !== false) {
    mount = rendered;
  } else if (lang === "markdown") {
    mount = <Box className="mer-grammar-markdown">{renderMarkdown(panel.source)}</Box>;
  } else if (panel.alt) {
    mount = (
      <Typography variant="body2" color="text.secondary" className="mer-grammar-alt">
        {panel.alt}
      </Typography>
    );
  } else {
    mount = (
      <Paper variant="outlined" className="mer-grammar-fallback">
        <Typography
          variant="caption"
          sx={{ display: "block", px: 1.5, py: 0.5, borderBottom: 1, borderColor: "divider", color: "text.secondary" }}
        >
          {lang || "source"}
        </Typography>
        <Box component="pre" sx={{ m: 0, p: 1.5, overflowX: "auto", fontFamily: "monospace", fontSize: 13 }}>
          <code>{panel.source}</code>
        </Box>
      </Paper>
    );
  }
  return (
    <Box className="mer-grammar" data-grammar-language={lang}>
      {panel.title && <Typography variant="subtitle1">{panel.title}</Typography>}
      {/* source preserved for host hydration */}
      <script type="text/plain" className="mer-grammar-source">
        {panel.source}
      </script>
      <Box className="mer-grammar-mount" sx={{ mt: panel.title ? 1 : 0 }}>
        {mount}
      </Box>
      {panel.caption && (
        <Typography variant="caption" color="text.secondary">
          {panel.caption}
        </Typography>
      )}
    </Box>
  );
}

// StatPanel (KPI tile) — MUI. Delta/trend/formatting from the SHARED computeStat
// (identical to the other renderers; COMPUTED, never author-marked). Semantic
// good/bad color ONLY when higher_is_better is set. Hand-drawn SVG sparkline via
// the shared statSparklinePoints (no chart library).
export function StatView({ panel }: { panel: StatPanel }): ReactNode {
  const s = computeStat(panel);
  const arrow = trendArrow(s.trend);
  const deltaColor =
    s.semantics === "good" ? "success.main" : s.semantics === "bad" ? "error.main" : "text.secondary";
  const points = statSparklinePoints(s.series);
  return (
    <Card variant="outlined" sx={{ display: "inline-block" }} data-trend={s.trend} data-semantics={s.semantics}>
      <CardContent>
        <Typography variant="overline" color="text.secondary" className="mer-stat-label">
          {panel.label}
        </Typography>
        <Stack direction="row" alignItems="baseline" spacing={1}>
          <Typography variant="h5" className="mer-stat-value">
            {s.formattedValue}
          </Typography>
          {s.formattedDelta && (
            <Typography
              variant="body2"
              className="mer-stat-delta"
              data-semantics={s.semantics}
              data-trend={s.trend}
              sx={{ color: deltaColor, fontWeight: 500 }}
            >
              {arrow ? `${arrow} ` : ""}
              {s.formattedDelta}
            </Typography>
          )}
        </Stack>
        {points && (
          <Box
            component="svg"
            className="mer-stat-spark"
            viewBox="0 0 100 24"
            width="100"
            height="24"
            preserveAspectRatio="none"
            aria-hidden="true"
            sx={{ mt: 1, color: "primary.main", display: "block" }}
          >
            <polyline points={points} fill="none" stroke="currentColor" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
          </Box>
        )}
        {panel.caption && (
          <Typography variant="caption" color="text.secondary" className="mer-stat-caption">
            {panel.caption}
          </Typography>
        )}
      </CardContent>
    </Card>
  );
}
