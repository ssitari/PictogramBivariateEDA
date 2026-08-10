/**
 * preprocess.js
 * -------------
 * Turns data/states-albers-10m.json into a normalized silhouette lookup for
 * use as scatterplot markers, plus a self-contained validation grid.
 *
 * The input topology is ALREADY PROJECTED (d3.geoAlbersUsa, 975x610 layout),
 * so every coordinate is planar screen space. That means:
 *   - the map renders with d3.geoPath() and NO projection
 *   - all area/centroid math here uses d3-polygon (planar), never d3-geo
 *     (spherical) -- the spherical versions would return garbage on these
 *     coordinates.
 *
 * Each state is centered on its area-weighted centroid and scaled so all 51
 * silhouettes enclose the same AREA (not the same bounding box: a thin state
 * and a chunky state with matching bboxes carry very different visual ink).
 *
 * Run:
 *   node preprocess.js
 * Outputs:
 *   data/state-silhouettes.json   { "01": { d, w, h, scale, cx, cy }, ... }
 *   validate-grid.html            51 labeled silhouettes, opens via file://
 */

import { readFileSync, writeFileSync } from "node:fs";
import * as topojson from "topojson-client";
import { geoPath } from "d3-geo";
import { polygonArea, polygonCentroid } from "d3-polygon";

// ---- normalization constants (twiddle and re-run) --------------------
const TARGET_AREA = 400; // px^2 enclosed by every silhouette (20x20 equivalent)
const PRECISION = 2; // decimal places in emitted path strings

// Drop outlying parts below this share of a state's total area. At marker
// size they are visual dust, but they inflate the bounding box badly --
// Alaska's 55 Aleutian specks span more than twice the mainland's width.
// The part-area distribution is bimodal with a clean gap here: everything
// worth keeping is >=1.3% (Michigan's UP 28.5%, Hawaii's islands, Rhode
// Island, Virginia, Massachusetts), everything droppable is <=0.7%.
// It also removes Delaware's degenerate zero-area part, which would
// otherwise produce a NaN centroid.
const MIN_PART_AREA_FRAC = 0.01;

// Multipart states can enclose the right AREA while sprawling across a huge
// bounding box -- Hawaii's 7 islands span 88x57 to enclose the same ink as
// Kansas's 28x15. Rather than compress the water between the islands (which
// would falsify the geometry), any silhouette wider or taller than
// MAX_EXTENT is scaled down as a whole until it fits.
//
// TRADEOFF: a capped state keeps true shape AND true inter-part spacing, but
// breaks the equal-area rule -- it carries proportionally less ink than the
// other markers. That is the deliberate choice here: geometric honesty over
// uniform visual weight.
//
// 50px sits just above Maryland's 48.7 (the widest ordinary state), so only
// genuinely sprawling states trip it. Currently Hawaii alone.
const MAX_EXTENT = 50;

const topo = JSON.parse(readFileSync("data/states-albers-10m.json", "utf8"));
const features = topojson.feature(topo, topo.objects.states).features;

/** Signed-area math on one polygon (ring[0] exterior, ring[1..] holes). */
function polygonStats(rings) {
  let area = 0;
  let cx = 0;
  let cy = 0;
  rings.forEach((ring, i) => {
    // d3-polygon wants an open ring; GeoJSON rings repeat the first point.
    const open = ring.slice(0, -1);
    const a = Math.abs(polygonArea(open));
    const c = polygonCentroid(open);
    const signed = i === 0 ? a : -a; // holes subtract
    area += signed;
    cx += c[0] * signed;
    cy += c[1] * signed;
  });
  return { area, cx: cx / area, cy: cy / area };
}

/** Parts of a state that survive the MIN_PART_AREA_FRAC filter. */
function keptParts(geom) {
  const polys = geom.type === "MultiPolygon" ? geom.coordinates : [geom.coordinates];
  const stats = polys.map((rings) => ({ rings, ...polygonStats(rings) }));
  const total = stats.reduce((s, p) => s + p.area, 0);
  const kept = stats.filter((p) => p.area / total >= MIN_PART_AREA_FRAC);
  return { kept, dropped: stats.length - kept.length };
}

/** Area-weighted centroid + total area across the kept parts. */
function featureStats(kept) {
  let area = 0;
  let cx = 0;
  let cy = 0;
  for (const p of kept) {
    area += p.area;
    cx += p.cx * p.area;
    cy += p.cy * p.area;
  }
  return { area, cx: cx / area, cy: cy / area };
}

/** Recentre on (cx,cy) and scale by s, returning a fresh MultiPolygon. */
function normalizeGeom(kept, cx, cy, s) {
  const map = (ring) => ring.map(([x, y]) => [(x - cx) * s, (y - cy) * s]);
  return {
    type: "MultiPolygon",
    coordinates: kept.map((p) => p.rings.map(map)),
  };
}

/** Bounding box of a normalized geometry, via the same planar path. */
function measure(geom) {
  const [[x0, y0], [x1, y1]] = path.bounds({ type: "Feature", geometry: geom, properties: {} });
  return { w: x1 - x0, h: y1 - y0, x0, y0, x1, y1 };
}

/** Factor (<=1) bringing a silhouette's bbox within MAX_EXTENT. */
function extentCap({ w, h }) {
  return Math.min(1, MAX_EXTENT / w, MAX_EXTENT / h);
}

// No projection: coordinates are already planar screen space.
const path = geoPath().pointRadius(1);

const lookup = {};
const rows = [];

for (const f of features) {
  const { kept, dropped } = keptParts(f.geometry);
  const { area, cx, cy } = featureStats(kept);

  // Equal-area scale first, then shrink as a whole if the bbox is too big.
  const equalArea = Math.sqrt(TARGET_AREA / area);
  const cap = extentCap(measure(normalizeGeom(kept, cx, cy, equalArea)));
  const scale = equalArea * cap;
  const geom = normalizeGeom(kept, cx, cy, scale);

  const d = path({ type: "Feature", geometry: geom, properties: {} }).replace(
    /-?\d+\.?\d*/g,
    (n) => String(+(+n).toFixed(PRECISION))
  );
  const { w, h, x0 } = measure(geom);

  if (!Number.isFinite(x0) || !Number.isFinite(area)) {
    throw new Error(`${f.properties.name} (${f.id}) produced a non-finite silhouette`);
  }

  lookup[f.id] = {
    name: f.properties.name,
    d,
    w: +w.toFixed(PRECISION),
    h: +h.toFixed(PRECISION),
    scale: +scale.toFixed(6),
    cx: +cx.toFixed(PRECISION), // centroid in the ORIGINAL map's screen space
    cy: +cy.toFixed(PRECISION),
    // Present only on capped states: share of TARGET_AREA the marker holds.
    inkFrac: cap < 1 ? +(cap * cap).toFixed(3) : undefined,
  };
  rows.push({ id: f.id, ...lookup[f.id], parts: kept.length, dropped, cap, srcArea: area });
}

writeFileSync("data/state-silhouettes.json", JSON.stringify(lookup, null, 0));

const capped = rows.filter((r) => r.cap < 1);

// ---- validation grid -------------------------------------------------
// Self-contained so it opens straight from file:// -- no server needed.
const sorted = [...rows].sort((a, b) => a.name.localeCompare(b.name));
const COLS = 9;
const CELL = 96;
const cells = sorted
  .map((r, i) => {
    const x = (i % COLS) * CELL + CELL / 2;
    const y = Math.floor(i / COLS) * CELL + CELL / 2 - 8;
    return `<g transform="translate(${x},${y})">
      <path d="${r.d}" />
      <text y="${CELL / 2 - 14}">${r.name}</text>
      <text y="${CELL / 2 - 4}" class="dim">${r.w.toFixed(0)}×${r.h.toFixed(0)}</text>
    </g>`;
  })
  .join("\n");

const widest = [...rows].sort((a, b) => b.w / b.h - a.w / a.h);
const ratioNote = `widest: ${widest[0].name} ${(widest[0].w / widest[0].h).toFixed(2)}:1 &middot; tallest: ${
  widest[widest.length - 1].name
} 1:${(widest[widest.length - 1].h / widest[widest.length - 1].w).toFixed(2)}`;

// Actual-marker-size strips: the real test of whether 10m resolution holds up.
// If these read as mush, run the topology through toposimplify before
// regenerating -- that decision belongs here, not after the interaction layer
// exists.
const strip = (scale) =>
  sorted
    .map((r, i) => {
      const x = (i % 17) * 34 + 17;
      const y = Math.floor(i / 17) * 34 + 17;
      return `<g transform="translate(${x},${y}) scale(${scale})"><path d="${r.d}" /></g>`;
    })
    .join("\n");

const SIZES = [
  [0.5, "50% &mdash; ~10px marker"],
  [0.75, "75% &mdash; ~15px marker"],
  [1, "100% &mdash; ~20px marker"],
];

writeFileSync(
  "validate-grid.html",
  `<!doctype html><meta charset="utf-8">
<title>Silhouette validation grid</title>
<style>
  body { font: 13px/1.4 system-ui, sans-serif; margin: 24px; background: #fff; color: #111; }
  h1 { font-size: 15px; font-weight: 600; margin: 0 0 4px; }
  h2 { font-size: 12px; font-weight: 600; margin: 28px 0 6px; color: #444; }
  p { color: #666; margin: 0 0 20px; }
  path { fill: #4a6fa5; stroke: #fff; stroke-width: .4; }
  text { text-anchor: middle; font: 9px system-ui, sans-serif; fill: #333; }
  text.dim { fill: #aaa; font-size: 8px; }
</style>
<h1>51 normalized state silhouettes &mdash; equal area (${TARGET_AREA}px&sup2;), centroid-anchored</h1>
<p>Anchor = area-weighted centroid at each cell center. Labels show normalized bbox. ${ratioNote}<br>
True geometry throughout &mdash; no spacing altered. ${
    capped.length
      ? capped
          .map(
            (r) =>
              `<b>${r.name}</b> is capped at ${MAX_EXTENT}px and so carries ${(
                r.cap *
                r.cap *
                100
              ).toFixed(0)}% of the standard ink.`
          )
          .join(" ")
      : "No state needed capping."
  }</p>
<svg width="${COLS * CELL}" height="${Math.ceil(sorted.length / COLS) * CELL}">
${cells}
</svg>

<h2>Legibility at real marker sizes &mdash; can you still name them?</h2>
${SIZES.map(
  ([s, label]) => `<div><p style="margin:10px 0 2px">${label}</p>
<svg width="${17 * 34}" height="${Math.ceil(sorted.length / 17) * 34}">${strip(s)}</svg></div>`
).join("\n")}
`
);

console.log(`Wrote ${rows.length} silhouettes -> data/state-silhouettes.json`);
console.log(`Validation grid -> validate-grid.html`);
console.log(
  `Dropped ${rows.reduce((s, r) => s + r.dropped, 0)} outlying parts across ` +
    `${rows.filter((r) => r.dropped).length} states.`
);
console.log(
  capped.length
    ? `Capped at ${MAX_EXTENT}px (true spacing kept, equal-area broken): ` +
        capped
          .map((r) => `${r.name} -> ${(r.cap * r.cap * 100).toFixed(0)}% of normal ink`)
          .join(", ")
    : "No states needed capping."
);
console.log("\nLargest and smallest normalized bounding boxes:");
console.table(
  [...rows]
    .sort((a, b) => b.w * b.h - a.w * a.h)
    .filter((_, i, arr) => i < 4 || i >= arr.length - 4)
    .map((r) => ({
      state: r.name,
      parts: r.parts,
      w: r.w,
      h: r.h,
      bboxArea: +(r.w * r.h).toFixed(0),
      // Capped states hold less than TARGET_AREA, so use their actual ink.
      fill: `${((TARGET_AREA * r.cap * r.cap * 100) / (r.w * r.h)).toFixed(0)}%`,
    }))
);
