// Renders the consent-related UI to static HTML (no browser): the members table, the netting preview, the netting
// permissions card, the accept-all confirmation and the How page. Catches render errors and checks the copy.
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { solverInputFromState } from "../../../core/solver.ts";
import { InvoiceStatus } from "../../../core/state.ts";
import { addr, chainState, invoice, member, USDC } from "../lib/testState.ts";

const USD = (dollars: number) => BigInt(Math.round(dollars * 1_000_000));
const DASHES = /[–—]/;
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

const me = addr(0x5e);
const atlas = member({ address: addr(1), name: "Atlas Freight", deposit: USD(5), allowsAnySolver: true });
const bluebird = member({ address: addr(2), name: "Bluebird Packaging", deposit: USD(3), drawableBySubmitter: true });
const copper = member({ address: addr(3), name: "Copperline Electric", deposit: USD(4) });
const self = member({ address: me, name: "Ember Roasters", deposit: USD(2), drawableBySubmitter: true });
const invoices = [
  invoice(atlas.address, bluebird.address, USD(10), { id: 1n }),
  invoice(bluebird.address, copper.address, USD(10), { id: 2n }),
  invoice(copper.address, atlas.address, USD(6), { id: 3n }),
  invoice(copper.address, me, USD(8), { id: 4n }),
  invoice(me, atlas.address, USD(12.4), { id: 5n, status: InvoiceStatus.Pending }),
  invoice(me, bluebird.address, USD(3), { id: 6n, status: InvoiceStatus.Pending }),
];
const members = [atlas, bluebird, copper, self];
/** Read for the connected wallet `me`: Bluebird approved it, and its own deposit is always drawable by it. */
const forMe = chainState(members, invoices, me);
/** Read with no wallet connected: only members that allow anyone are drawable. */
const state = chainState(
  members.map((m) => ({ ...m, drawableBySubmitter: m.allowsAnySolver })),
  invoices,
  null,
);

beforeAll(() => {
  const listeners = { addEventListener() {}, removeEventListener() {} };
  (globalThis as Record<string, unknown>).window = {
    ...listeners,
    location: { search: "?network=local", hash: "", pathname: "/", hostname: "localhost" },
    matchMedia: () => ({ matches: false, ...listeners }),
  };
});

afterAll(() => {
  delete (globalThis as Record<string, unknown>).window;
});

/** The page modules read window.location when they load, so they are imported only after the stub is in place. */
async function usdcToken() {
  const { tokensOf } = await import("../lib/tokens.ts");
  const { activeNetwork } = await import("../lib/network.ts");
  const token = tokensOf(activeNetwork)[0];
  expect(token.address).toBe(USDC);
  return token;
}

describe("consent UI", () => {
  it("shows per member who may settle with its deposit", async () => {
    const { MembersTable } = await import("./Network.tsx");
    const html = renderToStaticMarkup(<MembersTable state={forMe} token={await usdcToken()} />);
    const rows = text(html);
    expect(rows).toMatch(/Atlas Freight .*Anyone/);
    expect(rows).toMatch(/Bluebird Packaging .*Approved, incl\. you/);
    expect(rows).toMatch(/Copperline Electric .*Approved only/);
    expect(rows).toMatch(/Ember Roasters .*You/);
    expect(html).not.toMatch(DASHES);
  });

  it("explains in one line which deposits the preview left out", async () => {
    const { NettingPreview } = await import("./Network.tsx");
    const { runSolver } = await import("../lib/netting.ts");
    const token = await usdcToken();
    const input = solverInputFromState(state, USDC);
    const html = renderToStaticMarkup(
      <NettingPreview state={state} token={token} input={input} netting={runSolver(input)} batchOnly={false} onBatch={() => {}} />,
    );
    // No wallet is connected in this render, so only "anyone" deposits count; Bluebird, Copperline and Ember are out.
    // Bluebird and Copperline owe on due invoices; Ember owes nothing due, so its deposit could not have helped.
    expect(text(html)).toContain("Left out: $7.00 in deposits of 2 members who allow only approved solvers.");
    expect(html).not.toMatch(DASHES);

    // Read for the connected wallet: Bluebird approved it, so only Copperline's deposit is left out.
    const mine = solverInputFromState(forMe, USDC);
    const forWallet = renderToStaticMarkup(
      <NettingPreview state={forMe} token={token} input={mine} netting={runSolver(mine)} batchOnly={false} onBatch={() => {}} />,
    );
    expect(text(forWallet)).toContain("Left out: $4.00 in deposits of 1 member who has not approved your wallet.");
  });

  it("refuses to offer a cycle too large for one transaction", async () => {
    const { NettingPreview } = await import("./Network.tsx");
    const { runSolver } = await import("../lib/netting.ts");
    const token = await usdcToken();
    const ring = Array.from({ length: 300 }, (_, i) =>
      invoice(addr(100 + (i % 3)), addr(100 + ((i + 1) % 3)), USD(1), { id: BigInt(i + 1) }),
    );
    const big = chainState([], ring, null);
    const input = solverInputFromState(big, USDC);
    const html = renderToStaticMarkup(
      <NettingPreview state={big} token={token} input={input} netting={runSolver(input)} batchOnly={false} onBatch={() => {}} />,
    );
    expect(text(html)).toContain("Too many invoices for one transaction");
    expect(text(html)).toContain("This cycle would clear 300 invoices, but settle() takes at most 256");
    expect(text(html)).toContain("Compute a 256-invoice cycle");
    expect(html).not.toContain("Settle on Arc");
  });

  it("renders the netting permissions card", async () => {
    const { Permissions } = await import("./account/Permissions.tsx");
    const html = renderToStaticMarkup(<Permissions state={forMe} me={me} />);
    expect(text(html)).toContain("Netting permissions");
    expect(text(html)).toContain("Let anyone settle cycles that use my deposit");
    expect(text(html)).toContain("settle just the debts you owe it and leave out what it owes you");
    expect(text(html)).toContain("Off: only you and the solvers you approve below.");
    expect(html).toContain('role="switch"');
    expect(html).not.toMatch(DASHES);
  });

  it("confirms exactly the invoices that were shown", async () => {
    const { AcceptAllConfirm } = await import("./account/InvoiceLists.tsx");
    const shown = invoices.filter((inv) => inv.status === InvoiceStatus.Pending);
    const later = invoice(me, copper.address, USD(1), { id: 9n, status: InvoiceStatus.Pending });
    const html = renderToStaticMarkup(
      <AcceptAllConfirm shown={shown} inbox={[...shown, later]} busy={false} onConfirm={() => {}} onCancel={() => {}} />,
    );
    expect(text(html)).toContain("Accept 2 invoices, #5 and #6, for $15.40?");
    expect(text(html)).toContain("Not included: #9, which arrived after you clicked Accept all.");
    expect(text(html)).toContain("Accept these 2");
    expect(html).not.toMatch(DASHES);
  });

  it("states the consent rule and the acknowledged limitations", async () => {
    const { HowPage } = await import("./How.tsx");
    const html = text(renderToStaticMarkup(<HowPage />));
    expect(html).toContain("Consent");
    expect(html).toContain("approved the sender with setSolver");
    expect(html).toContain("front-run");
    expect(html).toContain("throwaway addresses");
    expect(html).toContain("cannot be recovered");
    expect(html).toContain("pauses EURC");
    expect(html).not.toMatch(DASHES);
  });
});
