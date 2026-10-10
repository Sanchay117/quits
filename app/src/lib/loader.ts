// A load that depends on a key that can change while it runs (the connected account): concurrent calls for the same
// key share one request, and a result is only kept if its key is still current and nothing newer has landed.

export interface LatestLoaderOptions<K, T> {
  /** The key the next load is for, read when refresh() is called and again when the load finishes. */
  currentKey: () => K;
  same: (a: K, b: K) => boolean;
  load: (key: K) => Promise<T>;
  onResult: (value: T, key: K) => void;
  onError: (err: unknown, key: K) => void;
}

/** Returns refresh(): starts (or joins) a load for the current key. Stale results and errors are dropped. */
export function latestLoader<K, T>(options: LatestLoaderOptions<K, T>): () => Promise<void> {
  const { currentKey, same, load, onResult, onError } = options;
  let started = 0;
  let landed = 0;
  let inflight: { key: K; promise: Promise<void> } | null = null;

  return function refresh(): Promise<void> {
    const key = currentKey();
    if (inflight && same(inflight.key, key)) return inflight.promise;
    const ticket = ++started;
    // Fresh means: still the key the page wants, and no load started after this one has landed already.
    const fresh = () => ticket > landed && same(currentKey(), key);
    const promise: Promise<void> = load(key)
      .then(
        (value) => {
          if (!fresh()) return;
          landed = ticket;
          onResult(value, key);
        },
        (err: unknown) => {
          if (!fresh()) return;
          landed = ticket;
          onError(err, key);
        },
      )
      .finally(() => {
        if (inflight?.promise === promise) inflight = null;
      });
    inflight = { key, promise };
    return promise;
  };
}
