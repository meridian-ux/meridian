// ComponentKit — the swap point *within* the React renderer.
//
// The React adapter core (provider + PanelRenderer + reactWebRenderer) is
// kit-agnostic: it dispatches a meridian.ui.v1 PanelDescriptor to the kit's
// per-shape components and binds the theme through the kit. Swapping the kit
// (e.g. MUI -> shadcn) changes the look and the concrete components, not the
// dispatch logic. The savvi `mui-kit` (wrapping @aion/ui) and a future
// `shadcn-kit` are both implementations of this one interface.

import type { ComponentType, CSSProperties, ReactNode } from "react";

import type { ActionPanel } from "@savvifi/meridian-proto-ts/proto/affordance_pb.js";
import type { CatalogPanel } from "@savvifi/meridian-proto-ts/proto/catalog_pb.js";
import type { ChoicePanel } from "@savvifi/meridian-proto-ts/proto/choice_pb.js";
import type { ConnectFlowPanel } from "@savvifi/meridian-proto-ts/proto/connect_flow_pb.js";
import type { CopyValuePanel } from "@savvifi/meridian-proto-ts/proto/copy_value_pb.js";
import type { GalleryPanel } from "@savvifi/meridian-proto-ts/proto/gallery_pb.js";
import type { GrammarPanel } from "@savvifi/meridian-proto-ts/proto/grammar_pb.js";
import type { LlmPromptPanel } from "@savvifi/meridian-proto-ts/proto/llm_prompt_pb.js";
import type { LroPanel } from "@savvifi/meridian-proto-ts/proto/lro_pb.js";
import type {
  DetailHeaderPanel,
  FormPanel,
  PanelDescriptor,
  RecordCardPanel,
} from "@savvifi/meridian-proto-ts/proto/panel_pb.js";
import type { PromptPanel } from "@savvifi/meridian-proto-ts/proto/prompt_pb.js";
import type { SnippetPanel } from "@savvifi/meridian-proto-ts/proto/snippet_pb.js";
import type { StatPanel } from "@savvifi/meridian-proto-ts/proto/stat_pb.js";
import type { TablePanel } from "@savvifi/meridian-proto-ts/proto/table_pb.js";
import type { Theme } from "@savvifi/meridian-proto-ts/proto/theme_pb.js";
import type { Action } from "@savvifi/meridian-proto-ts/proto/view_pb.js";
import type { RpcInvoker } from "@savvifi/meridian-schemas/uiview";

/** Props every shape component receives: its panel, the parent descriptor, transport. */
export interface ShapeProps<P> {
  panel: P;
  descriptor: PanelDescriptor;
  invoker: RpcInvoker;
}

export type TablePanelProps = ShapeProps<TablePanel>;
export type PromptPanelProps = ShapeProps<PromptPanel>;
export type LroPanelProps = ShapeProps<LroPanel>;
export type GalleryPanelProps = ShapeProps<GalleryPanel>;
export type LlmPromptPanelProps = ShapeProps<LlmPromptPanel>;
export type FormPanelProps = ShapeProps<FormPanel>;
// Detail-view shapes: a record header + a read-only key/value card.
export type DetailHeaderPanelProps = ShapeProps<DetailHeaderPanel>;
export type RecordCardPanelProps = ShapeProps<RecordCardPanel>;
// Content shapes (static, brand-neutral) — see meridian.ui.v1 choice/snippet/
// affordance/connect_flow/copy_value/catalog protos.
export type ChoicePanelProps = ShapeProps<ChoicePanel>;
export type SnippetPanelProps = ShapeProps<SnippetPanel>;
export type ActionPanelProps = ShapeProps<ActionPanel>;
export type ConnectFlowPanelProps = ShapeProps<ConnectFlowPanel>;
export type CopyValuePanelProps = ShapeProps<CopyValuePanel>;
export type CatalogPanelProps = ShapeProps<CatalogPanel>;
// Specialized panel (web-specific rich render; degrades per the ladder).
export type GrammarPanelProps = ShapeProps<GrammarPanel>;
// Full-parity KPI tile.
export type StatPanelProps = ShapeProps<StatPanel>;

/** Props for a kit's action bar: the actions to render + transport to fire them. */
export interface ActionBarProps {
  actions: Action[];
  invoker: RpcInvoker;
}

/** A set of components + a theme binding that paints meridian panels. */
export interface ComponentKit {
  /** Stable id, e.g. "mui" / "shadcn" / "html". Used in the renderer id. */
  readonly id: string;
  /**
   * Bind a meridian.theme.v1.Theme to this kit's style primitive (MUI theme,
   * CSS custom properties, Tailwind config, …). Returned style is applied to the
   * panel container. Optional — a kit may bind the theme its own way.
   */
  themeToStyle?(theme: Theme | undefined): CSSProperties;
  /** Optional wrapper around every panel (title bar, surface, padding). */
  Chrome?: ComponentType<{ descriptor: PanelDescriptor; children: ReactNode }>;
  Table: ComponentType<TablePanelProps>;
  Prompt: ComponentType<PromptPanelProps>;
  Lro: ComponentType<LroPanelProps>;
  /** Entity "detail section" / CRUD form (FormPanel: READONLY | EDIT). */
  Form: ComponentType<FormPanelProps>;
  /**
   * Detail-view header — a record's title + optional subtitle/status + descriptor
   * rows, fetched via the panel's `populate`. PanelRenderer falls back when omitted.
   */
  DetailHeader?: ComponentType<DetailHeaderPanelProps>;
  /**
   * Read-only key/value record card (the detail "section"). PanelRenderer falls
   * back when a kit omits it.
   */
  RecordCard?: ComponentType<RecordCardPanelProps>;
  /** Optional richer shapes; PanelRenderer falls back when a kit omits them. */
  Gallery?: ComponentType<GalleryPanelProps>;
  LlmPrompt?: ComponentType<LlmPromptPanelProps>;
  /**
   * Optional content shapes (choice / snippet / action / connect-flow /
   * copy-value / catalog). Static, brand-neutral surfaces; PanelRenderer falls
   * back when a kit omits them.
   */
  Choice?: ComponentType<ChoicePanelProps>;
  Snippet?: ComponentType<SnippetPanelProps>;
  Action?: ComponentType<ActionPanelProps>;
  ConnectFlow?: ComponentType<ConnectFlowPanelProps>;
  CopyValue?: ComponentType<CopyValuePanelProps>;
  Catalog?: ComponentType<CatalogPanelProps>;
  /**
   * GrammarPanel (markdown / mermaid / plantuml / graphviz / vega). Specialized:
   * the rich render is host-wired via renderGrammar; the kit degrades to native
   * markdown / alt / source. PanelRenderer falls back when a kit omits it.
   */
  Grammar?: ComponentType<GrammarPanelProps>;
  /** KPI tile — a labeled number with a COMPUTED delta/trend + sparkline. */
  Stat?: ComponentType<StatPanelProps>;
  /** Rendered for unknown / unset / unsupported shapes. */
  Fallback: ComponentType<{ descriptor: PanelDescriptor }>;
  /**
   * Renders a view/slot's actions (ViewDescriptor.actions / Slot.actions).
   * Optional — ViewRenderer falls back to plain buttons when a kit omits it.
   */
  ActionBar?: ComponentType<ActionBarProps>;
}
