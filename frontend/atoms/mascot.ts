import { atom } from "jotai";

// Controls whether the floating mascot chat panel is open
export const mascotOpenAtom = atom(false);

// Triggers the "fly-in" animation when opened from an external source
export const mascotTriggerAtom = atom(false);

// Tracks the current mascot animation state for video-based animations
export const mascotAnimStateAtom = atom<"idle" | "hover" | "thinking" | "answer">("idle");
