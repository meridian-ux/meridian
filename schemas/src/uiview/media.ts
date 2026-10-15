import { MediaKind } from "@savvifi/meridian-proto-ts/proto/media_pb.js";
import { safeAssetSrc } from "./navigation.js";

/** Resolve only the declared medium or a recognized source extension. Unknown
 * sources degrade rather than becoming an arbitrary video player. No fetching. */
export function resolveMediaKind(kind: MediaKind, source: string): MediaKind {
  if ([MediaKind.IMAGE, MediaKind.AUDIO, MediaKind.VIDEO].includes(kind)) return kind;
  const admitted = safeAssetSrc(source);
  if (!admitted) return MediaKind.UNSPECIFIED;
  const path = new URL(admitted, "https://meridian.invalid/").pathname.toLowerCase();
  if (/\.(png|jpe?g|gif|webp|avif|svg)$/.test(path)) return MediaKind.IMAGE;
  if (/\.(mp3|wav|ogg|oga|aac|m4a|flac|opus)$/.test(path)) return MediaKind.AUDIO;
  if (/\.(mp4|webm|ogv|mov|m4v)$/.test(path)) return MediaKind.VIDEO;
  return MediaKind.UNSPECIFIED;
}
