import { AffordanceStyle, Emphasis, type Affordance } from "@savvifi/meridian-proto-ts/proto/affordance_pb.js";
import { conversationToneRole } from "./conversation_tone.js";

// Derived in-process presentation only. Serialized action data remains the
// canonical Affordance proto; this projection cannot grant a capability.
export function affordancePresentation(action: Pick<Affordance, "style" | "tone" | "emphasis">) {
  const primary = action.emphasis === undefined ? action.style === AffordanceStyle.PRIMARY : action.emphasis === Emphasis.PRIMARY;
  const tone = conversationToneRole(action.tone);
  const style: { color?: string; borderColor?: string; backgroundColor?: string; fontWeight?: string; borderWidth?: string; borderStyle?: string } = {};
  if (action.emphasis !== undefined) {
    style.fontWeight = primary ? "var(--mer-heading-weight, 600)" : "var(--mer-body-weight, 400)";
    style.borderWidth = primary ? "2px" : "1px";
    style.borderStyle = "solid";
  }
  if (tone !== undefined) {
    const colors: Record<string, string> = {
      neutral: "var(--mer-fg, var(--text, currentColor))",
      info: "var(--mer-info, var(--info, #38bdf8))",
      success: "var(--mer-success, var(--success, #22c55e))",
      warning: "var(--mer-warning, var(--warning, #f59e0b))",
      danger: "var(--mer-danger, var(--danger, #ef4444))",
      accent: "var(--mer-accent, var(--accent, #6366f1))",
    };
    style.color = colors[tone]!;
    style.borderColor = "currentColor";
    style.backgroundColor = primary ? `color-mix(in srgb, ${style.color} 12%, var(--mer-bg, var(--surface, transparent)))` : "transparent";
  }
  return { primary, tone, style };
}
