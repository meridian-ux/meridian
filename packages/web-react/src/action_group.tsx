import { createContext, useContext, useRef, useState, type ReactNode } from "react";

// Runtime gesture serialization, not permission or a serialized action DTO.
// Keep the existing bar/table-wide pending guard while individual dispatchers
// own cancellation, current-context checks, and sanitized outcomes.
const Context = createContext<{
  owner?: string; acquire(id: string): boolean; release(id: string): void;
} | undefined>(undefined);

export function ActionGroup({ children }: { children: ReactNode }): ReactNode {
  const active = useRef<string | undefined>(undefined);
  const [owner, setOwner] = useState<string>();
  return <Context.Provider value={{ owner,
    acquire(id) {
      if (active.current !== undefined) return false;
      active.current = id; setOwner(id); return true;
    },
    release(id) {
      if (active.current === id) { active.current = undefined; setOwner(undefined); }
    },
  }}>{children}</Context.Provider>;
}

export function useActionGroup() { return useContext(Context); }
