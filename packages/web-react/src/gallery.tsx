// Shared populated GalleryPanel realization for the dependency-free reference kits.
// The kits differ only in their class vocabulary; fetching, slot semantics, and
// safe fallback behavior stay in one renderer so parity cannot drift.

import { useContext, type ReactNode } from "react";

import type { GalleryPanel } from "@savvifi/meridian-proto-ts/proto/gallery_pb.js";
import type { RpcInvoker } from "@savvifi/meridian-schemas/uiview";
import { formatByDisplay } from "@savvifi/meridian-schemas/uiview";

import { useDisplayNow } from "./display_now.js";
import { resolvePath, useRecord } from "./pagination.js";
import { useMeridian } from "./provider.js";
import { MeridianViewContext } from "./view_renderer.js";

type Row = Record<string, unknown>;

const asText = (value: unknown): string => (
  value === null || value === undefined
    ? ""
    : typeof value === "object"
      ? JSON.stringify(value)
      : String(value)
);

function rowsFromRecord(record: Row | undefined, rowsField: string): Row[] {
  const value = rowsField ? resolvePath(record, rowsField) : record;
  return Array.isArray(value)
    ? value.filter((row): row is Row => !!row && typeof row === "object" && !Array.isArray(row))
    : [];
}

function safeHref(value: unknown): string | undefined {
  const href = asText(value).trim();
  if (!href || /[\u0000-\u001f\u007f]/.test(href)) return undefined;
  // href_field is authored navigation, but descriptors can come from untrusted
  // producers. Keep relative links and HTTP(S); never emit executable schemes.
  try {
    const url = new URL(href, "https://meridian.invalid/");
    if (["http:", "https:", "mailto:"].includes(url.protocol)) return href;
  } catch { /* Invalid destinations degrade to a label. */ }
  return undefined;
}

function safeAssetSrc(value: unknown): string | undefined {
  const src = asText(value).trim();
  if (!src || /[\u0000-\u001f\u007f]/.test(src)) return undefined;
  try {
    const url = new URL(src, "https://meridian.invalid/");
    if (["http:", "https:"].includes(url.protocol)) return src;
  } catch { /* Invalid sources degrade to the card's text. */ }
  if (/^data:image\/(?:gif|jpeg|jpg|png|webp);base64,/i.test(src)) return src;
  return undefined;
}

export function GalleryContent({
  panel,
  invoker,
  className,
  emptyClassName,
}: {
  panel: GalleryPanel;
  invoker: RpcInvoker;
  className: string;
  emptyClassName: string;
}): ReactNode {
  const { subjectId } = useContext(MeridianViewContext);
  const { renderIcon } = useMeridian();
  const { record, loading, error } = useRecord(panel.populate, "", subjectId, invoker);
  const now = useDisplayNow();
  const card = panel.card;

  if (loading && !record) {
    return <div className={className} role="list" data-rows-field={panel.rowsField} data-image-field={card?.imageField}><p className={emptyClassName}>{panel.placeholder || "(load to populate)"}</p></div>;
  }
  if (error) {
    return <div className={className} role="list"><p className={emptyClassName}>Failed to load gallery.</p></div>;
  }
  if (!card) {
    return (
      <div className={className} role="list">
        <p className={emptyClassName}>{panel.populate ? "Invalid gallery descriptor." : panel.placeholder || "No items."}</p>
      </div>
    );
  }

  const rows = rowsFromRecord(record, panel.rowsField);
  if (rows.length === 0) {
    return <div className={className} role="list" data-rows-field={panel.rowsField} data-image-field={card.imageField}><p className={emptyClassName}>{panel.placeholder || (record ? "No items." : "(load to populate)")}</p></div>;
  }

  const slot = (row: Row, path: string, display: Parameters<typeof formatByDisplay>[1]) => {
    const value = path ? resolvePath(row, path) : undefined;
    return path && display ? formatByDisplay(value, display, now) : { text: asText(value) };
  };

  return (
    <div className={className} role="list">
      {rows.map((row, index) => {
        const title = slot(row, card.titleField, card.titleDisplay);
        const subtitleValue = card.subtitleField ? resolvePath(row, card.subtitleField) : undefined;
        const subtitle = card.subtitleField ? slot(row, card.subtitleField, card.subtitleDisplay) : undefined;
        const statusValue = card.statusField ? resolvePath(row, card.statusField) : undefined;
        const status = card.statusField ? slot(row, card.statusField, card.statusDisplay) : undefined;
        const image = card.imageField ? safeAssetSrc(resolvePath(row, card.imageField)) : undefined;
        const icon = card.iconField ? asText(resolvePath(row, card.iconField)) : "";
        const href = card.hrefField ? safeHref(resolvePath(row, card.hrefField)) : undefined;
        const action = card.actionLabelField ? asText(resolvePath(row, card.actionLabelField)) : "";
        const hasSubtitle = subtitle !== undefined && (subtitleValue !== null && subtitleValue !== undefined && subtitleValue !== "" || card.subtitleDisplay);
        const hasStatus = status !== undefined && (statusValue !== null && statusValue !== undefined && statusValue !== "" || card.statusDisplay);

        return (
          <article className="mer-gallery-card" role="listitem" data-gallery-card key={index}>
            {image && <img className="mer-gallery-card-image" data-gallery-image src={image} alt={title.text} loading="lazy" style={{ maxWidth: "100%", height: "auto" }} />}
            {icon && <span className="mer-gallery-card-icon" data-gallery-icon data-icon={icon} aria-hidden="true">{renderIcon?.(icon) ?? icon}</span>}
            <h3 className="mer-gallery-card-title" data-gallery-title title={title.title}>{title.text}</h3>
            {hasSubtitle && <p className="mer-gallery-card-subtitle" data-gallery-subtitle title={subtitle?.title}>{subtitle?.text}</p>}
            {hasStatus && <span className="mer-gallery-card-status" data-gallery-status role="status" title={status?.title}>{status?.text}</span>}
            {href
              ? <a className="mer-gallery-card-link" data-gallery-link href={href}>{action || "Open"}</a>
              : action && <span className="mer-gallery-card-action" data-gallery-action>{action}</span>}
          </article>
        );
      })}
    </div>
  );
}
