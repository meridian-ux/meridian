// <Launchpad> — the React renderer for a meridian.ui.v1 Launchpad descriptor: a
// ⌘K command palette. It reads the transport/kit seam from the surrounding
// <MeridianProvider> (meridian-web-react), so a Command's action dispatches
// through shared canonical admission. No legacy callback, router, panel mount,
// or window.location fallback grants a capability.
//
// The host owns the open gesture (bind ⌘K to toggle `open`); this component owns
// filtering, keyboard navigation, and dispatch. It must render inside a
// <MeridianProvider>.

import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { clone, create } from "@bufbuild/protobuf";
import { AffordanceSchema } from "@savvifi/meridian-proto-ts/proto/affordance_pb.js";
import { CommandSchema } from "@savvifi/meridian-proto-ts/proto/command_palette_pb.js";
import type { CSSProperties, ReactNode } from "react";

import type {
  Command,
  Launchpad as LaunchpadDescriptor,
} from "@savvifi/meridian-proto-ts/proto/command_palette_pb.js";
import { affordancePresentation, normalizeCommand, NormalizedAction, safeNavigationHref } from "@savvifi/meridian-schemas/uiview";
import {
  ActionGroup, boundedDescriptorJson, useActionGroup, useActionInvocation,
  useIcon,
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
  /** @deprecated Source compatibility only; explicitly register invocation.capabilities.navigate. */
  onNavigate?: (route: string) => void;
  /** @deprecated Source compatibility only; explicitly register invocation.capabilities.openView. */
  onOpenView?: (viewId: string) => void;
  /** Success-only notification with the original Command envelope, after close.
   * Denial, failure, cancellation, or stale context never notify or close. */
  onRun?: (command: Command) => void;
  /**
   * AI-launchpad seam: hand a non-empty query to a host-provided agent resolver
   * (debounced ~250ms) that returns runnable Commands, surfaced under the agent
   * group. This is how a natural-language query ("show me failing builds") becomes
   * a command — the host wires it to its agent/LLM (e.g. the meridian-chat MCP
   * host). Memoize it (useCallback) so it doesn't re-run every keystroke's render.
   * Runs only while open. Query/resolver changes withdraw old commands; closing
   * cancels the debounce and ignores pending results (it cannot abort host work
   * already started). Synchronous throws and rejected promises show no results.
   */
  onResolveQuery?: (query: string) => Promise<Command[]>;
  /** Heading for the agent-resolved commands group. Default "Ask the agent". */
  agentGroupTitle?: string;
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
  position,
  optionId,
  onSuccess,
  onHover,
}: {
  command: Command;
  active: boolean;
  position: number;
  optionId: string;
  onSuccess: () => void;
  onHover: () => void;
}): ReactNode {
  const normalized = normalizeCommand(command).action;
  const action = command.affordance === undefined && command.deepLink
    ? new NormalizedAction(create(AffordanceSchema, { id: command.id, label: command.title,
      description: command.subtitle, icon: command.icon, invoke: { case: "uri", value: command.deepLink } }), undefined, "command") : normalized;
  const invocation = useActionInvocation(action);
  const group = useActionGroup();
  const owner = useId();
  const presentation = affordancePresentation(action.affordance);
  const iconKey = command.affordance === undefined ? command.icon : action.affordance.icon;
  const icon = useIcon(iconKey);
  const title = command.affordance === undefined ? command.title : action.affordance.label;
  const descriptionId = `${owner}-description`;
  const intent = action.affordance.invoke;
  const unsafe = intent.case === "uri" ? !safeNavigationHref(intent.value)
    : intent.case === "navigate" ? !safeNavigationHref(intent.value.route) : false;
  const disabled = unsafe || invocation.unavailable || invocation.predicateDenied
    || group?.owner !== undefined && group.owner !== owner;
  const message = invocation.predicateDenied ? "Action denied: the current record does not meet its conditions." : invocation.feedback;
  const run = (trigger: HTMLElement) => {
    if (disabled || invocation.pending || group && !group.acquire(owner)) return;
    const search = trigger.closest('[role="dialog"]')?.querySelector<HTMLInputElement>('input[role="combobox"]');
    void invocation.activate(search ?? trigger).then(result => {
      if (result?.status === "succeeded" && result.refresh !== "failed") onSuccess();
    }).finally(() => group?.release(owner));
  };
  return (
    <div>
    <button
      type="button"
      tabIndex={-1}
      id={optionId}
      data-launchpad-position={position}
      className="mlp-row"
      role="option"
      aria-selected={active}
      disabled={disabled}
      aria-disabled={disabled || invocation.pending || invocation.policyDenied || undefined}
      aria-busy={invocation.pending || undefined}
      aria-describedby={[action.affordance.description && descriptionId, message && invocation.feedbackId].filter(Boolean).join(" ") || undefined}
      aria-label={title || "Command"}
      data-mer-tone={presentation.tone}
      data-mer-emphasis={action.affordance.emphasis === undefined ? undefined : presentation.primary ? "primary" : "secondary"}
      data-active={active || undefined}
      data-command-id={command.id}
      onMouseDown={(e) => {
        e.preventDefault();
      }}
      onClick={event => run(event.currentTarget)}
      onMouseEnter={onHover}
      style={{
        display: "flex",
        width: "100%", textAlign: "left", border: 0, color: "inherit", font: "inherit",
        ...presentation.style,
        alignItems: "center",
        gap: 10,
        padding: "8px 14px",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.55 : undefined,
        background: active ? "var(--accent, #6366f1)" : "transparent",
      }}
    >
      {iconKey ? (
        <span className="mlp-icon" data-icon={iconKey}>
          {icon}
        </span>
      ) : null}
      <span className="mlp-title" style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: "block" }}>{title || "Command"}</span>
        {command.affordance !== undefined && command.title !== title && <span className="mlp-envelope-title">{command.title}</span>}
        {command.subtitle && command.subtitle !== action.affordance.description ? (
          <span
            className="mlp-subtitle"
            style={{ display: "block", fontSize: "0.85em", color: "var(--muted, #9ca3af)" }}
          >
            {command.subtitle}
          </span>
        ) : null}
        {action.affordance.description && <span id={descriptionId} style={{ display: "block" }}>{action.affordance.description}</span>}
      </span>
      {command.shortcut ? (
        <kbd className="mlp-kbd" style={{ fontSize: "0.8em", opacity: 0.8 }}>
          {command.shortcut}
        </kbd>
      ) : null}
    </button>
    {message && <span id={invocation.feedbackId} role={invocation.unavailable || invocation.predicateDenied || invocation.outcome?.status === "failed" || invocation.outcome?.status === "denied" ? "alert" : "status"}>{message}</span>}
    {invocation.pending && <button type="button" onClick={event => invocation.cancel(event.currentTarget)}>Cancel action</button>}
    </div>
  );
}

function LaunchpadSession({
  descriptor,
  open,
  onClose,
  onRun,
  onResolveQuery,
  agentGroupTitle = "Ask the agent",
}: LaunchpadProps): ReactNode {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [agentResult, setAgentResult] = useState<{ scope: object; commands: Command[] }>();
  const agentScope = useMemo(() => ({}), [descriptor, query, open, onResolveQuery]);
  const agentCommands = agentResult?.scope === agentScope ? agentResult.commands : [];
  const [agentPending, setAgentPending] = useState(false);
  const agentOriginals = useRef(new WeakMap<Command, Command>());
  const inputRef = useRef<HTMLInputElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const group = useActionGroup();
  const listId = useId();
  let oversized = false, count = 0;
  try {
    boundedDescriptorJson(descriptor);
    oversized = descriptor.groups.length > 1000 || descriptor.defaultCommandIds.length > 1000;
    count = descriptor.defaultCommandIds.length;
    for (const candidate of descriptor.groups) { count += candidate.commands.length; if (count > 1000) { oversized = true; break; } }
  } catch { oversized = true; }

  const localGroups = useMemo(() => oversized ? [] : filterLaunchpad(descriptor, query), [descriptor, query, oversized]);
  // Merge agent-resolved commands (the AI-launchpad seam) as a trailing group, so
  // they share keyboard nav + dispatch with the local commands.
  const groups = useMemo(
    () =>
      !oversized && agentCommands.length > 0
        ? [...localGroups, { id: "__agent__", title: agentGroupTitle, commands: agentCommands }]
        : localGroups,
    [localGroups, agentCommands, agentGroupTitle, oversized],
  );
  const flat = useMemo(() => flatten(groups), [groups]);
  const overMountedBudget = flat.length > 1000;
  const offsets = useMemo(() => {
    let offset = 0;
    return groups.map(candidate => { const current = offset; offset += candidate.commands.length; return current; });
  }, [groups]);

  // Reset transient state each time the palette opens.
  useEffect(() => {
    if (open) {
      setQuery("");
      setActiveIndex(0);
    }
  }, [open]);
  useLayoutEffect(() => {
    if (!open) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
    const dialog = dialogRef.current;
    inputRef.current?.focus();
    return () => {
      if (opener?.isConnected && (dialog?.contains(document.activeElement) || document.activeElement === document.body)) opener.focus();
    };
  }, [open]);

  // Keep the active row in range as the filtered list changes.
  useEffect(() => {
    setActiveIndex((i) => (flat.length === 0 ? 0 : Math.min(i, flat.length - 1)));
  }, [flat.length]);

  // AI-launchpad seam: debounce-hand a non-empty query to the host's agent
  // resolver and surface the returned commands. Stale results are dropped.
  useEffect(() => {
    // Results belong to the current visible query and host resolver. Keeping
    // an old command runnable while asking a new question is not a cache hit.
    setAgentResult(undefined);
    setAgentPending(false);
    const q = query.trim();
    if (!open || oversized || !onResolveQuery || !q) return;
    let cancelled = false;
    setAgentPending(true);
    const timer = setTimeout(() => {
      Promise.resolve()
        .then(() => cancelled ? [] : onResolveQuery(q))
        .then((commands) => {
          if (cancelled) return;
          if (!Array.isArray(commands) || commands.length + count > 1000) throw new Error("Command budget exceeded.");
          boundedDescriptorJson(commands);
          const owned = commands.map(command => {
            const owned = clone(CommandSchema, command); agentOriginals.current.set(owned, command); return owned;
          });
          setAgentResult({ scope: agentScope, commands: owned });
          setAgentPending(false);
        })
        .catch(() => {
          if (cancelled) return;
          setAgentResult(undefined);
          setAgentPending(false);
        });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [open, query, onResolveQuery, oversized, agentScope, count]);

  // Escape closes; search owns arrows/Enter. Do not steal Enter from the
  // reachable cancel button or another control outside this dialog.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && dialogRef.current?.contains(e.target as Node)) {
        e.preventDefault();
        onClose();
      } else if (e.key === "Tab" && dialogRef.current?.contains(e.target as Node)) {
        const controls = Array.from(dialogRef.current.querySelectorAll<HTMLElement>('input,button:not([disabled]):not([tabindex="-1"])'));
        const edge = e.shiftKey ? controls[0] : controls[controls.length - 1];
        if (document.activeElement === edge) { e.preventDefault(); (e.shiftKey ? controls[controls.length - 1] : controls[0])?.focus(); }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      ref={dialogRef}
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
          <>
            <input
              ref={inputRef}
              className="mlp-input"
              type="text"
              value={query}
              role="combobox"
              aria-label="Search commands"
              aria-controls={listId}
              aria-expanded="true"
              aria-activedescendant={!overMountedBudget && flat[activeIndex] ? `${listId}-${activeIndex}` : undefined}
              placeholder={(!oversized && descriptor.placeholder) || "Search or jump to…"}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={event => {
                if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                  event.preventDefault();
                  setActiveIndex(index => flat.length === 0 ? 0 : (index + (event.key === "ArrowDown" ? 1 : -1) + flat.length) % flat.length);
                } else if (event.key === "Enter") {
                  event.preventDefault();
                  dialogRef.current?.querySelector<HTMLButtonElement>(`button[data-launchpad-position="${activeIndex}"]`)?.click();
                }
              }}
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
            {group?.owner !== undefined && <div role="status">A command is still running. Wait for it to stop before running another.</div>}
            <div className="mlp-list" id={listId} role="listbox" aria-label="Commands" style={{ overflowY: "auto", padding: "6px 0" }}>
              {oversized || overMountedBudget ? <div role="alert">Commands unavailable: the palette exceeds supported limits.</div> : flat.length === 0 ? (
                <div className="mlp-empty" style={{ padding: "16px", color: "var(--muted, #9ca3af)" }}>
                  {agentPending ? "Asking the agent…" : "No matching commands"}
                </div>
              ) : (
                groups.map((g, groupIndex) => (
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
                    {g.commands.map((command, commandIndex) => {
                      const idx = offsets[groupIndex]! + commandIndex;
                      return (
                        <CommandRow
                          key={`${query}:${idx}:${command.id}`}
                          command={command}
                          active={idx === activeIndex}
                          position={idx}
                          optionId={`${listId}-${idx}`}
                          onSuccess={() => { onClose(); onRun?.(agentOriginals.current.get(command) ?? command); }}
                          onHover={() => setActiveIndex(idx)}
                        />
                      );
                    })}
                  </div>
                ))
              )}
              {agentPending && flat.length > 0 ? (
                <div
                  className="mlp-agent-pending"
                  style={{ padding: "8px 14px", fontSize: "0.85em", color: "var(--muted, #9ca3af)" }}
                >
                  Asking the agent…
                </div>
              ) : null}
            </div>
          </>
      </div>
    </div>
  );
}

export function Launchpad(props: LaunchpadProps): ReactNode {
  // Keep serialization alive across close/query replacement, including while
  // an unmounted command's noncooperative host effect is still settling.
  return <ActionGroup><LaunchpadSession {...props} /></ActionGroup>;
}
