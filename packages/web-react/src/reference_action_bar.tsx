import { useContext, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { ActionPlacement } from "@savvifi/meridian-proto-ts/proto/view_pb.js";
import { affordancePresentation, normalizeAffordance } from "@savvifi/meridian-schemas/uiview";
import type { ActionBarProps } from "./component_kit.js";
import { ActionControl } from "./action_control.js";
import { ActionGroup } from "./action_group.js";
import { MeridianViewContext } from "./view_renderer.js";

const classes = {
  html: {
    bar: "mer-actions mer-action-bar", inline: "mer-actions-inline", control: "mer-action",
    primary: "mer-action mer-action-primary", overflowButton: "mer-actions-overflow",
    menu: "mer-actions-menu", menuItem: "mer-action mer-action-menu-item",
  },
  shadcn: {
    bar: "flex flex-wrap items-center gap-2", inline: "flex flex-wrap items-center gap-2",
    control: "inline-flex h-9 items-center justify-center rounded-md border px-4 text-sm font-medium",
    primary: "inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground",
    overflowButton: "inline-flex h-9 w-9 items-center justify-center rounded-md border text-sm font-medium",
    menu: "grid min-w-40 gap-1 rounded-md border bg-card p-1 shadow-md",
    menuItem: "w-full rounded-sm px-3 py-2 text-left text-sm hover:bg-muted",
  },
} as const;

export function ReferenceActionBar({ actions, normalizedActions, variant }: ActionBarProps & { variant: "html" | "shadcn" }): ReactNode {
  const { subjectKind, subjectId } = useContext(MeridianViewContext);
  const [overflowOpen, setOverflowOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const menuId = useId();
  useLayoutEffect(() => {
    if (overflowOpen) menu.current?.querySelector<HTMLButtonElement>('button[role="menuitem"]:not(:disabled)')?.focus();
  }, [overflowOpen]);
  const c = classes[variant];
  const visible = (normalizedActions ?? actions.map(normalizeAffordance)).filter(a => a.affordance.placement !== ActionPlacement.ROW);
  if (!visible.length) return null;
  const inline = visible.filter(a => a.affordance.placement !== ActionPlacement.OVERFLOW);
  const overflow = visible.filter(a => a.affordance.placement === ActionPlacement.OVERFLOW);
  const subject = { entityType: subjectKind, entityId: subjectId || undefined };
  const close = () => { setOverflowOpen(false); trigger.current?.focus(); };
  return <ActionGroup><div className={c.bar} data-action-bar={variant}>
    {inline.length > 0 && <div className={c.inline}>{inline.map((action, index) =>
      <ActionControl key={action.affordance.id || index} action={action} options={{ subject }}
        className={affordancePresentation(action.affordance).primary ? c.primary : c.control} />)}</div>}
    {overflow.length > 0 && <div className="mer-actions-overflow-wrap">
      <button ref={trigger} type="button" className={c.overflowButton} aria-label="More actions"
        aria-haspopup="menu" aria-expanded={overflowOpen} aria-controls={overflowOpen ? menuId : undefined}
        onClick={() => setOverflowOpen(open => !open)}>&#8942;</button>
      <div ref={menu} hidden={!overflowOpen} id={menuId} className={c.menu} role="menu" onKeyDown={event => {
        if (event.key === "Escape") { event.preventDefault(); close(); }
        if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
          event.preventDefault();
          const items = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button[role="menuitem"]:not(:disabled)')];
          const index = items.indexOf(document.activeElement as HTMLButtonElement);
          const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1
            : (index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
          items[next]?.focus();
        }
      }}>{overflow.map((action, index) => <ActionControl key={action.affordance.id || index} action={action}
        options={{ subject, enabled: overflowOpen }} menuItem className={c.menuItem} onSuccess={close} />)}</div>
    </div>}
  </div></ActionGroup>;
}
