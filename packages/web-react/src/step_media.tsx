import { useState } from "react";
import type { Step } from "@savvifi/meridian-proto-ts/proto/steps_pb.js";
import { safeAssetSrc } from "@savvifi/meridian-schemas/uiview";

/** Shared media behavior; each kit supplies its own styling. */
export function StepMedia({ step, className, fallbackClassName }: {
  step: Step;
  className: string;
  fallbackClassName: string;
}) {
  const source = safeAssetSrc(step.mediaUri);
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
