// Small browser hooks: element size and the reduced-motion preference.
import { useEffect, useState, useSyncExternalStore, type RefObject } from "react";

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

function subscribeReducedMotion(listener: () => void): () => void {
  const query = window.matchMedia(REDUCED_MOTION);
  query.addEventListener("change", listener);
  return () => query.removeEventListener("change", listener);
}

export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribeReducedMotion,
    () => window.matchMedia(REDUCED_MOTION).matches,
    () => false,
  );
}

/** Content width of an element, rounded to `step` px so small resizes do not trigger relayouts. */
export function useElementWidth(ref: RefObject<HTMLElement | null>, step = 8): number {
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const update = () => setWidth(Math.floor(element.clientWidth / step) * step);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref, step]);
  return width;
}

/**
 * Sections of the current page fade up as they scroll into view. Sections already on screen are left alone, so
 * nothing flashes on load; under reduced motion nothing is hidden.
 */
export function useScrollReveal(key: string): void {
  useEffect(() => {
    if (typeof IntersectionObserver === "undefined" || window.matchMedia(REDUCED_MOTION).matches) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          entry.target.classList.add("is-in");
          observer.unobserve(entry.target);
        }
      },
      { threshold: 0.12, rootMargin: "0px 0px -40px 0px" },
    );
    for (const section of document.querySelectorAll<HTMLElement>("main .section")) {
      if (section.getBoundingClientRect().top < window.innerHeight) continue;
      section.classList.add("reveal");
      observer.observe(section);
    }
    return () => observer.disconnect();
  }, [key]);
}
