// TEMPORARY: server-renders every page with a stub window to catch render-time errors. Deleted after use.
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, expect, it } from "vitest";

beforeAll(() => {
  const listeners = { addEventListener() {}, removeEventListener() {} };
  (globalThis as Record<string, unknown>).window = {
    ...listeners,
    location: { search: process.env.SEARCH ?? "", hash: "", pathname: "/quits/", hostname: "someone.github.io" },
    matchMedia: () => ({ matches: false, ...listeners }),
  };
});

it("renders every page", async () => {
  const pages = await Promise.all([
    import("./pages/Home.tsx").then((m) => m.HomePage),
    import("./pages/Network.tsx").then((m) => m.NetworkPage),
    import("./pages/Account.tsx").then((m) => m.AccountPage),
    import("./pages/Cycles.tsx").then((m) => m.CyclesPage),
    import("./pages/Playground.tsx").then((m) => m.PlaygroundPage),
    import("./pages/How.tsx").then((m) => m.HowPage),
  ]);
  const { CycleDetailPage } = await import("./pages/CycleDetail.tsx");
  const { Header, Footer } = await import("./components/Shell.tsx");
  for (const Page of pages) {
    const html = renderToStaticMarkup(<Page />);
    expect(html.length).toBeGreaterThan(100);
    expect(html).not.toMatch(/[–—]/);
    console.log(Page.name, html.length, html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 600));
  }
  console.log(renderToStaticMarkup(<CycleDetailPage id={3n} />).replace(/<[^>]+>/g, " ").replace(/\s+/g, " "));
  console.log(renderToStaticMarkup(<Header route={{ page: "home" }} />).replace(/<[^>]+>/g, " ").replace(/\s+/g, " "));
  console.log(renderToStaticMarkup(<Footer />).replace(/<[^>]+>/g, " ").replace(/\s+/g, " "));
});
