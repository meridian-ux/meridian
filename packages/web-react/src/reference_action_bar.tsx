import { useContext, useId, useMemo, useRef, useState, type ReactNode } from "react";

import { ActionPlacement, type Action } from "@savvifi/meridian-proto-ts/proto/view_pb.js";
import { createAdmissionGate } from "@savvifi/meridian-schemas/uiview";

import type { ActionBarProps } from "./component_kit.js";
import { useMeridian } from "./provider.js";
import {
  buildActionBindingRequest,
  MeridianRecordContext,
  useMeridianSelection,
} from "./pagination.js";
import { MeridianViewContext } from "./view_renderer.js";

type ReferenceActionBarVariant = "html" | "shadcn";

const classes = {
  html: {
    bar: "mer-actions mer-action-bar",
    inline: "mer-actions-inline",
    control: "mer-action",
    primary: "mer-action mer-action-primary",
    overflowButton: "mer-actions-overflow",
    menu: "mer-actions-menu",
    menuItem: "mer-action mer-action-menu-item",
    feedback: "mer-action-feedback",
  },
  shadcn: {
    bar: "flex flex-wrap items-center gap-2",
    inline: "flex flex-wrap items-center gap-2",
    control: "inline-flex h-9 items-center justify-center rounded-md border px-4 text-sm font-medium",
    primary: "inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground",
    overflowButton: "inline-flex h-9 w-9 items-center justify-center rounded-md border text-sm font-medium",
    menu: "grid min-w-40 gap-1 rounded-md border bg-card p-1 shadow-md",
    menuItem: "w-full rounded-sm px-3 py-2 text-left text-sm hover:bg-muted",
    feedback: "text-sm text-muted-foreground",
  },
} as const;

/**
 * The dependency-free reference realization of a view ActionBar. URI and command
 * affordances belong to ActionPanel; view Actions carry either an RpcCall or a
 * host-resolved id, so this component deliberately does not invent navigation.
 */
export function ReferenceActionBar({
  actions,
  invoker,
  variant,
}: ActionBarProps & { variant: ReferenceActionBarVariant }): ReactNode {
  const { admission, onAction } = useMeridian();
  const { subjectKind } = useContext(MeridianViewContext);
  const selection = useMeridianSelection();
  const record = useContext(MeridianRecordContext);
  const gate = useMemo(() => createAdmissionGate(admission), [admission]);
  const [overflowOpen, setOverflowOpen] = useState(false);
  const [pendingActionId, setPendingActionId] = useState<string>();
  const [error, setError] = useState<{ actionId: string; message: string }>();
  const busy = useRef(false);
  const denialId = useId();
  const errorId = useId();
  const menuId = useId();
  const c = classes[variant];

  const visible = actions.filter((action) => action.placement !== ActionPlacement.ROW);
  if (visible.length === 0) return null;

  const inline = visible.filter((action) => action.placement !== ActionPlacement.OVERFLOW);
  const overflow = visible.filter((action) => action.placement === ActionPlacement.OVERFLOW);
  const isDenied = (action: Action): boolean =>
    !!action.call && !gate.admits("mutation", action.call.service, action.call.method);
  const hasUnfailedDenied = visible.some((action) => isDenied(action) && error?.actionId !== action.id);
  const describedBy = (action: Action): string | undefined => {
    const actionError = error?.actionId === action.id;
    const ids = [isDenied(action) && !actionError ? denialId : undefined, actionError ? errorId : undefined].filter(Boolean);
    return ids.length > 0 ? ids.join(" ") : undefined;
  };

  async function activate(action: Action): Promise<void> {
    if (busy.current) return;
    busy.current = true;
    setPendingActionId(action.id);
    setError(undefined);
    setOverflowOpen(false);
    try {
      if (action.call) {
        await invoker.invoke(
          action.call.service,
          action.call.method,
          buildActionBindingRequest(action.call, selection.values, record),
        );
      } else {
        onAction?.(action.id, subjectKind);
      }
    } catch {
      setError({
        actionId: action.id,
        message: isDenied(action) ? "This action is unavailable." : "Action failed. Try again.",
      });
    } finally {
      busy.current = false;
      setPendingActionId(undefined);
    }
  }

  function button(action: Action, menuItem = false): ReactNode {
    const primary = action.placement === ActionPlacement.PRIMARY;
    return (
      <button
        key={action.id}
        type="button"
        role={menuItem ? "menuitem" : undefined}
        className={menuItem ? c.menuItem : primary ? c.primary : c.control}
        aria-disabled={isDenied(action) || undefined}
        aria-busy={pendingActionId === action.id || undefined}
        aria-describedby={describedBy(action)}
        disabled={pendingActionId !== undefined}
        onClick={() => { void activate(action); }}
      >
        {action.label}
      </button>
    );
  }

  return (
    <div className={c.bar} data-action-bar={variant}>
      {inline.length > 0 ? <div className={c.inline}>{inline.map((action) => button(action))}</div> : null}
      {overflow.length > 0 ? (
        <div className="mer-actions-overflow-wrap">
          <button
            type="button"
            className={c.overflowButton}
            aria-label="More actions"
            aria-haspopup="menu"
            aria-expanded={overflowOpen}
            aria-controls={overflowOpen ? menuId : undefined}
            onClick={() => setOverflowOpen((open) => !open)}
          >
            &#8942;
          </button>
          {overflowOpen ? <div id={menuId} className={c.menu} role="menu">{overflow.map((action) => button(action, true))}</div> : null}
        </div>
      ) : null}
      {hasUnfailedDenied ? <span id={denialId} className={c.feedback}>This action is unavailable.</span> : null}
      {error ? <span id={errorId} className={c.feedback} role="alert">{error.message}</span> : null}
    </div>
  );
}
