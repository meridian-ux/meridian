// Compile-only host consumer of the generated public declarations.
import type { ReactNode } from "react";
import { Launchpad, filterLaunchpad, flatten, matchScore, commandHaystack } from "../src/index.js";
import type { LaunchpadProps, FilteredGroup } from "../src/index.js";
import type { Command, Launchpad as Descriptor } from "@savvifi/meridian-proto-ts/proto/command_palette_pb.js";

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends
  (<T>() => T extends B ? 1 : 2) ? true : false;
type Assert<T extends true> = T;
export type Props = Assert<Equal<keyof LaunchpadProps, "descriptor" | "open" |
  "onClose" | "onNavigate" | "onOpenView" | "onRun" | "onResolveQuery" | "agentGroupTitle">>;
export type RequiredProps = Assert<Equal<Pick<LaunchpadProps, "descriptor" | "open" | "onClose">,
  { descriptor: Descriptor; open: boolean; onClose: () => void }>>;
export type Group = Assert<Equal<FilteredGroup, { id: string; title: string; commands: Command[] }>>;
export type GroupTitle = Assert<Equal<LaunchpadProps["agentGroupTitle"], string | undefined>>;
export type Resolver = Assert<Equal<LaunchpadProps["onResolveQuery"], ((query: string) => Promise<Command[]>) | undefined>>;
export type Run = Assert<Equal<LaunchpadProps["onRun"], ((command: Command) => void) | undefined>>;
export type Navigate = Assert<Equal<LaunchpadProps["onNavigate"], ((route: string) => void) | undefined>>;
export type OpenView = Assert<Equal<LaunchpadProps["onOpenView"], ((viewId: string) => void) | undefined>>;
export type Render = Assert<Equal<typeof Launchpad, (props: LaunchpadProps) => ReactNode>>;
export type Filter = Assert<Equal<typeof filterLaunchpad, (descriptor: Descriptor, query: string) => FilteredGroup[]>>;
export type Flatten = Assert<Equal<typeof flatten, (groups: FilteredGroup[]) => Command[]>>;
export type Score = Assert<Equal<typeof matchScore, (haystack: string, query: string) => number | null>>;
export type Haystack = Assert<Equal<typeof commandHaystack, (command: Command) => string>>;
