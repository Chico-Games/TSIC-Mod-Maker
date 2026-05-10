import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';

export interface PropertyEcho {
  /** Path inside record.json (no leading 'json' segment) — e.g. ['properties','weight','value']. */
  path: string[];
  /** Optional human label to show on rail rows (defaults to last path segment). */
  label?: string;
}

interface Ctx {
  echo: PropertyEcho | null;
  setEcho: (e: PropertyEcho | null) => void;
}

const PropertyEchoCtx = createContext<Ctx>({ echo: null, setEcho: () => {} });

export function PropertyEchoProvider({ children }: { children: ReactNode }) {
  const [echo, setEchoState] = useState<PropertyEcho | null>(null);
  const setEcho = useCallback((e: PropertyEcho | null) => setEchoState(e), []);
  return <PropertyEchoCtx.Provider value={{ echo, setEcho }}>{children}</PropertyEchoCtx.Provider>;
}

export function usePropertyEcho(): Ctx {
  return useContext(PropertyEchoCtx);
}
