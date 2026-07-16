// <Launchpad> — the React renderer for a meridian.ui.v1 Launchpad descriptor: a
// ⌘K command palette. It reads the transport/kit seam from the surrounding
// <MeridianProvider> (meridian-web-react), so a Command's action dispatches
// through the SAME RpcInvoker / PanelRenderer every panel uses:
//   - rpc          → invoker.invoke(service, method)
//   - open_panel   → a focused step rendering the panel through the host's kit
//   - open_view_id → onOpenView (or the host action handler)
//   - navigate     → onNavigate (or window.location)
//
// The host owns the open gesture (bind ⌘K to toggle `open`); this component owns
// filtering, keyboard navigation, and dispatch. It must render inside a
// <MeridianProvider>.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";

import type {
  Command,
  Launchpad as LaunchpadDescriptor,
} from "@savvifi/meridian-proto-ts/proto/command_palette_pb.js";
import type { PanelDescriptor } from "@savvifi/meridian-proto-ts/proto/panel_pb.js";
import {
  PanelRenderer,
  useActionHandler,
  useIcon,
  useRpcInvoker,
} from "@savvifi/meridian-web-react";

import { filterLaunchpad, flatten } from "./filter.js";

export interface LaunchpadProps {
  /** The command palette to render. */
  descriptor: LaunchpadDescriptor;
  /** Whether the overlay is shown. The host toggles this (e.g. on ⌘K). */
  open: boolean;
  /** Called when the palette should close (Escape, backdrop click, or after a
   *  terminal command runs). */
  onClose: () => void;
  /** Host router for a `navigate` command. Absent ⇒ window.location.assign. */
  onNavigate?: (route: string) => void;
  /** Host handler for an `open_view_id` command. Absent ⇒ the MeridianProvider
   *  action handler is called with ("open-view", viewId). */
  onOpenView?: (viewId: string) => void;
  /** Notified for every command run (telemetry / recents), after dispatch. */
  onRun?: (command: Command) => void;
}

const overlayStyle: CSSProperties = {
  position: "fixed",
  inset: 0,
  display: "flex",
  alignItems: "flex-start",
  justifyContent: "center",
  paddingTop: "12vh",
  background: "rgba(0,0,0,0.45)",
  zIndex: 1000,
};

const panelStyle: CSSProperties = {
  width: "min(640px, 92vw)",
  maxHeight: "70vh",
  overflow: "hidden",
  display: "flex",
  flexDirection: "column",
  borderRadius: 12,
  background: "var(--surface, #1a1d27)",
  color: "var(--text, #e5e7eb)",
  boxShadow: "0 24px 64px rgba(0,0,0,0.5)",
};

/** One command row. A subcomponent so `useIcon` (a hook) is called per row. */
function CommandRow({
  command,
  active,
  onRun,
  onHover,
}: {
  command: Command;
  active: boolean;
  onRun: () => void;
  onHover: () => void;
}): ReactNode {
  const icon = useIcon(command.icon);
  return (
    <div
      className="mlp-row"
      role="option"
      aria-selected={active}
      data-active={active || undefined}
      data-command-id={command.id}
      onMouseDown={(e) => {
        e.preventDefault();
        onRun();
      }}
      onMouseEnter={onHover}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "8px 14px",
        cursor: "pointer",
        background: active ? "var(--accent, #6366f1)" : "transparent",
      }}
    >
      {command.icon ? (
        <span className="mlp-icon" data-icon={command.icon}>
          {icon}
        </span>
      ) : null}
      <span className="mlp-title" style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: "block" }}>{command.title}</span>
        {command.subtitle ? (
          <span
            className="mlp-subtitle"
            style={{ display: "block", fontSize: "0.85em", color: "var(--muted, #9ca3af)" }}
          >
            {command.subtitle}
          </span>
        ) : null}
      </span>
      {command.shortcut ? (
        <kbd className="mlp-kbd" style={{ fontSize: "0.8em", opacity: 0.8 }}>
          {command.shortcut}
        </kbd>
      ) : null}
    </div>
  );
}

export function Launchpad({
  descriptor,
  open,
  onClose,
  onNavigate,
  onOpenView,
  onRun,
}: LaunchpadProps): ReactNode {
  const invoker = useRpcInvoker();
  const actionHandler = useActionHandler();

  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [focusedPanel, setFocusedPanel] = useState<PanelDescriptor | undefined>(undefined);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const groups = useMemo(() => filterLaunchpad(descriptor, query), [descriptor, query]);
  const flat = useMemo(() => flatten(groups), [groups]);
  const indexOf = useMemo(() => {
    const m = new Map<Command, number>();
    flat.forEach((c, i) => m.set(c, i));
    return m;
  }, [flat]);

  // Reset transient state each time the palette opens.
  useEffect(() => {
    if (open) {
      setQuery("");
      setActiveIndex(0);
      setFocusedPanel(undefined);
      inputRef.current?.focus();
    }
  }, [open]);

  // Keep the active row in range as the filtered list changes.
  useEffect(() => {
    setActiveIndex((i) => (flat.length === 0 ? 0 : Math.min(i, flat.length - 1)));
  }, [flat.length]);

  const finish = useCallback(() => {
    setFocusedPanel(undefined);
    onClose();
  }, [onClose]);

  const runCommand = useCallback(
    (command: Command) => {
      const action = command.action;
      switch (action.case) {
        case "rpc":
          void invoker.invoke(action.value.service, action.value.method, {});
          finish();
          break;
        case "openPanel":
          setFocusedPanel(action.value.panel);
          break;
        case "openViewId":
          if (onOpenView) onOpenView(action.value);
          else actionHandler?.("open-view", action.value);
          finish();
          break;
        case "navigate": {
          const route = action.value.route;
          if (onNavigate) onNavigate(route);
          else if (typeof window !== "undefined") window.location.assign(route);
          finish();
          break;
        }
        default:
          finish();
      }
      onRun?.(command);
    },
    [invoker, actionHandler, onOpenView, onNavigate, onRun, finish],
  );

  // Keyboard model: ↑/↓ move, Enter runs, Escape backs out of a focused panel or
  // closes. Bound to the document only while open (effects never run in SSR).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        if (focusedPanel) setFocusedPanel(undefined);
        else onClose();
        return;
      }
      if (focusedPanel) return;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIndex((i) => (flat.length === 0 ? 0 : (i + 1) % flat.length));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIndex((i) => (flat.length === 0 ? 0 : (i - 1 + flat.length) % flat.length));
      } else if (e.key === "Enter") {
        e.preventDefault();
        const command = flat[activeIndex];
        if (command) runCommand(command);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, focusedPanel, flat, activeIndex, runCommand, onClose]);

  if (!open) return null;

  return (
    <div
      className="meridian-launchpad"
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
      style={overlayStyle}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="mlp-panel" style={panelStyle} onMouseDown={(e) => e.stopPropagation()}>
        {focusedPanel ? (
          <div className="mlp-step">
            <button
              type="button"
              className="mlp-back"
              onClick={() => setFocusedPanel(undefined)}
              style={{ margin: 12 }}
            >
              ← Back
            </button>
            <div style={{ padding: "0 14px 14px" }}>
              <PanelRenderer descriptor={focusedPanel} />
            </div>
          </div>
        ) : (
          <>
            <input
              ref={inputRef}
              className="mlp-input"
              type="text"
              value={query}
              autoFocus
              placeholder={descriptor.placeholder || "Search or jump to…"}
              onChange={(e) => setQuery(e.target.value)}
              style={{
                border: "none",
                outline: "none",
                background: "transparent",
                color: "inherit",
                padding: "14px 16px",
                fontSize: "1rem",
                borderBottom: "1px solid rgba(255,255,255,0.08)",
              }}
            />
            <div className="mlp-list" role="listbox" style={{ overflowY: "auto", padding: "6px 0" }}>
              {flat.length === 0 ? (
                <div className="mlp-empty" style={{ padding: "16px", color: "var(--muted, #9ca3af)" }}>
                  No matching commands
                </div>
              ) : (
                groups.map((g) => (
                  <div className="mlp-group" key={g.id}>
                    {g.title ? (
                      <div
                        className="mlp-group-title"
                        style={{
                          padding: "8px 14px 4px",
                          fontSize: "0.72em",
                          textTransform: "uppercase",
                          letterSpacing: "0.04em",
                          color: "var(--muted, #9ca3af)",
                        }}
                      >
                        {g.title}
                      </div>
                    ) : null}
                    {g.commands.map((command) => {
                      const idx = indexOf.get(command) ?? -1;
                      return (
                        <CommandRow
                          key={`${g.id}:${command.id}`}
                          command={command}
                          active={idx === activeIndex}
                          onRun={() => runCommand(command)}
                          onHover={() => setActiveIndex(idx)}
                        />
                      );
                    })}
                  </div>
                ))
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
