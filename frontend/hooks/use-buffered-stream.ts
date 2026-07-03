import { useState, useRef, useCallback } from "react";

const FLUSH_INTERVAL = 50;

export function useBufferedStream() {
  const [text, setText] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const bufferRef = useRef("");
  const fullTextRef = useRef("");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flush = useCallback(() => {
    if (bufferRef.current) {
      fullTextRef.current += bufferRef.current;
      bufferRef.current = "";
      setText(fullTextRef.current);
    }
    timerRef.current = null;
  }, []);

  const appendToken = useCallback(
    (token: string) => {
      bufferRef.current += token;
      if (!timerRef.current) {
        timerRef.current = setTimeout(flush, FLUSH_INTERVAL);
      }
    },
    [flush],
  );

  const start = useCallback(() => {
    bufferRef.current = "";
    fullTextRef.current = "";
    clearTimeout(timerRef.current!);
    timerRef.current = null;
    setText("");
    setIsStreaming(true);
  }, []);

  const stop = useCallback(() => {
    flush();
    setIsStreaming(false);
  }, [flush]);

  const reset = useCallback(() => {
    bufferRef.current = "";
    fullTextRef.current = "";
    clearTimeout(timerRef.current!);
    timerRef.current = null;
    setText("");
    setIsStreaming(false);
  }, []);

  return { text, isStreaming, appendToken, start, stop, reset };
}
