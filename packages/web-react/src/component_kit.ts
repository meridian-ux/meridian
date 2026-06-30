// ComponentKit — the swap point *within* the React renderer.
//
// The React adapter core (provider + PanelRenderer + reactWebRenderer) is
// kit-agnostic: it dispatches a meridian.ui.v1 PanelDescriptor to the kit's
// per-shape components and binds the theme through the kit. Swapping the kit
// (e.g. MUI -> shadcn) changes the look and the concrete components, not the
// dispatch logic. The savvi `mui-kit` (wrapping @aion/ui) and a future
// `shadcn-kit` are both implementations of this one interface.

import type { ComponentType, CSSProperties, ReactNode } from "react";

import type { GalleryPanel } from "@savvifi/meridian-proto-ts/proto/gallery_pb.js";
import type { LlmPromptPanel } from "@savvifi/meridian-proto-ts/proto/llm_prompt_pb.js";
import type { LroPanel } from "@savvifi/meridian-proto-ts/proto/lro_pb.js";
import type { PanelDescriptor } from "@savvifi/meridian-proto-ts/proto/panel_pb.js";
import type { PromptPanel } from "@savvifi/meridian-proto-ts/proto/prompt_pb.js";
import type { TablePanel } from "@savvifi/meridian-proto-ts/proto/table_pb.js";
import type { Theme } from "@savvifi/meridian-proto-ts/proto/theme_pb.js";
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
  /** Optional richer shapes; PanelRenderer falls back when a kit omits them. */
  Gallery?: ComponentType<GalleryPanelProps>;
  LlmPrompt?: ComponentType<LlmPromptPanelProps>;
  /** Rendered for unknown / unset / unsupported shapes. */
  Fallback: ComponentType<{ descriptor: PanelDescriptor }>;
}
