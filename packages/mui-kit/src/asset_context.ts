// MeridianAssetContext — a host hook for rewriting asset (image) URLs a panel
// renders, e.g. prefixing a mount base (`/tools/e2e/…`) or swapping a CDN host.
// Set by MeridianMuiProvider (`resolveAssetSrc`), read by image panels (Gallery).
// Absent ⇒ the panel renders the src verbatim. Kept in its own module so the
// provider and the components can both import it without a cycle.
import { createContext } from "react";

export type MeridianAssetResolver = (src: string) => string;

export const MeridianAssetContext = createContext<MeridianAssetResolver | undefined>(undefined);
