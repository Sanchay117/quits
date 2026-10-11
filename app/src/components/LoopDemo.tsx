// A looping illustration of the idea: four businesses owe each other $100 around a circle. Paid one by one, $400 of
// cash moves; netted, the loop cancels and nothing moves. Pure CSS/SMIL animation, static under reduced motion.

const NODES = [
  { id: "EH", name: "Roaster", x: 64, y: 56 },
  { id: "BP", name: "Packaging", x: 256, y: 56 },
  { id: "KF", name: "Freight", x: 256, y: 184 },
  { id: "FC", name: "Cafes", x: 64, y: 184 },
] as const;

const R = 22;

/** Edge i runs from node i to node i+1, trimmed to the node rims. */
function edge(i: number) {
  const a = NODES[i];
  const b = NODES[(i + 1) % NODES.length];
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  const ux = dx / len;
  const uy = dy / len;
  const gap = R + 6;
  return {
    x1: a.x + ux * gap,
    y1: a.y + uy * gap,
    x2: b.x - ux * (gap + 4),
    y2: b.y - uy * (gap + 4),
    lx: (a.x + b.x) / 2 + uy * 16,
    ly: (a.y + b.y) / 2 - ux * 16,
  };
}

const LOOP = `M${NODES.map((n) => `${n.x},${n.y}`).join(" L")} Z`;

export function LoopDemo() {
  return (
    <figure className="loop-demo">
      <svg viewBox="0 0 320 240" role="img" aria-label="Four businesses each owe the next $100 around a loop. Paid one by one, $400 moves. Netted, the loop cancels and $0 moves.">
        <defs>
          <marker id="loop-head" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" className="loop-head" />
          </marker>
        </defs>
        {NODES.map((_, i) => {
          const e = edge(i);
          return (
            <g key={i} className="loop-edge" style={{ ["--i" as string]: i }}>
              <line x1={e.x1} y1={e.y1} x2={e.x2} y2={e.y2} pathLength={1} markerEnd="url(#loop-head)" />
              <text x={e.lx} y={e.ly} dy="0.35em">
                $100
              </text>
            </g>
          );
        })}
        <circle className="loop-coin" r="6">
          <animateMotion dur="2.2s" repeatCount="indefinite" path={LOOP} />
        </circle>
        {NODES.map((n) => (
          <g key={n.id} className="loop-node" transform={`translate(${n.x},${n.y})`}>
            <circle r={R} />
            <text className="loop-initials" dy="0.35em">
              {n.id}
            </text>
            <text className="loop-name" y={n.y < 120 ? -R - 9 : R + 17}>
              {n.name}
            </text>
          </g>
        ))}
      </svg>
      <figcaption className="loop-caption">
        <span className="loop-caption-gross">
          Paid one by one: <strong>$400</strong> moves
        </span>
        <span className="loop-caption-net">
          Netted: <strong>$0</strong> moves
        </span>
      </figcaption>
    </figure>
  );
}
