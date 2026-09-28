import { useEffect } from "react";
import { useAppStore } from "../store/useAppStore";
import { PERCENT_MULTIPLIER, SCROLL_PROGRESS_VISIBLE_MS } from "../constants";

export function useScrollPercent(elementRef, scrollerSelector, resetKey) {
  const setScrollPercent = useAppStore((state) => state.setScrollPercent);

  useEffect(() => {
    const element = elementRef.current;
    const scroller = scrollerSelector
      ? element?.closest(scrollerSelector)
      : element?.parentElement;
    if (!scroller) return undefined;
    let lastScrollTop = scroller.scrollTop;
    let hideTimeout;

    function handleScroll() {
      if (scroller.scrollTop === lastScrollTop) return;
      lastScrollTop = scroller.scrollTop;
      const scrollableHeight = scroller.scrollHeight - scroller.clientHeight;
      if (scrollableHeight <= 0) {
        setScrollPercent(null);
        return;
      }
      setScrollPercent(
        Math.round((scroller.scrollTop / scrollableHeight) * PERCENT_MULTIPLIER),
      );
      window.clearTimeout(hideTimeout);
      hideTimeout = window.setTimeout(
        () => setScrollPercent(null),
        SCROLL_PROGRESS_VISIBLE_MS,
      );
    }

    scroller.addEventListener("scroll", handleScroll, { passive: true });
    return () => {
      scroller.removeEventListener("scroll", handleScroll);
      window.clearTimeout(hideTimeout);
      setScrollPercent(null);
    };
  }, [elementRef, resetKey, scrollerSelector, setScrollPercent]);
}
