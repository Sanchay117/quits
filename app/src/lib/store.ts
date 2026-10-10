// A minimal observable store for state shared across components (chain data, wallet, caches).
import { useSyncExternalStore } from "react";

export interface Store<T extends object> {
  get(): T;
  set(update: Partial<T> | ((current: T) => T)): void;
  subscribe(listener: () => void): () => void;
}

export function createStore<T extends object>(initial: T): Store<T> {
  let state = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => state,
    set(update) {
      state = typeof update === "function" ? update(state) : { ...state, ...update };
      listeners.forEach((listener) => listener());
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export function useStore<T extends object>(store: Store<T>): T {
  return useSyncExternalStore(store.subscribe, store.get, store.get);
}
