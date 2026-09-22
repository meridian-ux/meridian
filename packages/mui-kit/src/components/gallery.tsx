// MeridianGallery — the MUI realization of a GalleryPanel that carries images.
//
// Fetches the row list (the panel's `populate`, resolved to `rows_field`) and, when
// the CardSpec has an `image_field`, renders an image LIGHTBOX: a large stage image
// + caption + status chip, prev/play/next controls with keyboard (←/→ step, space
// toggles play) and a thumbnail filmstrip. Without an `image_field` it degrades to a
// responsive card grid (the classic "grid of cards" GalleryPanel shape).
//
// Image URLs are host-resolved via MeridianAssetContext (`resolveAssetSrc`) so a
// consumer can prefix a mount base / swap a CDN host; absent ⇒ rendered verbatim.

import { useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { Box, Button, Chip, CircularProgress, Stack, Typography } from "@mui/material";

import { MeridianViewContext, useMeridian, useRecord, resolvePath } from "@savvifi/meridian-web-react";
import type { GalleryPanel } from "@savvifi/meridian-proto-ts/proto/gallery_pb.js";
import { safeAssetSrc, safeNavigationHref, type RpcInvoker } from "@savvifi/meridian-schemas/uiview";

import { MeridianAssetContext } from "../asset_context.js";
import { formatByDisplay } from "../display_format.js";
import { useDisplayNow } from "../use_display_now.js";

/** status → chip color (kept in sync with the table/detail-header vocabulary). */
function statusChipColor(value: string): "default" | "success" | "warning" | "error" {
  const v = value.toLowerCase();
  if (/(pass|active|complete|approv|success|paid|done|resolved|enabled|live|ready)/.test(v)) return "success";
  if (/(pending|draft|open|in.?progress|review|waiting|processing|scheduled|running)/.test(v)) return "warning";
  if (/(error|fail|reject|cancel|declin|expired|disabled|inactive|blocked)/.test(v)) return "error";
  return "default";
}

const asText = (v: unknown): string => (v === null || v === undefined ? "" : typeof v === "object" ? JSON.stringify(v) : String(v));

interface Item {
  src: string;
  icon: string;
  caption: string;
  captionTitle?: string;
  subtitle: string;
  subtitleTitle?: string;
  status: string;
  statusTitle?: string;
  rawStatus: string;
  href: string;
}

export function MeridianGallery({ panel, invoker }: { panel: GalleryPanel; invoker: RpcInvoker }): ReactNode {
  const { subjectId } = useContext(MeridianViewContext);
  const resolveAsset = useContext(MeridianAssetContext);
  const resolveIcon = useMeridian().renderIcon;
  // GalleryPanel has no id_field; fetch the populate record (the invoker injects the
  // route resource when subjectId is empty) and resolve rows_field within it.
  const { record, loading } = useRecord(panel.populate, "", subjectId, invoker);
  const card = panel.card;
  const now = useDisplayNow();

  const items = useMemo<Item[]>(() => {
    const rows = (resolvePath(record, panel.rowsField) as unknown[]) ?? [];
    return rows
      .filter(Boolean)
      .map((row) => {
        const slot = (path: string | undefined, display: Parameters<typeof formatByDisplay>[1]) => {
          if (!path) return { text: "" };
          const value = resolvePath(row, path);
          return display ? formatByDisplay(value, display, now) : { text: asText(value) };
        };
        const caption = slot(card?.titleField, card?.titleDisplay);
        // Legacy MUI galleries omitted subtitles. Opt in through the new
        // declaration so existing descriptors retain their exact shape.
        const subtitle = slot(card?.subtitleDisplay ? card.subtitleField : undefined, card?.subtitleDisplay);
        const status = slot(card?.statusField, card?.statusDisplay);
        return {
          src: card?.imageField ? safeAssetSrc(resolvePath(row, card.imageField)) ?? "" : "",
          icon: card?.iconField ? asText(resolvePath(row, card.iconField)) : "",
          caption: caption.text,
          captionTitle: caption.title,
          subtitle: subtitle.text,
          subtitleTitle: subtitle.title,
          status: status.text,
          statusTitle: status.title,
          rawStatus: card?.statusField ? asText(resolvePath(row, card.statusField)) : "",
          href: card?.hrefField ? asText(resolvePath(row, card.hrefField)) : "",
        };
      });
  }, [record, panel.rowsField, card, now]);

  const withAsset = (s: string): string => (resolveAsset && s ? resolveAsset(s) : s);
  const hasImages = items.some((it) => it.src);

  const [i, setI] = useState(0);
  const [playing, setPlaying] = useState(false);
  const timer = useRef<number | null>(null);
  // The hydration-safe formatting instant must not reset lightbox selection.
  useEffect(() => setI(0), [record, panel.rowsField, card]);

  const clearTimer = () => {
    if (timer.current !== null) {
      clearInterval(timer.current);
      timer.current = null;
    }
  };
  const stop = () => {
    setPlaying(false);
    clearTimer();
  };
  const go = (n: number) => {
    if (items.length) setI(((n % items.length) + items.length) % items.length);
  };
  useEffect(() => {
    if (!playing || items.length === 0) return;
    timer.current = window.setInterval(() => {
      setI((cur) => {
        if (cur >= items.length - 1) {
          setPlaying(false);
          return cur;
        }
        return cur + 1;
      });
    }, 1400);
    return clearTimer;
  }, [playing, items.length]);
  useEffect(() => {
    if (!hasImages) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") {
        stop();
        go(i + 1);
      } else if (e.key === "ArrowLeft") {
        stop();
        go(i - 1);
      } else if (e.key === " ") {
        e.preventDefault();
        setPlaying((p) => !p);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [i, items.length, hasImages]);

  if (loading && !record)
    return (
      <Box sx={{ display: "flex", justifyContent: "center", p: 4 }}>
        <CircularProgress />
      </Box>
    );
  if (items.length === 0)
    return (
      <Typography color="text.secondary" variant="body2">
        {panel.placeholder || "No items."}
      </Typography>
    );

  // No images → the classic responsive card grid (title + status badge, optional link).
  if (!hasImages) {
    return (
      <Box sx={{ display: "grid", gap: 2, gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))" }}>
        {items.map((it, idx) => {
          const inner = (
            <Box sx={{ border: 1, borderColor: "divider", borderRadius: 2, p: 2, height: "100%" }}>
              <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 0.5 }}>
                {it.icon && (
                  <Box component="span" className="mer-gallery-card-icon" data-gallery-icon data-icon={it.icon} aria-hidden="true" sx={{ display: "inline-flex" }}>
                    {resolveIcon?.(it.icon)}
                  </Box>
                )}
                <Typography title={it.captionTitle} sx={{ fontWeight: 600, flex: 1 }} noWrap>
                  {it.caption}
                </Typography>
                {it.status && <Chip title={it.statusTitle} label={it.status} size="small" variant="outlined" color={statusChipColor(it.rawStatus)} />}
              </Stack>
              {it.subtitle && <Typography title={it.subtitleTitle} color="text.secondary" variant="body2">{it.subtitle}</Typography>}
            </Box>
          );
          const href = safeNavigationHref(withAsset(it.href));
          return href ? (
            <a key={idx} href={href} style={{ textDecoration: "none", color: "inherit" }}>
              {inner}
            </a>
          ) : (
            <Box key={idx}>{inner}</Box>
          );
        })}
      </Box>
    );
  }

  // Image lightbox: stage + caption/status + controls + filmstrip.
  const it = items[i];
  return (
    <Box>
      <Box sx={{ border: 1, borderColor: "divider", borderRadius: 2, overflow: "hidden", bgcolor: "background.paper" }}>
        {it.src && <Box component="img" src={withAsset(it.src)} alt={it.caption} sx={{ display: "block", width: "100%", height: "auto" }} />}
        <Stack direction="row" alignItems="center" spacing={1.5} sx={{ p: 1.5, borderTop: 1, borderColor: "divider" }}>
          {it.icon && (
            <Box component="span" className="mer-gallery-card-icon" data-gallery-icon data-icon={it.icon} aria-hidden="true" sx={{ display: "inline-flex" }}>
              {resolveIcon?.(it.icon)}
            </Box>
          )}
          {it.status && <Chip title={it.statusTitle} label={it.status} size="small" variant="outlined" color={statusChipColor(it.rawStatus)} />}
          <Typography title={it.captionTitle} sx={{ flex: 1, fontWeight: 600 }} noWrap>
            {it.caption}
          </Typography>
        </Stack>
        {it.subtitle && <Typography title={it.subtitleTitle} color="text.secondary" variant="body2" sx={{ px: 1.5, pb: 1.5 }}>{it.subtitle}</Typography>}
      </Box>

      <Stack direction="row" alignItems="center" spacing={1} sx={{ my: 1.5, flexWrap: "wrap" }}>
        <Button size="small" variant="outlined" onClick={() => { stop(); go(i - 1); }}>
          ‹ Prev
        </Button>
        <Button size="small" variant="outlined" onClick={() => setPlaying((p) => !p)}>
          {playing ? "⏸ Pause" : "▶ Play"}
        </Button>
        <Button size="small" variant="outlined" onClick={() => { stop(); go(i + 1); }}>
          Next ›
        </Button>
        <Typography color="text.secondary" sx={{ ml: "auto", fontVariantNumeric: "tabular-nums" }}>
          {i + 1} / {items.length}
        </Typography>
      </Stack>

      <Stack direction="row" spacing={1} sx={{ overflowX: "auto", py: 1 }}>
        {items.map((t, idx) => t.src ? (
          <Box
            key={idx}
            component="img"
            src={withAsset(t.src)}
            alt=""
            onClick={() => { stop(); go(idx); }}
            sx={{
              height: 64,
              borderRadius: 1,
              cursor: "pointer",
              border: 2,
              borderColor: idx === i ? "primary.main" : "transparent",
              opacity: idx === i ? 1 : 0.55,
              flex: "0 0 auto",
            }}
          />
        ) : null)}
      </Stack>
    </Box>
  );
}
