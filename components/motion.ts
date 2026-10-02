import type { Transition } from "motion/react";

/** Shared timings: UI motion stays short (150–300 ms) and eases out. */
export const EASE_OUT: Transition = { duration: 0.2, ease: "easeOut" };
export const PANEL_SPRING: Transition = { type: "spring", stiffness: 400, damping: 40 };

/** Rows that collapse their height and fade when removed. */
export const COLLAPSE = {
  initial: { opacity: 0, height: 0 },
  animate: { opacity: 1, height: "auto" },
  exit: { opacity: 0, height: 0 },
  transition: EASE_OUT,
} as const;
