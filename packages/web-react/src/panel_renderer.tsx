// PanelRenderer — dispatches a meridian.ui.v1 PanelDescriptor's oneof to the
// active ComponentKit's per-shape component (or an adhoc factory). This is the
// kit-agnostic heart of the React renderer: it knows the descriptor shape, not
// the look.

import type { ReactNode } from "react";

import type { PanelDescriptor } from "@savvifi/meridian-proto-ts/proto/panel_pb.js";
import type { TerminalPanel } from "@savvifi/meridian-proto-ts/proto/terminal_pb.js";
import { safeWebSocketUrl } from "@savvifi/meridian-schemas/uiview";

import { useMeridian } from "./provider.js";

function TerminalFallback({ panel }: { panel: TerminalPanel }): ReactNode {
  const href = safeWebSocketUrl(panel.url);
  return (
    <section className="mer-terminal" role="region" aria-label={panel.tool || "Terminal"}>
      <p className="mer-terminal-note">Interactive terminal connection</p>
      {href ? (
        <a href={href}>{panel.url}</a>
      ) : (
        <>
          <code className="mer-terminal-url" aria-invalid="true">{panel.url}</code>
          <p className="mer-terminal-error" role="alert">Connection unavailable: expected a ws:// or wss:// broker URL</p>
        </>
      )}
      {(panel.cols || panel.rows) ? (
        <p className="mer-terminal-size">{panel.cols || "auto"} × {panel.rows || "auto"}</p>
      ) : null}
    </section>
  );
}

export function PanelRenderer({
  descriptor,
}: {
  descriptor: PanelDescriptor;
}): ReactNode {
  const { kit, invoker, adhoc } = useMeridian();
  const body = descriptor.body;

  let inner: ReactNode;
  switch (body.case) {
    case "table":
      inner = (
        <kit.Table panel={body.value} descriptor={descriptor} invoker={invoker} />
      );
      break;
    case "prompt":
      inner = (
        <kit.Prompt panel={body.value} descriptor={descriptor} invoker={invoker} />
      );
      break;
    case "lro":
      inner = (
        <kit.Lro panel={body.value} descriptor={descriptor} invoker={invoker} />
      );
      break;
    case "form":
      inner = (
        <kit.Form panel={body.value} descriptor={descriptor} invoker={invoker} />
      );
      break;
    case "detailHeader":
      inner = kit.DetailHeader ? (
        <kit.DetailHeader panel={body.value} descriptor={descriptor} invoker={invoker} />
      ) : (
        <kit.Fallback descriptor={descriptor} />
      );
      break;
    case "recordCard":
      inner = kit.RecordCard ? (
        <kit.RecordCard panel={body.value} descriptor={descriptor} invoker={invoker} />
      ) : (
        <kit.Fallback descriptor={descriptor} />
      );
      break;
    case "gallery":
      inner = kit.Gallery ? (
        <kit.Gallery panel={body.value} descriptor={descriptor} invoker={invoker} />
      ) : (
        <kit.Fallback descriptor={descriptor} />
      );
      break;
    case "llmPrompt":
      inner = kit.LlmPrompt ? (
        <kit.LlmPrompt
          panel={body.value}
          descriptor={descriptor}
          invoker={invoker}
        />
      ) : (
        <kit.Fallback descriptor={descriptor} />
      );
      break;
    case "choice":
      inner = kit.Choice ? (
        <kit.Choice panel={body.value} descriptor={descriptor} invoker={invoker} />
      ) : (
        <kit.Fallback descriptor={descriptor} />
      );
      break;
    case "snippet":
      inner = kit.Snippet ? (
        <kit.Snippet panel={body.value} descriptor={descriptor} invoker={invoker} />
      ) : (
        <kit.Fallback descriptor={descriptor} />
      );
      break;
    case "action":
      inner = kit.Action ? (
        <kit.Action panel={body.value} descriptor={descriptor} invoker={invoker} />
      ) : (
        <kit.Fallback descriptor={descriptor} />
      );
      break;
    case "connectFlow":
      inner = kit.ConnectFlow ? (
        <kit.ConnectFlow
          panel={body.value}
          descriptor={descriptor}
          invoker={invoker}
        />
      ) : (
        <kit.Fallback descriptor={descriptor} />
      );
      break;
    case "copyValue":
      inner = kit.CopyValue ? (
        <kit.CopyValue panel={body.value} descriptor={descriptor} invoker={invoker} />
      ) : (
        <kit.Fallback descriptor={descriptor} />
      );
      break;
    case "catalog":
      inner = kit.Catalog ? (
        <kit.Catalog panel={body.value} descriptor={descriptor} invoker={invoker} />
      ) : (
        <kit.Fallback descriptor={descriptor} />
      );
      break;
    case "chart":
      inner = kit.Chart ? (
        <kit.Chart panel={body.value} descriptor={descriptor} invoker={invoker} />
      ) : (
        <kit.Fallback descriptor={descriptor} />
      );
      break;
    case "resourceCards":
      inner = kit.ResourceCard ? (
        <kit.ResourceCard panel={body.value} descriptor={descriptor} invoker={invoker} />
      ) : (
        <kit.Fallback descriptor={descriptor} />
      );
      break;
    case "grammar":
      inner = kit.Grammar ? (
        <kit.Grammar panel={body.value} descriptor={descriptor} invoker={invoker} />
      ) : (
        <kit.Fallback descriptor={descriptor} />
      );
      break;
    case "stat":
      inner = kit.Stat ? (
        <kit.Stat panel={body.value} descriptor={descriptor} invoker={invoker} />
      ) : (
        <kit.Fallback descriptor={descriptor} />
      );
      break;
    case "steps":
      inner = kit.Steps ? (
        <kit.Steps panel={body.value} descriptor={descriptor} invoker={invoker} />
      ) : (
        <kit.Fallback descriptor={descriptor} />
      );
      break;
    case "media":
      inner = kit.Media ? (
        <kit.Media panel={body.value} descriptor={descriptor} invoker={invoker} />
      ) : (
        <kit.Fallback descriptor={descriptor} />
      );
      break;
    case "stream":
      inner = kit.Stream ? (
        <kit.Stream panel={body.value} descriptor={descriptor} invoker={invoker} />
      ) : (
        <kit.Fallback descriptor={descriptor} />
      );
      break;
    case "terminal":
      inner = kit.Terminal ? (
        <kit.Terminal panel={body.value} descriptor={descriptor} invoker={invoker} />
      ) : (
        <TerminalFallback panel={body.value} />
      );
      break;
    case "adhoc": {
      const Adhoc = adhoc[body.value.handlerId];
      inner = Adhoc ? (
        <Adhoc descriptor={descriptor} />
      ) : (
        <kit.Fallback descriptor={descriptor} />
      );
      break;
    }
    default:
      inner = <kit.Fallback descriptor={descriptor} />;
  }

  // A decoder drops an unknown future oneof tag and exposes the body as unset.
  // The kit fallback renders the same visible, non-throwing degradation as it
  // does for known-but-unsupported arms; do not special-case it into silence.

  const Chrome = kit.Chrome;
  return Chrome ? <Chrome descriptor={descriptor}>{inner}</Chrome> : inner;
}
