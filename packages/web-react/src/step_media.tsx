import { useState } from "react";
import type { Step } from "@savvifi/meridian-proto-ts/proto/steps_pb.js";

/** Frames accept web URLs and relative paths; unsupported schemes degrade to text. */
function frameSource(uri: string): string | undefined {
  const source = uri.trim();
  if (!source || /[\u0000-\u001f\u007f]/.test(source)) return undefined;
  try {
    const url = new URL(source, "https://meridian.invalid/");
    return url.protocol === "https:" || url.protocol === "http:" ? source : undefined;
  } catch {
    return undefined;
  }
}

/** Shared media behavior; each kit supplies its own styling. */
export function StepMedia({ step, className, fallbackClassName }: {
  step: Step;
  className: string;
  fallbackClassName: string;
}) {
  const source = frameSource(step.mediaUri);
  const [failedSource, setFailedSource] = useState<string>();
  const alternative = step.mediaAlt || step.label;
  if (!source || source === failedSource) {
    // A standalone alternative remains useful even without an image URI.
    const text = step.mediaUri ? alternative : step.mediaAlt;
    return text ? <p className={fallbackClassName}>{text}</p> : null;
  }
  return (
    <img
      className={className}
      src={source}
      alt={alternative}
      loading="lazy"
      style={{ display: "block", maxWidth: "100%", height: "auto" }}
      onError={() => setFailedSource(source)}
    />
  );
}
