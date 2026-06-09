import { atom } from "jotai";
import { atomWithStorage } from "jotai/utils";

export type QueueItemType = "video" | "article" | "wiki";
export type QueueItemState = "processing" | "done" | "failed";

export interface QueueItem {
  id: string;
  type: QueueItemType;
  title: string;
  state: QueueItemState;
  progress: number;
  message: string;
  addedAt: number;
}

const EXPIRY_MS = 24 * 60 * 60 * 1000; // 24 hours

const rawProcessingQueueAtom = atomWithStorage<QueueItem[]>("pingcha-processing-queue", []);

// Derived atom that auto-evicts done/failed items older than 24 hours on read
export const processingQueueAtom = atom(
  (get) => {
    const queue = get(rawProcessingQueueAtom);
    const now = Date.now();
    return queue.filter(
      (item) => item.state === "processing" || now - item.addedAt < EXPIRY_MS
    );
  },
  (_get, set, newValue: QueueItem[]) => {
    set(rawProcessingQueueAtom, newValue);
  }
);

export const addToQueueAtom = atom(null, (get, set, item: Omit<QueueItem, "addedAt">) => {
  const queue = get(processingQueueAtom);
  if (queue.some((q) => q.id === item.id && q.type === item.type)) return;
  set(processingQueueAtom, [...queue, { ...item, addedAt: Date.now() }]);
});

export const updateQueueItemAtom = atom(null, (get, set, update: { id: string; type: QueueItemType } & Partial<QueueItem>) => {
  const queue = get(processingQueueAtom);
  set(processingQueueAtom, queue.map((q) =>
    q.id === update.id && q.type === update.type ? { ...q, ...update } : q
  ));
});

export const removeFromQueueAtom = atom(null, (get, set, id: string, type: QueueItemType) => {
  set(processingQueueAtom, get(processingQueueAtom).filter((q) => !(q.id === id && q.type === type)));
});

export const activeQueueCountAtom = atom((get) =>
  get(processingQueueAtom).filter((q) => q.state === "processing").length
);
