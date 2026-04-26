"use client";

import { useMemo } from "react";

/**
 * Parallax starfield that sits behind the Atlas canvas. Three depth layers
 * with progressively brighter / larger stars; the back two layers also
 * drift slowly horizontally to give the sense that the whole field is in
 * motion.
 *
 * Pure SVG with CSS keyframes — no JS animation loop, no per-frame React
 * work. Stars are placed with a *jittered grid* so every region of the
 * canvas reliably gets stars (a pure-random scatter clustered visibly when
 * the seed correlations were bad). Twinkle is one of 5 fixed-keyframe
 * variants per star with a randomised negative animation-delay, so we get
 * lots of motion variety without resorting to CSS variables inside
 * @keyframes (which can fail silently in some engines).
 */
interface AtlasStarfieldProps {
  className?: string;
}

interface Star {
  x: number;
  y: number;
  r: number;
  opacity: number;
  /** One of 5 twinkle classes (atlas-star-tw-0..4). */
  twinkleClass: string;
  /** Negative animation-delay so the loop is out of phase from t=0. */
  delay: number;
}

const VIEW_W = 1200;
const VIEW_H = 800;

/** Murmur3-like 32-bit string hash → [0, 1). Better mixing than FNV-1a for
 *  short, sequential salts, which avoids the clustered diagonal we saw
 *  with the previous PRNG. */
function seededRandom(key: string): number {
  let h = 0x811c9dc5 ^ key.length;
  for (let i = 0; i < key.length; i++) {
    h = Math.imul(h ^ key.charCodeAt(i), 0x5bd1e995);
    h ^= h >>> 13;
  }
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return ((h >>> 0) % 100_000) / 100_000;
}

/** Place `gridX × gridY` stars on a jittered grid covering the full canvas. */
function buildLayer(
  seed: string,
  gridX: number,
  gridY: number,
  rRange: [number, number],
  opacityRange: [number, number]
): Star[] {
  const stars: Star[] = [];
  const cellW = VIEW_W / gridX;
  const cellH = VIEW_H / gridY;
  for (let gy = 0; gy < gridY; gy++) {
    for (let gx = 0; gx < gridX; gx++) {
      const i = gy * gridX + gx;
      // Jitter ±90% of cell size so the grid is invisible but every cell
      // contributes a star (guarantees uniform spread).
      const jx = (seededRandom(`${seed}|x|${i}`) - 0.5) * cellW * 0.9;
      const jy = (seededRandom(`${seed}|y|${i}`) - 0.5) * cellH * 0.9;
      const x = (gx + 0.5) * cellW + jx;
      const y = (gy + 0.5) * cellH + jy;
      const r =
        rRange[0] +
        seededRandom(`${seed}|r|${i}`) * (rRange[1] - rRange[0]);
      const opacity =
        opacityRange[0] +
        seededRandom(`${seed}|o|${i}`) *
          (opacityRange[1] - opacityRange[0]);
      const twinkleIdx = Math.floor(seededRandom(`${seed}|t|${i}`) * 5);
      const delay = -seededRandom(`${seed}|d|${i}`) * 9;
      stars.push({
        x,
        y,
        r,
        opacity,
        twinkleClass: `atlas-star-tw-${twinkleIdx}`,
        delay,
      });
    }
  }
  return stars;
}

export function AtlasStarfield({ className }: AtlasStarfieldProps) {
  const layers = useMemo(
    () => ({
      back: buildLayer("atlas-stars-back", 14, 9, [0.4, 0.9], [0.25, 0.5]),
      mid: buildLayer("atlas-stars-mid", 10, 7, [0.7, 1.4], [0.4, 0.7]),
      front: buildLayer("atlas-stars-front", 6, 4, [1.1, 1.9], [0.65, 0.95]),
    }),
    []
  );

  return (
    <div className={className} aria-hidden="true">
      <style>{`
        @keyframes atlas-star-tw-0 { 0%,100% { opacity: 0.25; } 50% { opacity: 1;    } }
        @keyframes atlas-star-tw-1 { 0%,100% { opacity: 0.4;  } 50% { opacity: 0.95; } }
        @keyframes atlas-star-tw-2 { 0%,100% { opacity: 0.5;  } 50% { opacity: 0.85; } }
        @keyframes atlas-star-tw-3 { 0%,100% { opacity: 0.3;  } 50% { opacity: 0.9;  } }
        @keyframes atlas-star-tw-4 { 0%,100% { opacity: 0.6;  } 50% { opacity: 1;    } }
        .atlas-star-tw-0 { animation: atlas-star-tw-0 5s  ease-in-out infinite; }
        .atlas-star-tw-1 { animation: atlas-star-tw-1 7s  ease-in-out infinite; }
        .atlas-star-tw-2 { animation: atlas-star-tw-2 4s  ease-in-out infinite; }
        .atlas-star-tw-3 { animation: atlas-star-tw-3 8.5s ease-in-out infinite; }
        .atlas-star-tw-4 { animation: atlas-star-tw-4 6s  ease-in-out infinite; }

        @keyframes atlas-stars-back-drift {
          0%   { transform: translate(0px, 0px); }
          50%  { transform: translate(-14px, 5px); }
          100% { transform: translate(0px, 0px); }
        }
        @keyframes atlas-stars-mid-drift {
          0%   { transform: translate(0px, 0px); }
          50%  { transform: translate(10px, -4px); }
          100% { transform: translate(0px, 0px); }
        }
        .atlas-stars-back-layer {
          animation: atlas-stars-back-drift 95s ease-in-out infinite;
        }
        .atlas-stars-mid-layer {
          animation: atlas-stars-mid-drift 140s ease-in-out infinite;
        }
      `}</style>
      <svg
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        preserveAspectRatio="xMidYMid slice"
        className="h-full w-full"
        style={{ display: "block" }}
      >
        <g className="atlas-stars-back-layer">
          {layers.back.map((s, i) => (
            <circle
              key={`b-${i}`}
              cx={s.x}
              cy={s.y}
              r={s.r}
              fill="#a5b4fc"
              fillOpacity={s.opacity}
              className={s.twinkleClass}
              style={{ animationDelay: `${s.delay}s` }}
            />
          ))}
        </g>
        <g className="atlas-stars-mid-layer">
          {layers.mid.map((s, i) => (
            <circle
              key={`m-${i}`}
              cx={s.x}
              cy={s.y}
              r={s.r}
              fill="#e5e7eb"
              fillOpacity={s.opacity}
              className={s.twinkleClass}
              style={{ animationDelay: `${s.delay}s` }}
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
              fillOpacity={s.opacity}
              className={s.twinkleClass}
              style={{
                animationDelay: `${s.delay}s`,
                filter: "drop-shadow(0 0 2px rgba(255,255,255,0.5))",
              }}
            />
          ))}
        </g>
      </svg>
    </div>
  );
}
