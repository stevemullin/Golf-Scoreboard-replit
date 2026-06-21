import { useMemo, type CSSProperties } from "react";

const COLORS = [
  "#FFD700",
  "#FF6B6B",
  "#4ECDC4",
  "#45B7D1",
  "#A78BFA",
  "#34D399",
  "#F59E0B",
  "#EC4899",
];

// Lightweight, dependency-free confetti. Renders a viewport overlay of falling
// pieces that fade out; mount it briefly (the caller unmounts after a few
// seconds). pointer-events-none so it never blocks the UI underneath.
export function Confetti({ count = 140 }: { count?: number }) {
  const pieces = useMemo(
    () =>
      Array.from({ length: count }, (_, i) => ({
        i,
        left: Math.random() * 100,
        delay: Math.random() * 0.8,
        duration: 2.8 + Math.random() * 2.4,
        color: COLORS[i % COLORS.length],
        w: 6 + Math.random() * 7,
        rotate: Math.random() * 360,
        drift: (Math.random() - 0.5) * 160,
      })),
    [count],
  );

  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-50 overflow-hidden">
      {pieces.map((p) => (
        <span
          key={p.i}
          style={
            {
              position: "absolute",
              top: "-6%",
              left: `${p.left}%`,
              width: `${p.w}px`,
              height: `${p.w * 0.4}px`,
              backgroundColor: p.color,
              borderRadius: "1px",
              "--drift": `${p.drift}px`,
              "--rot": `${p.rotate}deg`,
              animation: `confetti-fall ${p.duration}s cubic-bezier(0.3,0.6,0.7,1) ${p.delay}s forwards`,
            } as CSSProperties
          }
        />
      ))}
      <style>{`
        @keyframes confetti-fall {
          0%   { opacity: 1; transform: translate(0, 0) rotate(0deg); }
          100% { opacity: 0; transform: translate(var(--drift), 106vh) rotate(var(--rot)); }
        }
      `}</style>
    </div>
  );
}

// Banner shown above the leaderboard once the tournament is Final. Handles a
// single champion or a tie (co-champions).
export function ChampionBanner({
  names,
  toPar,
}: {
  names: string[];
  toPar: number | null;
}) {
  const label = names.length > 1 ? "Co-Champions" : "Champion";
  const who = names.join(" & ");
  const score =
    toPar === null ? "" : toPar === 0 ? "E" : toPar > 0 ? `+${toPar}` : `${toPar}`;

  return (
    <div
      className="relative overflow-hidden rounded-xl border border-primary/40 bg-gradient-to-r from-primary/15 via-primary/5 to-primary/15 px-6 py-6 text-center shadow-lg"
      style={{ animation: "champion-pop 0.5s cubic-bezier(0.18,0.89,0.32,1.28) both" }}
    >
      <div className="text-xs font-bold uppercase tracking-[0.3em] text-primary/80">
        🏆 {label} 🏆
      </div>
      <div className="mt-2 text-3xl md:text-4xl font-extrabold tracking-tight text-foreground">
        {who}
      </div>
      {score && (
        <div className="mt-1 font-mono text-sm text-muted-foreground">
          Winning score: {score}
        </div>
      )}
      <style>{`
        @keyframes champion-pop {
          0%   { opacity: 0; transform: scale(0.92) translateY(-8px); }
          100% { opacity: 1; transform: scale(1) translateY(0); }
        }
      `}</style>
    </div>
  );
}
