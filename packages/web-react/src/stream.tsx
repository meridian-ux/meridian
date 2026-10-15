// Shared static rung of StreamPanel's degradation ladder. Snapshot frames use
// the canonical proto envelope, just like the native core; a host can supply
// updated snapshots without replacing its ComponentKit.
import type { ReactNode } from "react";
import type { StreamPanelProps } from "./component_kit.js";
import { useStreamSnapshots } from "./provider.js";

const DEFAULT_MAX_LINES = 1_000;
const DEFAULT_MAX_BYTES = 64 * 1024 * 1024;
const decoder = new TextDecoder("utf-8", { fatal: true });

export function StreamContent({ panel, descriptor }: Pick<StreamPanelProps, "panel"> & Partial<Pick<StreamPanelProps, "descriptor">>): ReactNode {
  const streamSnapshots = useStreamSnapshots();
  const frames = streamSnapshots && descriptor && Object.hasOwn(streamSnapshots, descriptor.panelId)
    ? streamSnapshots[descriptor.panelId] : [];
  const maxLines = panel.maxLines || DEFAULT_MAX_LINES;
  const maxBytes = Math.min(panel.maxBytes || DEFAULT_MAX_BYTES, DEFAULT_MAX_BYTES);
  const lines: string[] = [];
  let oldest = 0;
  let bytes = 0;
  let limited = false;
  for (const frame of frames) {
    bytes += frame.dataJson.byteLength;
    if (bytes > maxBytes) { limited = true; break; }
    try {
      let value: unknown = JSON.parse(decoder.decode(frame.dataJson));
      if (panel.lineField) {
        for (const key of panel.lineField.split(".")) {
          value = value !== null && typeof value === "object" && Object.hasOwn(value, key)
            ? (value as Record<string, unknown>)[key] : undefined;
        }
      }
      if (typeof value !== "string") continue;
      if (lines.length < maxLines) lines.push(value);
      else {
        lines[oldest] = value;
        oldest = (oldest + 1) % maxLines;
      }
    } catch {
      // A malformed event cannot blank the valid transcript around it.
    }
  }
  return (
    <>
      {lines.length ? (
        <pre className="mer-stream-transcript" role="log" aria-label={descriptor?.title || panel.itemNoun || "Stream transcript"} tabIndex={0}
          style={{ maxHeight: "24rem", overflow: "auto", whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
          {[...lines.slice(oldest), ...lines.slice(0, oldest)].join("\n")}
        </pre>
      ) : <p className="mer-stream-placeholder">{panel.placeholder || `Waiting for ${panel.itemNoun || "stream"}...`}</p>}
      {limited ? <p role="status">Payload limit exceeded; transcript stopped.</p> : null}
    </>
  );
}
