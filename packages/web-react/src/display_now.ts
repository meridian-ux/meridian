// A stable instant for relative ValueDisplay labels.
//
// SSR and the first client paint intentionally receive undefined, so absolute
// temporal text is identical across hydration. Once mounted, every field on the
// surface uses one captured instant and relative labels can appear safely.

import { useSyncExternalStore } from "react";

const CLIENT_NOW = Date.now();

function subscribe(): () => void {
  return () => {};
}

export function useDisplayNow(): number | undefined {
  return useSyncExternalStore<number | undefined>(
    subscribe,
    () => CLIENT_NOW,
    () => undefined,
  );
}
