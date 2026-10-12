"use client";

import { useEffect, useRef, useState } from "react";

/**
 * A ref and the width of the element it is on, kept current as it resizes.
 * `initial` is the width before the first measurement (and where there is no
 * ResizeObserver, as in tests).
 */
export function useResizeObserver<T extends HTMLElement>(initial: number) {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(initial);
  useEffect(() => {
    const element = ref.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(entry.contentRect.width);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}
