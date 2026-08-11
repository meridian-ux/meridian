"use client";
// The rail: a NavTree, rendered.
//
// The one substantively rewritten view. that host assembles its drawer at runtime from graph
// resources and hatch ships a literal array; both are now producers of the same descriptor,
// and this renders it without knowing which. Groups expand, leaves link, `badge` is a pill,
// `icon` resolves through the host's map — the rendering `nav_tree.proto`'s header describes
// and nothing implemented.

import {
  Box,
  Chip,
  Collapse,
  Divider,
  Drawer,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  MenuItem,
  TextField,
  Typography,
} from "@mui/material";
import type { SxProps, Theme } from "@mui/material/styles";
import * as React from "react";

import type { NavNode } from "@savvifi/meridian-proto-ts/proto/nav_tree_pb.js";
import { useIcon } from "@savvifi/meridian-web-react";

import { resolveScope } from "../config.js";
import { useShell } from "../context.js";
import { activeNodeId, hrefForNode, initiallyOpenGroups, isGroup } from "../nav.js";
import { ExpandLessGlyph, ExpandMoreGlyph } from "./glyphs.js";

const DRAWER_WIDTH = 280;

export function resolveSidebarSx(
  variant: "persistent" | "temporary",
  open: boolean,
): SxProps<Theme> {
  // A temporary drawer overlays and so always reserves its full width; a persistent one
  // reserves nothing when closed, which is what lets the main column reclaim the space.
  const reserved = variant === "persistent" ? (open ? DRAWER_WIDTH : 0) : DRAWER_WIDTH;
  return {
    width: reserved,
    flexShrink: 0,
    overflowX: "hidden",
    transition: (theme: Theme) =>
      theme.transitions.create("width", {
        easing: theme.transitions.easing.sharp,
        duration: open
          ? theme.transitions.duration.enteringScreen
          : theme.transitions.duration.leavingScreen,
      }),
    "& .MuiDrawer-paper": {
      width: DRAWER_WIDTH,
      boxSizing: "border-box",
      overflowX: "hidden",
    },
  };
}

function NavIcon({ iconKey }: { iconKey: string }) {
  // `useIcon` is meridian's icon seam (`MeridianProvider.renderIcon`) — the same one every
  // other mui-kit view resolves a descriptor's icon key through.
  const glyph = useIcon(iconKey || undefined);
  if (!glyph) return null;
  return <ListItemIcon sx={{ minWidth: 36 }}>{glyph}</ListItemIcon>;
}

function NavLeaf({ node, depth, activeId }: { node: NavNode; depth: number; activeId?: string }) {
  const { seams } = useShell();
  const { Link } = seams.routing;
  const href = hrefForNode(node, seams);
  const selected = node.id === activeId;

  const content = (
    <>
      <NavIcon iconKey={node.icon} />
      <ListItemText primary={node.label} primaryTypographyProps={{ variant: "body2" }} />
      {node.badge ? <Chip size="small" label={node.badge} sx={{ height: 20 }} /> : null}
    </>
  );

  // ⛔ No href ⇒ not a link. A leaf whose target is a panel/view the host cannot resolve
  // renders as a disabled row rather than an anchor to nowhere: a dead link that looks live
  // is worse than a row that looks inert.
  if (!href) {
    return (
      <ListItemButton disabled sx={{ pl: 2 + depth * 2 }}>
        {content}
      </ListItemButton>
    );
  }

  return (
    <ListItemButton
      component={Link}
      href={href}
      selected={selected}
      sx={{ pl: 2 + depth * 2 }}
      // The active row is the one thing on this screen a screen reader user cannot infer
      // from the visual treatment.
      aria-current={selected ? "page" : undefined}
    >
      {content}
    </ListItemButton>
  );
}

function NavGroup({
  node,
  depth,
  activeId,
  open,
  onToggle,
}: {
  node: NavNode;
  depth: number;
  activeId?: string;
  open: Set<string>;
  onToggle: (id: string) => void;
}) {
  const expanded = open.has(node.id);
  return (
    <>
      <ListItemButton onClick={() => onToggle(node.id)} sx={{ pl: 2 + depth * 2 }}>
        <NavIcon iconKey={node.icon} />
        <ListItemText primary={node.label} primaryTypographyProps={{ variant: "body2" }} />
        {node.badge ? <Chip size="small" label={node.badge} sx={{ height: 20, mr: 1 }} /> : null}
        {expanded ? <ExpandLessGlyph fontSize="small" /> : <ExpandMoreGlyph fontSize="small" />}
      </ListItemButton>
      <Collapse in={expanded} timeout="auto" unmountOnExit>
        <List component="div" disablePadding>
          {(node.children ?? []).map((child) => (
            <NavItem
              key={child.id}
              node={child}
              depth={depth + 1}
              activeId={activeId}
              open={open}
              onToggle={onToggle}
            />
          ))}
        </List>
      </Collapse>
    </>
  );
}

function NavItem(props: {
  node: NavNode;
  depth: number;
  activeId?: string;
  open: Set<string>;
  onToggle: (id: string) => void;
}) {
  const { node, depth, activeId, open, onToggle } = props;
  if (isGroup(node)) {
    return (
      <NavGroup node={node} depth={depth} activeId={activeId} open={open} onToggle={onToggle} />
    );
  }
  // A node with neither target nor children is an inert label — a section heading the
  // descriptor authored without making it expandable.
  if (!node.target?.case && !(node.children?.length ?? 0)) {
    return (
      <Typography
        variant="overline"
        sx={{ display: "block", px: 2, pt: 2, pb: 0.5, color: "text.secondary" }}
      >
        {node.label}
      </Typography>
    );
  }
  return <NavLeaf node={node} depth={depth} activeId={activeId} />;
}

function ScopeSelect() {
  const { shell, seams } = useShell();
  const scope = resolveScope(shell, seams);
  if (!scope) return null;
  const { selector, onChange } = scope;
  return (
    <Box sx={{ px: 2, pt: 2, pb: 1 }}>
      <TextField
        select
        fullWidth
        size="small"
        label={selector.label || "Scope"}
        value={
          // A selected_id naming no option renders as no selection rather than as an error —
          // MUI would otherwise warn about an out-of-range value on every render.
          selector.options.some((option) => option.id === selector.selectedId)
            ? selector.selectedId
            : ""
        }
        helperText={selector.helperText || undefined}
        onChange={(event) => onChange(event.target.value)}
      >
        {selector.options.map((option) => (
          <MenuItem key={option.id} value={option.id}>
            {option.label}
          </MenuItem>
        ))}
      </TextField>
    </Box>
  );
}

export function SidebarView({ variant }: { variant: "persistent" | "temporary" }) {
  const { shell, seams, sidebar } = useShell();
  const pathname = seams.routing.usePathname();
  const tree = shell.nav;

  const activeId = React.useMemo(
    () => activeNodeId(tree, pathname, seams),
    [tree, pathname, seams],
  );

  const [open, setOpen] = React.useState<Set<string>>(() => initiallyOpenGroups(tree, activeId));

  // ⛔ Re-open the active node's ancestors when the ROUTE changes, and merge rather than
  // replace. Replacing would slam shut every group the user opened by hand the moment they
  // navigated; not merging at all leaves the active item highlighted inside a closed group
  // after a client-side navigation into a collapsed section.
  React.useEffect(() => {
    setOpen((current) => {
      const next = new Set(current);
      for (const id of initiallyOpenGroups(tree, activeId)) next.add(id);
      return next;
    });
  }, [tree, activeId]);

  const toggle = React.useCallback((id: string) => {
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  return (
    <Drawer
      variant={variant}
      open={sidebar.isOpen}
      onClose={sidebar.close}
      sx={resolveSidebarSx(variant, sidebar.isOpen)}
      ModalProps={{ keepMounted: true }}
    >
      {/* Clears the app bar so the first nav row is not underneath it. */}
      <Box sx={{ minHeight: (theme) => theme.mixins.toolbar.minHeight }} />
      <ScopeSelect />
      <Divider />
      <List component="nav" aria-label={shell.title} sx={{ py: 0 }}>
        {(tree?.roots ?? []).map((node) => (
          <NavItem key={node.id} node={node} depth={0} activeId={activeId} open={open} onToggle={toggle} />
        ))}
      </List>
    </Drawer>
  );
}
