// Server-renders every page with a stub window, as the production site would load, to catch render-time errors
// and stray dashes in copy.
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, expect, it } from "vitest";

const DASHES = /[–—]/;

beforeAll(() => {
  const listeners = { addEventListener() {}, removeEventListener() {} };
  (globalThis as Record<string, unknown>).window = {
    ...listeners,
    location: { search: "", hash: "", pathname: "/quits/", hostname: "sanchay117.github.io" },
    matchMedia: () => ({ matches: false, ...listeners }),
  };
});

afterAll(() => {
  delete (globalThis as Record<string, unknown>).window;
});

it("renders every page without errors or dashes", async () => {
  const pages = await Promise.all([
    import("./Home.tsx").then((m) => m.HomePage),
    import("./Network.tsx").then((m) => m.NetworkPage),
    import("./Account.tsx").then((m) => m.AccountPage),
    import("./Cycles.tsx").then((m) => m.CyclesPage),
    import("./Playground.tsx").then((m) => m.PlaygroundPage),
    import("./How.tsx").then((m) => m.HowPage),
  ]);
  const { CycleDetailPage } = await import("./CycleDetail.tsx");
  const { Header, Footer } = await import("../components/Shell.tsx");
  const rendered = [
    ...pages.map((Page) => renderToStaticMarkup(<Page />)),
    renderToStaticMarkup(<CycleDetailPage id={0n} />),
    renderToStaticMarkup(<Header route={{ page: "home" }} />),
    renderToStaticMarkup(<Footer />),
  ];
  for (const html of rendered) {
    expect(html.length).toBeGreaterThan(100);
    expect(html).not.toMatch(DASHES);
  }
});
