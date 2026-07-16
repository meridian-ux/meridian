// @savvifi/meridian-launchpad — the command-palette / launchpad renderer of the
// meridian renderer family.
//
// It renders a meridian.ui.v1 Launchpad descriptor (command_palette.proto) as a
// ⌘K command palette, dispatching each Command's action through the
// meridian-web-react ComponentKit / RpcInvoker / PanelRenderer seam. The
// descriptor is modality-neutral (a TUI / native renderer can consume the same
// data and the same pure `filterLaunchpad`); this package is the React tier.

export { Launchpad } from "./launchpad.js";
export type { LaunchpadProps } from "./launchpad.js";
export {
  filterLaunchpad,
  flatten,
  matchScore,
  commandHaystack,
  type FilteredGroup,
} from "./filter.js";
