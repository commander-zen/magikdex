// iOS Safari quirk: touchend timing is unreliable inside scroll/drag containers.
// touchstart fires immediately and consistently — use it for double-tap detection.
// onTouchEnd={(e) => e.preventDefault()} on the same element blocks the
// synthetic 300ms-delayed click that iOS generates after touch events.
import { useRef, useCallback } from "react";

export function useDoubleTap(onDoubleTap, threshold = 300) {
  const lastTap = useRef(0);

  const handler = useCallback((e) => {
    const now = Date.now();
    const delta = now - lastTap.current;
    if (delta < threshold && delta > 0) {
      e.preventDefault();
      e.stopPropagation();
      onDoubleTap(e);
      lastTap.current = 0;
    } else {
      lastTap.current = now;
    }
  }, [onDoubleTap, threshold]);

  return handler;
}
