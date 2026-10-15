"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * The time, to the nearest `intervalMs` below, ticking every `intervalMs`.
 * Null on the server, so the server and the browser render the same first time.
 */
export function useNow(intervalMs: number): number | null {
  const subscribe = useCallback(
    (onTick: () => void) => {
      const timer = setInterval(onTick, intervalMs);
      return () => clearInterval(timer);
    },
    [intervalMs],
  );
  return useSyncExternalStore(
    subscribe,
    // Rounded down, so the value only changes when a tick is due.
    () => Math.floor(Date.now() / intervalMs) * intervalMs,
    () => null,
  );
}
