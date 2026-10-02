import { useEffect, useRef } from "react";

/** Calls `onDismiss` on a click outside the returned ref's element, or on Escape. */
export function useDismiss<T extends HTMLElement>(isOpen: boolean, onDismiss: () => void) {
  const ref = useRef<T | null>(null);
  const latest = useRef(onDismiss);

  useEffect(() => {
    latest.current = onDismiss;
  });

  useEffect(() => {
    if (!isOpen) return;

    const onPointer = (event: PointerEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) latest.current();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") latest.current();
    };

    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [isOpen]);

  return ref;
}
