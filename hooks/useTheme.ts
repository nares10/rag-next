import { useCallback, useSyncExternalStore } from "react";

export type Theme = "light" | "dark";

const STORAGE_KEY = "theme";
const listeners = new Set<() => void>();

function current(): Theme {
  return document.documentElement.classList.contains("light") ? "light" : "dark";
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * The theme lives on <html> (set before paint by the script in app/layout.tsx), so the
 * class is the source of truth and this hook only reads and flips it.
 */
export function useTheme() {
  const theme = useSyncExternalStore(subscribe, current, () => "dark" as Theme);

  const setTheme = useCallback((next: Theme) => {
    document.documentElement.classList.toggle("light", next === "light");
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Private mode: the choice just doesn't persist.
    }
    listeners.forEach((listener) => listener());
  }, []);

  const toggleTheme = useCallback(() => setTheme(current() === "light" ? "dark" : "light"), [setTheme]);

  return { theme, setTheme, toggleTheme };
}
