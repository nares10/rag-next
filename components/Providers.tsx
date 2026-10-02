"use client";

import { MotionConfig } from "motion/react";

/** `reducedMotion="user"` turns transform animations off when the OS asks for less motion. */
export default function Providers({ children }: { children: React.ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}
