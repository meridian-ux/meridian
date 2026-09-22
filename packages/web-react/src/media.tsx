import { useRef, type ReactNode } from "react";

import { MediaKind, type MediaPanel } from "@savvifi/meridian-proto-ts/proto/media_pb.js";
import { safeAssetSrc } from "@savvifi/meridian-schemas/uiview";

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
  const playerRef = useRef<HTMLMediaElement>(null);
  const details = panel.durationMs ? ` (${Math.round(panel.durationMs / 1000)}s)` : "";
  const source = safeAssetSrc(panel.srcUri);
  const poster = safeAssetSrc(panel.posterUri);
  const captions = safeAssetSrc(panel.captionsUri);

  if (!source) {
    return (
      <figure className={classes.figure} data-media-kind="none">
        <figcaption className={classes.caption}>{panel.alt || panel.caption || "No media available."}{details}</figcaption>
      </figure>
    );
  }

  if (panel.kind === MediaKind.IMAGE) {
    return (
      <figure className={`${classes.figure}${classes.image ? ` ${classes.image}` : ""}`}>
        <img src={source} alt={panel.alt} />
        {(panel.caption || panel.alt) && (
          <figcaption className={classes.caption}>{panel.caption || panel.alt}{details}</figcaption>
        )}
      </figure>
    );
  }

  const seek = (startMs: number): void => {
    if (playerRef.current) playerRef.current.currentTime = startMs / 1000;
  };
  const setPlayer = (player: HTMLMediaElement | null): void => {
    playerRef.current = player;
  };
  const player = panel.kind === MediaKind.AUDIO ? (
    <audio ref={setPlayer} controls src={source} aria-label={panel.alt || panel.caption} />
  ) : (
    <video ref={setPlayer} controls src={source} poster={poster} aria-label={panel.alt || panel.caption}>
      {captions && <track kind="captions" src={captions} />}
    </video>
  );

  return (
    <figure className={classes.figure}>
      {player}
      <figcaption className={classes.caption}>{panel.caption || panel.alt || panel.srcUri}{details}</figcaption>
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
