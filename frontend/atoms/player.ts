import { atom } from "jotai";

// Current playback time in seconds
export const currentTimeAtom = atom(0);

// Currently active segment index
export const activeSegmentIndexAtom = atom(-1);

// Player seek function — set by the player component, used by transcript/citation clicks
export const seekFnAtom = atom<((time: number) => void) | null>(null);
