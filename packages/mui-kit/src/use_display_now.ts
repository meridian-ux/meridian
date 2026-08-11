// The instant relative timestamps are measured against — and the reason it is a
// hook rather than a `Date.now()` call at the format site.
//
// Relative text is a function of NOW. This kit renders on both sides of an SSR
// hydration boundary (a Next.js host server-renders a view, then hydrates it), so a
// server that reads the clock and a client that reads it again produce different
// strings for the same field, and React reports a mismatch and re-renders the
// whole subtree. `display_format.ts` already takes the UTC-always position for
// exactly this reason.
//
// So: `undefined` on the server AND on the first client paint — which makes
// `formatByDisplay` emit the ABSOLUTE form, identical on both sides — then a real
// instant once mounted, at which point the relative label appears. The swap is a
// post-hydration update, which React is happy with.
//
// One instant per mount, deliberately not a ticking clock. A "5 days ago" that
// silently becomes "6 days ago" mid-session is churn nobody asked for, and a timer
// per timestamp is worse. A remount (a route change, a refetch) re-reads it.

import { useSyncExternalStore } from "react";

/** Never notifies: the value is read once per mount and then held. */
function subscribe(): () => void {
  return () => {};
}

/**
 * `undefined` during SSR and the first client paint, then a fixed millisecond
 * instant. Pass straight into `formatByDisplay(value, display, now)`.
 */
export function useDisplayNow(): number | undefined {
  return useSyncExternalStore<number | undefined>(
    subscribe,
    // Client snapshot: stable across re-renders within a mount because the store
    // never notifies, so React keeps the first value it read.
    () => CLIENT_NOW,
    // Server snapshot.
    () => undefined,
  );
}

/** Captured once per module load rather than per call, so every field on a page
 *  measures against the SAME instant — two timestamps a second apart must not
 *  disagree about what "now" was. */
const CLIENT_NOW = Date.now();
