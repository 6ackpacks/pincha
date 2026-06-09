import { atom } from "jotai";
import { atomWithStorage } from "jotai/utils";

export const activeKbIdAtom = atomWithStorage<string | null>("pingcha_active_kb_id", null, undefined, { getOnInit: true });
