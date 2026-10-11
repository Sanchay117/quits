// Application root: starts chain polling and wallet tracking, and picks the page from the hash route.
import { useEffect, type MouseEvent } from "react";
import { Footer, Header, Main } from "./components/Shell.tsx";
import { startPolling } from "./lib/chainState.ts";
import { useScrollReveal } from "./lib/hooks.ts";
import { parseRoute, useHash, type Route } from "./lib/router.ts";
import { initWallet } from "./lib/wallet.ts";
import { AccountPage } from "./pages/Account.tsx";
import { CycleDetailPage } from "./pages/CycleDetail.tsx";
import { CyclesPage } from "./pages/Cycles.tsx";
import { HomePage } from "./pages/Home.tsx";
import { HowPage } from "./pages/How.tsx";
import { NetworkPage } from "./pages/Network.tsx";
import { PlaygroundPage } from "./pages/Playground.tsx";

function Page({ route }: { route: Route }) {
  switch (route.page) {
    case "home":
      return <HomePage />;
    case "network":
      return <NetworkPage />;
    case "account":
      return <AccountPage viewAs={route.viewAs} />;
    case "cycles":
      return <CyclesPage />;
    case "cycle":
      return <CycleDetailPage id={route.id} />;
    case "playground":
      return <PlaygroundPage />;
    case "how":
      return <HowPage />;
    case "not-found":
      return (
        <section className="section">
          <h1>Page not found</h1>
          <p>
            Nothing lives at <code>#/{route.path}</code>. <a href="#/">Go home</a>.
          </p>
        </section>
      );
  }
}

/** In-page anchors would clash with hash routing, so the skip link moves focus itself. */
function SkipLink() {
  const skip = (event: MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    document.getElementById("main")?.focus();
  };
  return (
    <a className="skip-link" href="#/" onClick={skip}>
      Skip to content
    </a>
  );
}

export function App() {
  const hash = useHash();
  const route = parseRoute(hash);

  useEffect(() => {
    const stop = startPolling();
    return stop;
  }, []);
  useEffect(() => {
    const untrack = initWallet();
    return untrack;
  }, []);
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [route.page]);
  useScrollReveal(route.page);

  return (
    <>
      <SkipLink />
      <Header route={route} />
      <Main>
        <Page route={route} />
      </Main>
      <Footer />
    </>
  );
}
