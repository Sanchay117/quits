// Drives the collapse animation: first the cleared invoices fade, then the net transfers draw in.
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { usePrefersReducedMotion } from "../lib/hooks.ts";
import { clamp01 } from "./geometry.ts";

const CLEAR_MS = 2800;
const PAUSE_MS = 350;
const SETTLE_MS = 1600;
const AUTOPLAY_DELAY_MS = 700;

export interface CollapseProgress {
  /** Progress of the clearing phase, 0 to 1. */
  clear: number;
  /** Progress of the settlement phase, 0 to 1. */
  settle: number;
  playing: boolean;
}

const BEFORE: CollapseProgress = { clear: 0, settle: 0, playing: false };
const AFTER: CollapseProgress = { clear: 1, settle: 1, playing: false };

export interface Collapse extends CollapseProgress {
  play(): void;
  showBefore(): void;
  showAfter(): void;
}

/**
 * Animation state for one graph. Changing `resetKey` (a new model) returns to the "before" picture. With `autoplay`,
 * the animation starts once the element is on screen. Under prefers-reduced-motion nothing tweens: the states jump.
 */
export function useCollapse(resetKey: string, autoplay: boolean, target: RefObject<Element | null>): Collapse {
  const reducedMotion = usePrefersReducedMotion();
  const [progress, setProgress] = useState<CollapseProgress>(BEFORE);
  const frame = useRef(0);

  const stop = useCallback(() => cancelAnimationFrame(frame.current), []);

  const play = useCallback(() => {
    stop();
    if (reducedMotion) {
      setProgress(AFTER);
      return;
    }
    const startedAt = performance.now();
    const tick = (now: number) => {
      const elapsed = now - startedAt;
      const clear = clamp01(elapsed / CLEAR_MS);
      const settle = clamp01((elapsed - CLEAR_MS - PAUSE_MS) / SETTLE_MS);
      setProgress({ clear, settle, playing: settle < 1 });
      if (settle < 1) frame.current = requestAnimationFrame(tick);
    };
    frame.current = requestAnimationFrame(tick);
  }, [reducedMotion, stop]);

  const showBefore = useCallback(() => {
    stop();
    setProgress(BEFORE);
  }, [stop]);

  const showAfter = useCallback(() => {
    stop();
    setProgress(AFTER);
  }, [stop]);

  useEffect(() => {
    showBefore();
    const element = target.current;
    if (!autoplay || !element) return;
    if (reducedMotion) {
      setProgress(AFTER);
      return;
    }
    let timer = 0;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        observer.disconnect();
        timer = window.setTimeout(play, AUTOPLAY_DELAY_MS);
      },
      { threshold: 0.3 },
    );
    observer.observe(element);
    return () => {
      observer.disconnect();
      window.clearTimeout(timer);
      stop();
    };
  }, [resetKey, autoplay, reducedMotion, target, play, showBefore, stop]);

  return { ...progress, play, showBefore, showAfter };
}
