"use client";

import { Box, Button, Dialog, DialogContent, Divider, InputAdornment, List,
  ListItemButton, ListItemIcon, ListItemText, TextField, Typography } from "@mui/material";
import * as React from "react";
import type { Command, Launchpad } from "@savvifi/meridian-proto-ts/proto/command_palette_pb.js";
import { normalizeCommand, safeNavigationHref } from "@savvifi/meridian-schemas/uiview";
import { ActionGroup, useActionGroup, useActionInvocation, useIcon } from "@savvifi/meridian-web-react";
import { useShell } from "../context.js";
import { flatten, matchCommands, moveIndex } from "../launchpad.js";
import { SearchGlyph } from "./glyphs.js";

function CommandIcon({ iconKey }: { iconKey: string }) {
  const glyph = useIcon(iconKey || undefined);
  return glyph ? <ListItemIcon sx={{ minWidth: 36 }}>{glyph}</ListItemIcon> : null;
}

// Search/URL metadata is not invocation intent and cannot supply a fallback.
function paletteAction(command: Command) {
  return normalizeCommand(command).action;
}

function exceedsBudget(launchpad: Launchpad | undefined) {
  if (!launchpad) return false;
  if (launchpad.groups.length > 1000) return true;
  let count = launchpad.defaultCommandIds.length;
  for (const group of launchpad.groups) {
    count += group.commands.length;
    if (count > 1000) return true;
  }
  return count > 1000;
}

function PaletteCommand({ command, visible, open, position, selected, highlight, close }: {
  command: Command; visible: boolean; open: boolean; position: number; selected: boolean;
  highlight: () => void; close: () => void;
}) {
  const action = paletteAction(command);
  const intent = action.affordance.invoke;
  const unsafe = intent.case === "uri" ? !safeNavigationHref(intent.value)
    : intent.case === "navigate" ? !safeNavigationHref(intent.value.route) : false;
  const invocation = useActionInvocation(action, { enabled: open && visible });
  const group = useActionGroup();
  const owner = React.useId();
  const message = unsafe ? "Action denied: this destination is unsafe or missing."
    : invocation.predicateDenied ? "Action denied: the current record does not meet its conditions." : invocation.feedback;
  const otherPending = group?.owner !== undefined && group.owner !== owner;
  const run = (trigger: HTMLElement) => {
    if (unsafe) return;
    if (group && !group.acquire(owner)) return;
    void invocation.activate(trigger).then(result => {
      if (result?.status === "succeeded") close();
    }).finally(() => group?.release(owner));
  };
  return <li hidden={!visible} style={{ listStyle: "none" }}>
    <ListItemButton component="button" type="button" sx={{ width: "100%", textAlign: "left" }} data-launchpad-position={visible ? position : undefined}
      selected={selected} onMouseEnter={highlight}
      disabled={unsafe || otherPending || invocation.unavailable || invocation.predicateDenied}
      aria-disabled={unsafe || invocation.pending || invocation.policyDenied || undefined}
      aria-busy={invocation.pending || undefined}
      aria-describedby={message ? invocation.feedbackId : undefined}
      onClick={event => run(event.currentTarget)}>
      <CommandIcon iconKey={command.icon} />
      <ListItemText primary={command.title || "Command"} secondary={command.subtitle || undefined}
        primaryTypographyProps={{ variant: "body2" }} />
      {command.shortcut && <Typography variant="caption" color="text.secondary">{command.shortcut}</Typography>}
    </ListItemButton>
    {message && <Typography component="span" id={invocation.feedbackId} role="status" variant="caption">{message}</Typography>}
    {invocation.pending && <Button type="button" size="small" onClick={event => invocation.cancel(event.currentTarget)}>Cancel action</Button>}
  </li>;
}

function PaletteProgress() {
  const group = useActionGroup();
  return group?.owner === undefined ? null : <Typography role="status" variant="caption">
    A command is still running. Wait for it to stop before running another.
  </Typography>;
}

export function LaunchpadView() {
  const { shell, launchpad, capabilities } = useShell();
  const [query, setQuery] = React.useState("");
  const [index, setIndex] = React.useState(0);
  const list = React.useRef<HTMLUListElement>(null);
  const search = React.useRef<HTMLInputElement>(null);
  const titleId = React.useId();
  React.useLayoutEffect(() => {
    // keepMounted preserves dispatchers, so autoFocus alone runs while closed.
    // Each explicit open must return typing to the search field, not a row.
    if (launchpad.isOpen) search.current?.focus();
  }, [launchpad.isOpen]);
  const oversized = exceedsBudget(shell.launchpad);
  const groups = oversized ? [] : matchCommands(shell.launchpad, query);
  const flat = flatten(groups);
  const allGroups = oversized ? [] : matchCommands(shell.launchpad, "");
  const close = () => { launchpad.close(); setQuery(""); setIndex(0); };
  if (!capabilities.launchpad) return null;

  // Keep logical commands mounted across filtering and close/reopen. Disabled
  // readers cannot activate but retain noncooperative pending guards to settlement.
  const entries = allGroups.flatMap((group, groupIndex) => group.commands.map((command, commandIndex) => {
    const matchedIndex = groups.findIndex(candidate => candidate.id === group.id);
    const offset = groups.slice(0, matchedIndex).reduce((sum, candidate) => sum + candidate.commands.length, 0);
    const within = matchedIndex < 0 ? -1 : groups[matchedIndex]!.commands.indexOf(command);
    const position = within < 0 ? -1 : offset + within;
    return { command, group, key: `${groupIndex}:${commandIndex}`, position };
  }));
  entries.sort((a, b) => (a.position < 0 ? Infinity : a.position) - (b.position < 0 ? Infinity : b.position));
  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault(); setIndex(current => moveIndex(current, event.key === "ArrowDown" ? 1 : -1, flat.length));
    } else if (event.key === "Enter") {
      event.preventDefault();
      list.current?.querySelector<HTMLButtonElement>(`button[data-launchpad-position="${index}"]`)?.click();
    }
  };
  return <ActionGroup><Dialog keepMounted aria-labelledby={titleId} open={launchpad.isOpen} onClose={close} fullWidth maxWidth="sm">
    <Typography component="h2" id={titleId} sx={{ position: "absolute", width: 1, height: 1, p: 0, m: -1,
      overflow: "hidden", clip: "rect(0, 0, 0, 0)", whiteSpace: "nowrap", border: 0 }}>Command palette</Typography>
    <Box sx={{ p: 2, pb: 1 }}>
      <TextField inputRef={search} fullWidth size="small" placeholder={shell.launchpad?.placeholder || "Search or jump to…"}
        inputProps={{ "aria-label": "Search commands" }} value={query}
        onChange={event => { setQuery(event.target.value); setIndex(0); }} onKeyDown={onKeyDown}
        InputProps={{ startAdornment: <InputAdornment position="start"><SearchGlyph fontSize="small" /></InputAdornment> }} />
    </Box>
    <Divider />
    <DialogContent sx={{ p: 0, maxHeight: 380 }}>
      <PaletteProgress />
      {oversized ? <Typography role="alert">Commands unavailable: the palette exceeds supported limits.</Typography>
        : flat.length === 0 && <Typography variant="body2" color="text.secondary" sx={{ p: 3, textAlign: "center" }}>Nothing matches “{query}”.</Typography>}
      <List ref={list} sx={{ py: 0 }}>
        {entries.map((entry, i) => <React.Fragment key={entry.key}>
          {entry.position >= 0 && entry.group.title && (i === 0 || entries[i - 1]?.group !== entry.group) &&
            <Typography component="li" variant="overline" sx={{ display: "block", px: 2, pt: 1.5, color: "text.secondary" }}>{entry.group.title}</Typography>}
          <PaletteCommand command={entry.command} visible={entry.position >= 0} open={launchpad.isOpen}
            position={entry.position} selected={entry.position === index} highlight={() => setIndex(entry.position)} close={close} />
        </React.Fragment>)}
      </List>
    </DialogContent>
  </Dialog></ActionGroup>;
}
