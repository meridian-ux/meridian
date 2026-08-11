"use client";
// The frame itself: header, rail, content, dock — and the shortcuts sheet the bindings
// document.
//
// This is the whole public surface. A host mounts one component with a descriptor and its
// seams; everything below is an implementation detail it never names.

import { Box, Dialog, DialogContent, DialogTitle, Drawer, Stack, Typography, useMediaQuery } from "@mui/material";
import type { Theme } from "@mui/material/styles";
import * as React from "react";

import { displayKeys, isHotkeyEnabled, SHELL_HOTKEYS } from "../chrome.js";
import type { AppShellProps } from "../config.js";
import { ShellProvider, useIsApplePlatform, useShell } from "../context.js";
import { AppHeaderView } from "./AppHeaderView.js";
import { LaunchpadView } from "./LaunchpadView.js";
import { SidebarView } from "./SidebarView.js";

function HotkeyHelpDialog() {
  const { hotkeyHelp, capabilities } = useShell();
  const apple = useIsApplePlatform();
  const bindings = SHELL_HOTKEYS.filter((hotkey) => isHotkeyEnabled(hotkey.id, capabilities));
  return (
    <Dialog open={hotkeyHelp.isOpen} onClose={hotkeyHelp.close} maxWidth="xs" fullWidth>
      <DialogTitle>Keyboard shortcuts</DialogTitle>
      <DialogContent>
        <Stack spacing={1}>
          {bindings.map((hotkey) => (
            <Stack key={hotkey.id} direction="row" justifyContent="space-between" alignItems="center">
              <Typography variant="body2">{hotkey.description}</Typography>
              <Typography variant="caption" sx={{ fontFamily: "monospace" }}>
                {displayKeys(hotkey, apple).join(" ")}
              </Typography>
            </Stack>
          ))}
        </Stack>
      </DialogContent>
    </Dialog>
  );
}

function ChatDock() {
  const { shell, seams, chat, capabilities } = useShell();
  if (!capabilities.chat || !seams.chatPanel) return null;
  // ⛔ The renderer's own default, not the descriptor's. `ChatDock` carries no width: a
  // pixel measurement is unanswerable off the web (a sheet on iOS, a pane in a TUI) and
  // measurements belong to `theme.proto`. A host wanting a different dock themes it.
  const width = 380;
  return (
    <Drawer
      anchor="right"
      variant="persistent"
      open={chat.isOpen}
      // ⛔ A persistent drawer reserves its width from the flex row, which is what makes the
      // dock RESIZE the content rather than cover it. That reflow is the reason the dock
      // belongs to the shell at all — that host mounts `<Conversation>` as a sibling precisely
      // because, outside the frame, it can only overlay.
      sx={{
        width: chat.isOpen ? width : 0,
        flexShrink: 0,
        "& .MuiDrawer-paper": { width, boxSizing: "border-box" },
      }}
    >
      <Box sx={{ minHeight: (theme: Theme) => theme.mixins.toolbar.minHeight }} />
      {shell.chat?.title ? (
        <Typography variant="subtitle2" sx={{ px: 2, py: 1 }}>
          {shell.chat.title}
        </Typography>
      ) : null}
      <Box sx={{ flex: 1, minHeight: 0, overflow: "auto" }}>{seams.chatPanel}</Box>
    </Drawer>
  );
}

/**
 * The row between the app bar and the page: host chrome on the left, the page's own actions
 * on the right.
 *
 * ⛔ THIS EXISTS BECAUSE `usePageActions` WAS A DEAD WIRE. The hook stored its node in context
 * and no view ever read it, so a page publishing a "Create sponsor" button got a silent no-op
 * — the worst kind of API, because the call site looks correct and the button simply is not
 * there. `pageActions` and `pageChrome` share one row deliberately: a breadcrumb trail and the
 * primary action for the record it names belong on the same line, and giving each its own bar
 * costs two rows of vertical space on every page to say one thing.
 *
 * Renders NOTHING when the host supplies neither — no empty bar, no stray divider, no
 * reserved height. A shell used as a plain frame should look like one.
 */
function PageHeader() {
  const { seams, pageActions } = useShell();
  if (!seams.pageChrome && !pageActions) return null;
  return (
    <Box
      sx={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 2,
        px: 3,
        py: 1,
        minWidth: 0,
        borderBottom: 1,
        borderColor: "divider",
      }}
    >
      <Box sx={{ minWidth: 0, flexGrow: 1 }}>{seams.pageChrome}</Box>
      {pageActions ? (
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexShrink: 0 }}>{pageActions}</Box>
      ) : null}
    </Box>
  );
}

function Frame({ children }: { children?: React.ReactNode }) {
  const { sidebar, capabilities } = useShell();
  // `noSsr` is deliberate: the server cannot evaluate a media query, and letting this render
  // `false` on the server and `true` in the browser is a hydration mismatch across the whole
  // layout rather than one attribute.
  const wide = useMediaQuery((theme: Theme) => theme.breakpoints.up("md"), { noSsr: true });

  // The rail opens itself once the viewport is known — see the note in `ShellProvider` about
  // why it cannot simply start open.
  React.useEffect(() => {
    if (wide && capabilities.sidebar) sidebar.open();
    else sidebar.close();
    // Only on a viewport change: re-running when `sidebar` changes would reopen the drawer
    // every time the user closed it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wide, capabilities.sidebar]);

  return (
    <Box sx={{ display: "flex", minHeight: "100vh" }}>
      <AppHeaderView />
      {capabilities.sidebar ? <SidebarView variant={wide ? "persistent" : "temporary"} /> : null}
      <Box component="main" sx={{ flexGrow: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
        <Box sx={{ minHeight: (theme: Theme) => theme.mixins.toolbar.minHeight }} />
        <PageHeader />
        {children}
      </Box>
      <ChatDock />
      <LaunchpadView />
      <HotkeyHelpDialog />
    </Box>
  );
}

/** The app frame. One component, one descriptor, one set of seams. */
export function AppShellView({ shell, seams, children }: AppShellProps) {
  return (
    <ShellProvider shell={shell} seams={seams}>
      <Frame>{children}</Frame>
    </ShellProvider>
  );
}
