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

export interface RefreshOptions {
  /**
   * Start a new load even if one for the same key is running. After a transaction, the running load may have
   * started before the transaction was mined, so joining it could bring back the state from before it.
   */
  force?: boolean;
}

export type Refresh = (options?: RefreshOptions) => Promise<void>;

/** Returns refresh(): starts (or joins) a load for the current key. Stale results and errors are dropped. */
export function latestLoader<K, T>(options: LatestLoaderOptions<K, T>): Refresh {
  const { currentKey, same, load, onResult, onError } = options;
  let started = 0;
  let landed = 0;
  let inflight: { key: K; promise: Promise<void> } | null = null;

  return function refresh({ force = false }: RefreshOptions = {}): Promise<void> {
    const key = currentKey();
    if (!force && inflight && same(inflight.key, key)) return inflight.promise;
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

export interface AtLeastOptions {
  force: boolean;
  /** The block the state should have reached, e.g. the block that included our transaction. */
  atLeastBlock?: bigint;
  /** How many extra loads to try while the loaded state is older than atLeastBlock. */
  retries: number;
  wait: () => Promise<void>;
}

/**
 * Loads once and then, while the loaded state is still older than `atLeastBlock` (a load-balanced RPC can answer
 * from a node that is a block behind the one that returned the receipt), loads again after `wait()`, at most
 * `retries` times. Every extra load is forced, so it cannot join a load that started earlier.
 */
export async function refreshAtLeast(
  refresh: Refresh,
  loadedBlock: () => bigint | null,
  { force, atLeastBlock, retries, wait }: AtLeastOptions,
): Promise<void> {
  await refresh({ force });
  if (atLeastBlock === undefined) return;
  for (let attempt = 0; attempt < retries; attempt++) {
    const block = loadedBlock();
    if (block !== null && block >= atLeastBlock) return;
    await wait();
    await refresh({ force: true });
  }
}
