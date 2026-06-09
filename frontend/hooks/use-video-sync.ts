"use client";
import { useAtomValue, useSetAtom } from "jotai";
import { useEffect, useRef } from "react";
import { currentTimeAtom, activeSegmentIndexAtom } from "@/atoms/player";

interface Segment {
  start: number;
  end: number;
  text: string;
}

function binarySearchSegment(segments: Segment[], time: number): number {
  let low = 0;
  let high = segments.length - 1;
  let result = -1;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    if (segments[mid].start <= time) {
      result = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  // Verify the matched segment actually covers the current time
  if (result >= 0 && segments[result].end < time) {
    return -1;
  }

  return result;
}

export function useVideoSync(segments: Segment[]) {
  const currentTime = useAtomValue(currentTimeAtom);
  const setActiveIndex = useSetAtom(activeSegmentIndexAtom);
  const prevIndexRef = useRef(-1);

  useEffect(() => {
    if (!segments.length) return;

    const index = binarySearchSegment(segments, currentTime);
    if (index !== prevIndexRef.current) {
      prevIndexRef.current = index;
      setActiveIndex(index);
    }
  }, [currentTime, segments, setActiveIndex]);
}
