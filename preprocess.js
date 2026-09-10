/**
 * preprocess.js
 * -------------
 * Derives the scatterplot's marker silhouettes from the same TopoJSON that
 * draws the choropleth, plus a self-contained validation grid.
 *
 * Everything it needs to know about the topology comes from config.js -- the
 * same file app.js reads -- so adapting the tool to a new geography means
 * editing config.js and re-running this, and never editing either program.
 * Paths there are relative to the project root, so run it from there:
 *
 *   node preprocess.js
 *
 * Outputs:
 *   <SILHOUETTE_FILE>    { meta: {...}, shapes: { "01": { d, w, h, ... }, ... } }
 *   validate-grid.html   every silhouette labeled, plus strips at real marker
 *                        size; opens straight from file://
 *
 * THE ONE THING TO KNOW: the input topology must ALREADY BE PROJECTED, so its
 * coordinates are planar screen space rather than lon/lat. That is what lets a
 * unit's silhouette in the scatter be geometrically identical to its shape on
 * the map, and it means:
 *   - the map renders with d3.geoPath() and NO projection
 *   - all area and centroid math here uses d3-polygon (planar), never d3-geo
 *     (spherical) -- the spherical versions assume lon/lat and return garbage
 *     on projected coordinates
 * See the README for how to project a topology that isn't already.
 */

import { readFileSync, writeFileSync } from "node:fs";
import * as topojson from "topojson-client";
import { geoPath } from "d3-geo";
import { polygonArea, polygonCentroid } from "d3-polygon";

import {
  TOPOLOGY_FILE,
  SILHOUETTE_FILE,
  TOPOLOGY_OBJECT,
  TOPOLOGY_ID_PROP,
  TOPOLOGY_NAME_PROP,
  GEOGRAPHY_LABEL,
  MARKER_TARGET_AREA,
  MARKER_MIN_PART_AREA_FRAC,
  MARKER_MAX_EXTENT,
} from "./config.js";

const PRECISION = 2; // decimal places in emitted path strings

// No projection: coordinates are already planar screen space.
const path = geoPath().pointRadius(1);

const topo = JSON.parse(readFileSync(TOPOLOGY_FILE, "utf8"));
const object = topo.objects[TOPOLOGY_OBJECT];
if (!object) {
  throw new Error(
    `TOPOLOGY_OBJECT "${TOPOLOGY_OBJECT}" is not in ${TOPOLOGY_FILE}. ` +
      `It holds: ${Object.keys(topo.objects).join(", ")}`
  );
}
const features = topojson.feature(topo, object).features;

/** Feature identity, per TOPOLOGY_ID_PROP. Must match the padded CSV id. */
const idOf = (f) =>
  String(TOPOLOGY_ID_PROP ? (f.properties || {})[TOPOLOGY_ID_PROP] : f.id);

/** Display name, per TOPOLOGY_NAME_PROP. Undefined falls back to the CSV. */
const nameOf = (f) => (f.properties || {})[TOPOLOGY_NAME_PROP];

// A topology whose ids are all "undefined" joins to nothing, and the symptom
// (an empty map) points nowhere near the cause. Say so here instead.
const badIds = features.filter((f) => idOf(f) === "undefined").length;
if (badIds) {
  throw new Error(
    `${badIds} of ${features.length} features have no id. ` +
      (TOPOLOGY_ID_PROP
        ? `TOPOLOGY_ID_PROP is "${TOPOLOGY_ID_PROP}"; properties on the first feature are: ${Object.keys(
            features[0].properties || {}
          ).join(", ") || "(none)"}`
        : `TOPOLOGY_ID_PROP is null, so the feature's own \`id\` is used -- ` +
          `set it to a property name if this topology keys features that way.`)
  );
}

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

/** Parts of a unit that survive the MARKER_MIN_PART_AREA_FRAC filter. */
function keptParts(geom) {
  const polys = geom.type === "MultiPolygon" ? geom.coordinates : [geom.coordinates];
  const stats = polys.map((rings) => ({ rings, ...polygonStats(rings) }));
  const total = stats.reduce((s, p) => s + p.area, 0);
  const kept = stats.filter((p) => p.area / total >= MARKER_MIN_PART_AREA_FRAC);
  return { kept, dropped: stats.length - kept.length, parts: stats.length };
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

/** Factor (<=1) bringing a silhouette's bbox within MARKER_MAX_EXTENT. */
function extentCap({ w, h }) {
  return Math.min(1, MARKER_MAX_EXTENT / w, MARKER_MAX_EXTENT / h);
}

const shapes = {};
const rows = [];

for (const f of features) {
  const { kept, dropped } = keptParts(f.geometry);
  const { area, cx, cy } = featureStats(kept);
  const name = nameOf(f) || idOf(f);

  // Equal-area scale first, then shrink as a whole if the bbox is too big.
  const equalArea = Math.sqrt(MARKER_TARGET_AREA / area);
  const cap = extentCap(measure(normalizeGeom(kept, cx, cy, equalArea)));
  const scale = equalArea * cap;
  const geom = normalizeGeom(kept, cx, cy, scale);

  const d = path({ type: "Feature", geometry: geom, properties: {} }).replace(
    /-?\d+\.?\d*/g,
    (n) => String(+(+n).toFixed(PRECISION))
  );
  const { w, h, x0 } = measure(geom);

  if (!Number.isFinite(x0) || !Number.isFinite(area)) {
    throw new Error(`${name} (${idOf(f)}) produced a non-finite silhouette`);
  }

  shapes[idOf(f)] = {
    name,
    d,
    w: +w.toFixed(PRECISION),
    h: +h.toFixed(PRECISION),
    scale: +scale.toFixed(6),
    cx: +cx.toFixed(PRECISION), // centroid in the ORIGINAL map's screen space
    cy: +cy.toFixed(PRECISION),
    // Present only on capped units: share of MARKER_TARGET_AREA the marker holds.
    inkFrac: cap < 1 ? +(cap * cap).toFixed(3) : undefined,
  };
  rows.push({ id: idOf(f), ...shapes[idOf(f)], parts: kept.length, dropped, cap, srcArea: area });
}

// The meta block makes the file self-describing, which matters because two
// numbers in it are load-bearing on the other side: app.js sizes its hit radius
// from targetArea rather than hardcoding a constant that silently disagrees,
// and warns when `source` is not the topology it just loaded -- the signature
// of a silhouette file left over from a previous geography.
const meta = {
  generated: new Date().toISOString(),
  source: TOPOLOGY_FILE,
  object: TOPOLOGY_OBJECT,
  geographyLabel: GEOGRAPHY_LABEL,
  count: rows.length,
  targetArea: MARKER_TARGET_AREA,
  maxExtent: MARKER_MAX_EXTENT,
  minPartAreaFrac: MARKER_MIN_PART_AREA_FRAC,
};

writeFileSync(SILHOUETTE_FILE, JSON.stringify({ meta, shapes }, null, 0));

const capped = rows.filter((r) => r.cap < 1);

// ---- validation grid -------------------------------------------------
// Self-contained so it opens straight from file:// -- no server needed.
const sorted = [...rows].sort((a, b) => String(a.name).localeCompare(String(b.name)));
const COLS = Math.min(9, sorted.length);
const STRIP_COLS = Math.min(17, sorted.length);
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

// Actual-marker-size strips: the real test of whether the source resolution
// holds up. If these read as mush, run the topology through toposimplify before
// regenerating -- that decision belongs here, not after the interaction layer
// exists.
const strip = (scale) =>
  sorted
    .map((r, i) => {
      const x = (i % STRIP_COLS) * 34 + 17;
      const y = Math.floor(i / STRIP_COLS) * 34 + 17;
      return `<g transform="translate(${x},${y}) scale(${scale})"><path d="${r.d}" /></g>`;
    })
    .join("\n");

const side = Math.sqrt(MARKER_TARGET_AREA);
const SIZES = [
  [0.5, `50% &mdash; ~${(side * 0.5).toFixed(0)}px marker`],
  [0.75, `75% &mdash; ~${(side * 0.75).toFixed(0)}px marker`],
  [1, `100% &mdash; ~${side.toFixed(0)}px marker`],
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
<h1>${rows.length} normalized ${GEOGRAPHY_LABEL} silhouettes &mdash; equal area (${MARKER_TARGET_AREA}px&sup2;), centroid-anchored</h1>
<p>From ${TOPOLOGY_FILE}. Anchor = area-weighted centroid at each cell center.
Labels show normalized bbox. ${ratioNote}<br>
True geometry throughout &mdash; no spacing altered. ${
    capped.length
      ? capped
          .map(
            (r) =>
              `<b>${r.name}</b> is capped at ${MARKER_MAX_EXTENT}px and so carries ${(
                r.cap *
                r.cap *
                100
              ).toFixed(0)}% of the standard ink.`
          )
          .join(" ")
      : `No ${GEOGRAPHY_LABEL} needed capping.`
  }</p>
<svg width="${COLS * CELL}" height="${Math.ceil(sorted.length / COLS) * CELL}">
${cells}
</svg>

<h2>Legibility at real marker sizes &mdash; can you still name them?</h2>
${SIZES.map(
  ([s, label]) => `<div><p style="margin:10px 0 2px">${label}</p>
<svg width="${STRIP_COLS * 34}" height="${Math.ceil(sorted.length / STRIP_COLS) * 34}">${strip(s)}</svg></div>`
).join("\n")}
`
);

console.log(`Wrote ${rows.length} silhouettes -> ${SILHOUETTE_FILE}`);
console.log(`Validation grid -> validate-grid.html`);
console.log(
  `Dropped ${rows.reduce((s, r) => s + r.dropped, 0)} outlying parts across ` +
    `${rows.filter((r) => r.dropped).length} ${GEOGRAPHY_LABEL}s.`
);
console.log(
  capped.length
    ? `Capped at ${MARKER_MAX_EXTENT}px (true spacing kept, equal-area broken): ` +
        capped
          .map((r) => `${r.name} -> ${(r.cap * r.cap * 100).toFixed(0)}% of normal ink`)
          .join(", ")
    : `No ${GEOGRAPHY_LABEL}s needed capping.`
);
console.log("\nLargest and smallest normalized bounding boxes:");
console.table(
  [...rows]
    .sort((a, b) => b.w * b.h - a.w * a.h)
    .filter((_, i, arr) => i < 4 || i >= arr.length - 4)
    .map((r) => ({
      [GEOGRAPHY_LABEL]: r.name,
      parts: r.parts,
      w: r.w,
      h: r.h,
      bboxArea: +(r.w * r.h).toFixed(0),
      // Capped units hold less than MARKER_TARGET_AREA, so use their actual ink.
      fill: `${((MARKER_TARGET_AREA * r.cap * r.cap * 100) / (r.w * r.h)).toFixed(0)}%`,
    }))
);
