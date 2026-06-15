import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

interface DirtyPayload {
  pageId: string;
  label: string;
  onSave?: () => void;
  onDiscard?: () => void;
}

interface DirtyContextValue {
  active: DirtyPayload | null;
  register: (id: string, payload: DirtyPayload | null) => void;
}

const DirtyContext = createContext<DirtyContextValue | null>(null);

/**
 * Provides a registry of "dirty" form sections. Each settings sub-page
 * registers a payload (label + save/discard callbacks) when its form has
 * unsaved changes; the shell shows a sticky bar wired to the most recently
 * registered payload.
 */
export function SettingsDirtyProvider({ children }: { children: ReactNode }) {
  const [active, setActive] = useState<DirtyPayload | null>(null);
  const map = useRef<Map<string, DirtyPayload>>(new Map());

  const register = useCallback((id: string, payload: DirtyPayload | null) => {
    if (payload) {
      // Delete before re-inserting so that re-registering an existing key
      // moves it to the end of Map insertion order. JS Maps preserve insertion
      // order, and set() on an existing key updates in place without reordering,
      // so delete + set is necessary to produce true most-recently-updated
      // semantics when the same page re-registers after a draft change.
      map.current.delete(id);
      map.current.set(id, payload);
    } else {
      map.current.delete(id);
    }
    const last = Array.from(map.current.values()).pop() ?? null;
    setActive(last);
  }, []);

  const value = useMemo(() => ({ active, register }), [active, register]);

  return <DirtyContext.Provider value={value}>{children}</DirtyContext.Provider>;
}

export function useSettingsDirtyState(): DirtyContextValue {
  const ctx = useContext(DirtyContext);
  return (
    ctx ?? {
      active: null,
      register: () => {},
    }
  );
}

interface UseSettingsDirtyOptions {
  label: string;
  onSave?: () => void;
  onDiscard?: () => void;
}

/**
 * Sub-page hook. When `isDirty` is true, registers the page's save/discard
 * callbacks with the shell so the sticky bar at the bottom of the screen
 * surfaces them.
 */
export function useSettingsDirty(
  pageId: string,
  isDirty: boolean,
  options: UseSettingsDirtyOptions,
): void {
  const { register } = useSettingsDirtyState();
  const { label, onSave, onDiscard } = options;

  useEffect(() => {
    if (!isDirty) {
      register(pageId, null);
      return;
    }
    register(pageId, { pageId, label, onSave, onDiscard });
    return () => register(pageId, null);
  }, [pageId, isDirty, label, onSave, onDiscard, register]);
}
