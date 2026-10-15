import { useRef, useState, type ReactNode } from "react";

import { MediaKind, type MediaPanel } from "@savvifi/meridian-proto-ts/proto/media_pb.js";
import { resolveMediaKind, safeAssetSrc } from "@savvifi/meridian-schemas/uiview";

export interface MediaClasses {
  figure: string;
  image?: string;
  caption?: string;
  chapters?: string;
  chapter?: string;
  chapterButton?: string;
}

function formatDuration(milliseconds: number): string {
  const seconds = Math.floor(milliseconds / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/**
 * Reference-kit realization of MediaPanel's playable rung. Chapter entries are
 * real seek controls, while their visible timestamps preserve the same useful
 * contents when scripting or playback is unavailable.
 */
export function MediaContent({ panel, classes }: { panel: MediaPanel; classes: MediaClasses }): ReactNode {
  // Error state belongs to one asset identity, not the next descriptor/source.
  return <MediaSurface key={JSON.stringify([panel.kind, panel.srcUri, panel.posterUri, panel.captionsUri])} panel={panel} classes={classes} />;
}

function MediaSurface({ panel, classes }: { panel: MediaPanel; classes: MediaClasses }): ReactNode {
  const playerRef = useRef<HTMLMediaElement>(null);
  const [sourceFailed, setSourceFailed] = useState(false);
  const [posterFailed, setPosterFailed] = useState(false);
  const [seekError, setSeekError] = useState("");
  const details = panel.durationMs ? ` (${Math.round(panel.durationMs / 1000)}s)` : "";
  const source = safeAssetSrc(panel.srcUri);
  const poster = safeAssetSrc(panel.posterUri);
  const captions = safeAssetSrc(panel.captionsUri);
  const kind = resolveMediaKind(panel.kind, panel.srcUri);
  const primary = !!source && !sourceFailed && kind !== MediaKind.UNSPECIFIED;
  const still = !primary && kind !== MediaKind.IMAGE && !!poster && !posterFailed;
  const playable = primary && kind !== MediaKind.IMAGE;

  const seek = (startMs: number): void => {
    try { if (playerRef.current) playerRef.current.currentTime = startMs / 1000; }
    catch { setSeekError("Seeking is unavailable."); }
  };
  const setPlayer = (player: HTMLMediaElement | null): void => {
    playerRef.current = player;
  };
  const onPlayerError = (event: { target: EventTarget; currentTarget: EventTarget }) => {
    if (event.target === event.currentTarget) setSourceFailed(true);
  };
  const player = kind === MediaKind.AUDIO ? (
    <audio ref={setPlayer} controls src={source} aria-label={panel.alt || panel.caption} onError={onPlayerError} />
  ) : (
    <video ref={setPlayer} controls src={source} poster={poster} aria-label={panel.alt || panel.caption} onError={onPlayerError}>
      {captions && <track kind="captions" src={captions} />}
    </video>
  );

  return (
    <figure className={`${classes.figure}${primary && kind === MediaKind.IMAGE && classes.image ? ` ${classes.image}` : ""}`}
      data-media-kind={!primary ? still ? "poster" : "none" : undefined}>
      {playable ? player : primary || still ? <img src={primary ? source : poster} alt={panel.alt || panel.caption || "Media"}
        onError={() => primary ? setSourceFailed(true) : setPosterFailed(true)} /> : null}
      {!primary && !still && panel.alt && panel.caption && panel.alt !== panel.caption && <p>{panel.alt}</p>}
      {(panel.caption || panel.alt || !primary || kind !== MediaKind.IMAGE) && <figcaption className={classes.caption}>{panel.caption || panel.alt || (primary ? panel.srcUri : "No media available.")}{details}</figcaption>}
      {!primary && (source ? <a href={source}>Open media source</a> : panel.srcUri && <code>{panel.srcUri}</code>)}
      {seekError && <p role="status">{seekError}</p>}
      {panel.chapters.length > 0 && (
        <ol className={classes.chapters}>
          {panel.chapters.map((chapter, index) => {
            const timestamp = formatDuration(chapter.startMs);
            return (
              <li className={classes.chapter} key={`${index}-${chapter.startMs}`}>
                <button
                  type="button"
                  className={classes.chapterButton}
                  data-start-ms={chapter.startMs}
                  aria-label={`Seek to ${chapter.label} at ${timestamp}`}
                  disabled={!playable}
                  onClick={() => seek(chapter.startMs)}
                >
                  <time dateTime={`PT${chapter.startMs / 1000}S`}>{timestamp}</time>
                  {" "}{chapter.label}
                </button>
              </li>
            );
          })}
        </ol>
      )}
    </figure>
  );
}
