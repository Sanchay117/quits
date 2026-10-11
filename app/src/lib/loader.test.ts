import { describe, expect, it } from "vitest";
import { sameAccount } from "./consent.ts";
import { latestLoader } from "./loader.ts";

interface Pending {
  key: string | null;
  resolve: (value: string) => void;
  reject: (err: unknown) => void;
}

/** A loader whose loads finish only when the test says so, recording what reached the page. */
function harness() {
  let key: string | null = null;
  const pending: Pending[] = [];
  const results: string[] = [];
  const errors: string[] = [];
  const refresh = latestLoader<string | null, string>({
    currentKey: () => key,
    same: sameAccount,
    load: (k) =>
      new Promise<string>((resolve, reject) => {
        pending.push({ key: k, resolve, reject });
      }),
    onResult: (value) => results.push(value),
    onError: (err) => errors.push(String(err)),
  });
  return {
    refresh,
    pending,
    results,
    errors,
    setKey: (next: string | null) => {
      key = next;
    },
  };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("latestLoader", () => {
  it("shares one load between calls for the same account", async () => {
    const h = harness();
    const first = h.refresh();
    const second = h.refresh();
    expect(second).toBe(first);
    expect(h.pending).toHaveLength(1);
    h.pending[0].resolve("state for nobody");
    await first;
    expect(h.results).toEqual(["state for nobody"]);
    // Once it has landed, the next call starts a new load.
    void h.refresh();
    expect(h.pending).toHaveLength(2);
  });

  it("drops a result read for an account that is no longer connected", async () => {
    const h = harness();
    void h.refresh();
    h.setKey("0xAA");
    void h.refresh();
    expect(h.pending.map((p) => p.key)).toEqual([null, "0xAA"]);
    h.pending[0].resolve("state for nobody");
    await settle();
    expect(h.results).toEqual([]);
    h.pending[1].resolve("state for 0xAA");
    await settle();
    expect(h.results).toEqual(["state for 0xAA"]);
  });

  it("matches accounts case-insensitively", () => {
    const h = harness();
    h.setKey("0xAA");
    void h.refresh();
    h.setKey("0xaa");
    void h.refresh();
    expect(h.pending).toHaveLength(1);
  });

  it("never lets an older load overwrite a newer one for the same account", async () => {
    const h = harness();
    h.setKey("0xAA");
    void h.refresh(); // A, first
    h.setKey("0xBB");
    void h.refresh(); // B
    h.setKey("0xAA");
    void h.refresh(); // A, second
    expect(h.pending.map((p) => p.key)).toEqual(["0xAA", "0xBB", "0xAA"]);
    h.pending[2].resolve("A, newer");
    await settle();
    h.pending[0].resolve("A, older");
    h.pending[1].resolve("B");
    await settle();
    expect(h.results).toEqual(["A, newer"]);
  });

  it("reports errors only for the current account", async () => {
    const h = harness();
    void h.refresh();
    h.setKey("0xAA");
    void h.refresh();
    h.pending[0].reject(new Error("stale failure"));
    h.pending[1].reject(new Error("node down"));
    await settle();
    expect(h.errors).toEqual(["Error: node down"]);
  });
});
