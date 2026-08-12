// The three glyphs the frame draws for itself, as inline paths.
//
// ⛔ NOT `@mui/icons-material`. mui-kit depends on `@mui/material` and nothing else from the
// MUI family, and adding a second package to a PUBLISHED peer set — for a chevron — makes
// every consumer install it. Three `<path d>` strings cost nothing and keep the dependency
// surface exactly where it was.
//
// These are the shell's OWN chrome (expand, collapse, search). Icons that come from a
// descriptor — `NavNode.icon`, `Command.icon` — are not here: they go through `useIcon`,
// the `MeridianProvider.renderIcon` seam that mui-kit's content views already use, so a host
// resolves nav glyphs the same way it resolves every other meridian icon.
//
// Paths are Material Design's own, which is what the surrounding MUI components are drawn
// from — a hand-drawn chevron beside MUI's would be visibly not quite right.

import { SvgIcon } from "@mui/material";
import type { SvgIconProps } from "@mui/material";

export function ExpandMoreGlyph(props: SvgIconProps) {
  return (
    <SvgIcon {...props}>
      <path d="M16.59 8.59 12 13.17 7.41 8.59 6 10l6 6 6-6z" />
    </SvgIcon>
  );
}

export function ExpandLessGlyph(props: SvgIconProps) {
  return (
    <SvgIcon {...props}>
      <path d="M12 8l-6 6 1.41 1.41L12 10.83l4.59 4.58L18 14z" />
    </SvgIcon>
  );
}

export function SearchGlyph(props: SvgIconProps) {
  return (
    <SvgIcon {...props}>
      <path d="M15.5 14h-.79l-.28-.27A6.47 6.47 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z" />
    </SvgIcon>
  );
}

export function MenuGlyph(props: SvgIconProps) {
  return (
    <SvgIcon {...props}>
      <path d="M3 18h18v-2H3zm0-5h18v-2H3zm0-7v2h18V6z" />
    </SvgIcon>
  );
}
