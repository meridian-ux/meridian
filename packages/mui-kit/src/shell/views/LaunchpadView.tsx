"use client";
// The launchpad: a ⌘K overlay over a `Launchpad` descriptor.
//
// The first renderer of `command_palette.proto`, which was written for exactly this and had
// none. Every action arm maps onto a seam `@savvifi/meridian-web-react` already exports, so
// this file dispatches and renders — it invents no transport:
//
//   rpc         → useRpcInvoker
//   navigate    → the shell's routing seam
//   openViewId  → the shell's routing seam, via the host's hrefFor
//   openPanel   → PanelRenderer, so a create/edit FormPanel renders through MeridianForm
//
// aion's palette is the reason `deep_link` exists in the proto ("the aion studio palette
// encodes state as `?cmd=<entityType>/<mode>`"); a host that round-trips palette state
// through the URL sets it and this navigates there instead of running `action` inline.

import {
  Box,
  Dialog,
  DialogContent,
  Divider,
  InputAdornment,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  TextField,
  Typography,
} from "@mui/material";
import * as React from "react";

import type { Command } from "@savvifi/meridian-proto-ts/proto/command_palette_pb.js";
import { PanelRenderer, useIcon, useRpcInvoker } from "@savvifi/meridian-web-react";

import { useShell } from "../context.js";
import { flatten, matchCommands, moveIndex } from "../launchpad.js";
import { SearchGlyph } from "./glyphs.js";

function CommandIcon({ iconKey }: { iconKey: string }) {
  const glyph = useIcon(iconKey || undefined);
  if (!glyph) return null;
  return <ListItemIcon sx={{ minWidth: 36 }}>{glyph}</ListItemIcon>;
}

export function LaunchpadView() {
  const { shell, seams, launchpad, capabilities } = useShell();
  const invoker = useRpcInvoker();
  const [query, setQuery] = React.useState("");
  const [index, setIndex] = React.useState(0);
  // A command whose action opened a panel — rendered as a focused step of the palette.
  const [step, setStep] = React.useState<Command | null>(null);

  const groups = React.useMemo(() => matchCommands(shell.launchpad, query), [shell.launchpad, query]);
  const flat = React.useMemo(() => flatten(groups), [groups]);

  // The highlight returns to the top whenever the result set changes; leaving it where it
  // was points at a different command than the one the user was looking at.
  React.useEffect(() => setIndex(0), [query]);

  const close = React.useCallback(() => {
    launchpad.close();
    setQuery("");
    setIndex(0);
    setStep(null);
  }, [launchpad]);

  const run = React.useCallback(
    (command: Command) => {
      // A deep link wins over the action: a host that encodes palette state in the URL wants
      // the navigation, so that a refresh or a shared link reopens the same step.
      if (command.deepLink) {
        window.location.assign(command.deepLink);
        close();
        return;
      }
      const action = command.action;
      switch (action.case) {
        case "navigate":
          window.location.assign(action.value.route);
          close();
          return;
        case "openViewId": {
          const href = seams.hrefFor?.({ id: action.value, label: command.title });
          if (href) window.location.assign(href);
          close();
          return;
        }
        case "openPanel":
          // Stays open: the panel is a STEP of the palette, not a replacement for it.
          setStep(command);
          return;
        case "rpc": {
          // ⛔ Fired and closed without awaiting. A palette command is a "do this" gesture,
          // and holding the overlay open on a spinner would make ⌘K feel like a form. The
          // host surfaces failure through its own invoker, which is where every other
          // meridian action reports it.
          void invoker?.invoke(action.value.service, action.value.method, {});
          close();
          return;
        }
        default:
          close();
      }
    },
    [close, invoker, seams],
  );

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setIndex((current) => moveIndex(current, 1, flat.length));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setIndex((current) => moveIndex(current, -1, flat.length));
    } else if (event.key === "Enter") {
      event.preventDefault();
      const command = flat[index];
      if (command) run(command);
    }
  };

  if (!capabilities.launchpad) return null;

  const panel = step?.action.case === "openPanel" ? step.action.value.panel : undefined;

  return (
    <Dialog open={launchpad.isOpen} onClose={close} fullWidth maxWidth="sm">
      {panel ? (
        <DialogContent>
          <Typography variant="subtitle2" sx={{ mb: 1 }}>
            {step?.title}
          </Typography>
          <PanelRenderer descriptor={panel} />
        </DialogContent>
      ) : (
        <>
          <Box sx={{ p: 2, pb: 1 }}>
            <TextField
              autoFocus
              fullWidth
              size="small"
              placeholder={shell.launchpad?.placeholder || "Search or jump to…"}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={onKeyDown}
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchGlyph fontSize="small" />
                  </InputAdornment>
                ),
              }}
            />
          </Box>
          <Divider />
          <DialogContent sx={{ p: 0, maxHeight: 380 }}>
            {flat.length === 0 ? (
              <Typography variant="body2" color="text.secondary" sx={{ p: 3, textAlign: "center" }}>
                Nothing matches “{query}”.
              </Typography>
            ) : (
              <List sx={{ py: 0 }}>
                {groups.map((group) => (
                  <React.Fragment key={group.id}>
                    {group.title ? (
                      <Typography
                        variant="overline"
                        sx={{ display: "block", px: 2, pt: 1.5, color: "text.secondary" }}
                      >
                        {group.title}
                      </Typography>
                    ) : null}
                    {group.commands.map((command) => {
                      const position = flat.indexOf(command);
                      return (
                        <ListItemButton
                          key={command.id}
                          selected={position === index}
                          onMouseEnter={() => setIndex(position)}
                          onClick={() => run(command)}
                        >
                          <CommandIcon iconKey={command.icon} />
                          <ListItemText
                            primary={command.title}
                            secondary={command.subtitle || undefined}
                            primaryTypographyProps={{ variant: "body2" }}
                          />
                          {command.shortcut ? (
                            <Typography variant="caption" color="text.secondary">
                              {command.shortcut}
                            </Typography>
                          ) : null}
                        </ListItemButton>
                      );
                    })}
                  </React.Fragment>
                ))}
              </List>
            )}
          </DialogContent>
        </>
      )}
    </Dialog>
  );
}
