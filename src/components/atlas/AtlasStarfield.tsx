"use client";

import { useMemo } from "react";

/**
 * Parallax starfield that sits behind the Atlas canvas. Three depth layers
 * with progressively brighter / larger stars; the back layer also drifts
 * slowly horizontally to give the sense that the whole field is in motion.
 *
 * Pure SVG with CSS keyframes — no JS animation loop, no per-frame React
 * work. Star positions are derived from a seeded PRNG so server and client
 * render the same DOM (no hydration mismatch).
 */
interface AtlasStarfieldProps {
  className?: string;
}

interface Star {
  x: number;
  y: number;
  r: number;
  baseOpacity: number;
  twinkleDur: number;
  twinkleDelay: number;
}

const VIEW_W = 1200;
const VIEW_H = 800;

/** Deterministic pseudo-random 0–1 from a string seed + numeric salt. */
function seededRandom(seed: string, salt: number): number {
  let h = 2166136261;
  const combined = `${seed}:${salt}`;
  for (let i = 0; i < combined.length; i++) {
    h ^= combined.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 100_000) / 100_000;
}

function buildLayer(
  seed: string,
  count: number,
  rRange: [number, number],
  opacityRange: [number, number],
  durRange: [number, number]
): Star[] {
  const stars: Star[] = [];
  for (let i = 0; i < count; i++) {
    const x = seededRandom(seed, i * 4) * VIEW_W;
    const y = seededRandom(seed, i * 4 + 1) * VIEW_H;
    const r =
      rRange[0] + seededRandom(seed, i * 4 + 2) * (rRange[1] - rRange[0]);
    const baseOpacity =
      opacityRange[0] +
      seededRandom(seed, i * 4 + 3) * (opacityRange[1] - opacityRange[0]);
    const twinkleDur =
      durRange[0] + seededRandom(seed, i * 4 + 7) * (durRange[1] - durRange[0]);
    const twinkleDelay = seededRandom(seed, i * 4 + 11) * twinkleDur * -1;
    stars.push({ x, y, r, baseOpacity, twinkleDur, twinkleDelay });
  }
  return stars;
}

export function AtlasStarfield({ className }: AtlasStarfieldProps) {
  const layers = useMemo(() => {
    return {
      back: buildLayer("atlas-stars-back", 80, [0.4, 0.9], [0.18, 0.4], [5, 9]),
      mid: buildLayer("atlas-stars-mid", 45, [0.7, 1.4], [0.3, 0.6], [4, 7]),
      front: buildLayer(
        "atlas-stars-front",
        18,
        [1.1, 1.9],
        [0.55, 0.85],
        [3.5, 6]
      ),
    };
  }, []);

  return (
    <div className={className} aria-hidden="true">
      <style>{`
        @keyframes atlas-star-twinkle {
          0%, 100% { opacity: var(--star-min, 0.2); }
          50%      { opacity: var(--star-max, 0.9); }
        }
        @keyframes atlas-stars-drift {
          0%   { transform: translate3d(0, 0, 0); }
          50%  { transform: translate3d(-10px, 2px, 0); }
          100% { transform: translate3d(0, 0, 0); }
        }
        .atlas-star {
          animation: atlas-star-twinkle var(--dur, 6s) ease-in-out infinite;
          animation-delay: var(--delay, 0s);
          will-change: opacity;
        }
        .atlas-star-layer-back {
          animation: atlas-stars-drift 90s ease-in-out infinite;
          will-change: transform;
        }
        .atlas-star-layer-mid {
          animation: atlas-stars-drift 140s ease-in-out infinite reverse;
          will-change: transform;
        }
      `}</style>
      <svg
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        preserveAspectRatio="xMidYMid slice"
        className="h-full w-full"
        style={{ display: "block" }}
      >
        <g className="atlas-star-layer-back">
          {layers.back.map((s, i) => (
            <circle
              key={`b-${i}`}
              cx={s.x}
              cy={s.y}
              r={s.r}
              fill="#a5b4fc"
              className="atlas-star"
              style={
                {
                  "--dur": `${s.twinkleDur}s`,
                  "--delay": `${s.twinkleDelay}s`,
                  "--star-min": s.baseOpacity * 0.35,
                  "--star-max": s.baseOpacity,
                } as React.CSSProperties
              }
            />
          ))}
        </g>
        <g className="atlas-star-layer-mid">
          {layers.mid.map((s, i) => (
            <circle
              key={`m-${i}`}
              cx={s.x}
              cy={s.y}
              r={s.r}
              fill="#e5e7eb"
              className="atlas-star"
              style={
                {
                  "--dur": `${s.twinkleDur}s`,
                  "--delay": `${s.twinkleDelay}s`,
                  "--star-min": s.baseOpacity * 0.4,
                  "--star-max": s.baseOpacity,
                } as React.CSSProperties
              }
            />
          ))}
        </g>
        <g>
          {layers.front.map((s, i) => (
            <circle
              key={`f-${i}`}
              cx={s.x}
              cy={s.y}
              r={s.r}
              fill="#ffffff"
              className="atlas-star"
              style={
                {
                  "--dur": `${s.twinkleDur}s`,
                  "--delay": `${s.twinkleDelay}s`,
                  "--star-min": s.baseOpacity * 0.5,
                  "--star-max": s.baseOpacity,
                  filter: "drop-shadow(0 0 2px rgba(255,255,255,0.45))",
                } as React.CSSProperties
              }
            />
          ))}
        </g>
      </svg>
    </div>
  );
}
