// PanelRenderer — dispatches a meridian.ui.v1 PanelDescriptor's oneof to the
// active ComponentKit's per-shape component (or an adhoc factory). This is the
// kit-agnostic heart of the React renderer: it knows the descriptor shape, not
// the look.

import type { ReactNode } from "react";

import type { PanelDescriptor } from "@meridian/proto-ts/proto/panel_pb.js";

import { useMeridian } from "./provider.js";

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

  const Chrome = kit.Chrome;
  return Chrome ? <Chrome descriptor={descriptor}>{inner}</Chrome> : inner;
}
