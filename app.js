// ============================================================
//  app.js  —  visualization engine. Edit config.js, not this file.
// ============================================================
//
//  Two views over one join:
//    * a bivariate choropleth (states in true position)
//    * a scatterplot whose marks are the SAME state outlines
//
//  Both are drawn from one pre-projected TopoJSON, so a state's silhouette
//  in the scatter is geometrically identical to its shape on the map. That
//  identity is the whole conceit of the tool -- see README. (Hawaii is the
//  one exception: preprocess.js caps its size, so it carries less ink.)
//
//  The topology is ALREADY PROJECTED (d3.geoAlbersUsa, 975x610). Every
//  coordinate is planar screen space, so d3.geoPath() is used with NO
//  projection anywhere in this file.

import {
  TITLE, SUBTITLE,
  DATA_FILE, TOPOLOGY_FILE, SILHOUETTE_FILE, TOPOLOGY_OBJECT,
  GEOGRAPHY_LABEL, FEATURE_ID_FIELD, FEATURE_NAME_FIELD, FEATURE_GROUP_FIELD,
  ID_PAD_WIDTH, VARIABLES, DEFAULT_VAR_X, DEFAULT_VAR_Y,
  DEFAULT_BIVARIATE_SCHEME, NULL_COLOR, SELECTION_COLOR, DEEMPHASIS_OPACITY,
  MARKER_SCALE, MARKER_RING_WIDTH, MARKER_RING_COLOR,
} from './config.js';

// ============================================================
//  BIVARIATE COLOR SCHEMES  (9 colors, row-major: yClass*3 + xClass)
// ============================================================
const BIVARIATE_SCHEMES = {
  DkBlue_DkRed: {
    label: 'Blue / Red',
    colors: ['#e8e8e8','#e4acac','#c85a5a',
             '#b0d5df','#ad9ea5','#985356',
             '#64acbe','#627f8c','#574249'],
  },
  DkViolet_DkGreen: {
    label: 'Violet / Green',
    colors: ['#e8e8e8','#b5c0da','#6c83b5',
             '#b8d6be','#90b2b3','#567994',
             '#73ae80','#5a9178','#2a5a5b'],
  },
  DkCyan_DkBrown: {
    label: 'Cyan / Brown',
    colors: ['#e8e8e8','#e4d9ac','#c8b35a',
             '#accea4','#a3b18a','#8c8c5e',
             '#5ac8c8','#5dbfa3','#3b7a7a'],
  },
  GrPink: {
    label: 'Green / Pink',
    colors: ['#f3f3f3','#f0d0d8','#e8a0b0',
             '#cce5cc','#c8c8c0','#c09090',
             '#8fbc8f','#8fa880','#7a7060'],
  },
  PurpleOrange: {
    label: 'Purple / Orange',
    colors: ['#f3f3f3','#f1d28a','#e8a830',
             '#cdc5e0','#c8b070','#b87820',
             '#9e6fbc','#907050','#704020'],
  },
  BlueTan: {
    label: 'Blue / Tan',
    colors: ['#f3f3f3','#e0d4b8','#c8b070',
             '#b8cce0','#a8b8b0','#909060',
             '#5090c8','#508090','#405050'],
  },
  None: { label: 'None (grey)', colors: Array(9).fill('#c8c8c8') },
};

const bivIndex = (xClass, yClass) => yClass * 3 + xClass;

// ============================================================
//  STATE
// ============================================================
const state = {
  varX: DEFAULT_VAR_X,
  varY: DEFAULT_VAR_Y,
  scheme: DEFAULT_BIVARIATE_SCHEME,
  selectedIds: new Set(),
  hoverId: null,
};

let rows = [];        // joined records
let byId = new Map();
let borders, nation;  // topojson meshes

const varById = id => VARIABLES.find(v => v.id === id);
const padId = v => String(v).trim().padStart(ID_PAD_WIDTH, '0');
const $ = sel => document.querySelector(sel);

// Titles live in config.js so adapting the tool never means editing markup.
document.title = TITLE;
$('#titleText').textContent = TITLE;
$('#subtitleText').textContent = SUBTITLE;

// ============================================================
//  LOAD + JOIN
// ============================================================
Promise.all([
  d3.csv(DATA_FILE),
  d3.json(TOPOLOGY_FILE),
  d3.json(SILHOUETTE_FILE),
]).then(([csv, topo, silhouettes]) => {
  const object = topo.objects[TOPOLOGY_OBJECT];
  const features = topojson.feature(topo, object).features;
  borders = topojson.mesh(topo, object, (a, b) => a !== b);
  nation = topo.objects.nation
    ? topojson.feature(topo, topo.objects.nation)
    : null;

  const geomById = new Map(features.map(f => [String(f.id), f]));

  // The pad is load-bearing: unpadded, every single-digit FIPS misses.
  const missing = [];
  rows = csv.map(r => {
    const id = padId(r[FEATURE_ID_FIELD]);
    const geom = geomById.get(id);
    const sil = silhouettes[id];
    if (!geom || !sil) { missing.push(r[FEATURE_NAME_FIELD]); return null; }
    const rec = {
      id,
      name: sil.name || r[FEATURE_NAME_FIELD],
      group: FEATURE_GROUP_FIELD ? r[FEATURE_GROUP_FIELD] : null,
      geom,
      d: sil.d,
      values: {},
    };
    for (const v of VARIABLES) {
      const raw = r[v.prop];
      const num = raw === '' || raw == null ? null : +raw;
      rec.values[v.id] = Number.isFinite(num) ? num : null;
    }
    return rec;
  }).filter(Boolean);

  byId = new Map(rows.map(r => [r.id, r]));

  const unjoined = features.filter(f => !byId.has(String(f.id)));
  $('#status').textContent =
    `${rows.length} ${GEOGRAPHY_LABEL}s joined` +
    (missing.length ? ` · ${missing.length} data rows without geometry: ${missing.join(', ')}` : '') +
    (unjoined.length ? ` · ${unjoined.length} geometries without data` : '') +
    ` · source: ${DATA_FILE}`;

  buildControls();
  render();
});

// ============================================================
//  CLASSIFICATION — terciles per variable
// ============================================================
function terciles(varId) {
  const vals = rows.map(r => r.values[varId]).filter(v => v != null).sort(d3.ascending);
  return [d3.quantile(vals, 1 / 3), d3.quantile(vals, 2 / 3)];
}

function classOf(value, breaks) {
  if (value == null) return null;
  return value <= breaks[0] ? 0 : value <= breaks[1] ? 1 : 2;
}

function colorFor(rec, bx, by) {
  const cx = classOf(rec.values[state.varX], bx);
  const cy = classOf(rec.values[state.varY], by);
  if (cx == null || cy == null) return NULL_COLOR;
  return BIVARIATE_SCHEMES[state.scheme].colors[bivIndex(cx, cy)];
}

// ============================================================
//  CONTROLS
// ============================================================
function buildControls() {
  const fill = (sel, selected) => {
    sel.innerHTML = '';
    for (const v of VARIABLES) {
      const o = document.createElement('option');
      o.value = v.id; o.textContent = v.label;
      if (v.id === selected) o.selected = true;
      sel.appendChild(o);
    }
  };
  fill($('#varX'), state.varX);
  fill($('#varY'), state.varY);

  const schemeSel = $('#scheme');
  schemeSel.innerHTML = '';
  for (const [id, s] of Object.entries(BIVARIATE_SCHEMES)) {
    const o = document.createElement('option');
    o.value = id; o.textContent = s.label;
    if (id === state.scheme) o.selected = true;
    schemeSel.appendChild(o);
  }

  $('#varX').addEventListener('change', e => { state.varX = e.target.value; render(); });
  $('#varY').addEventListener('change', e => { state.varY = e.target.value; render(); });
  schemeSel.addEventListener('change', e => { state.scheme = e.target.value; render(); });
  $('#clearBtn').addEventListener('click', () => {
    state.selectedIds.clear(); render();
  });
  $('#tableBtn').addEventListener('click', e => {
    const wrap = $('#tableWrap');
    const show = wrap.hidden;
    wrap.hidden = !show;
    e.target.textContent = show ? 'Hide table' : 'Show table';
    e.target.setAttribute('aria-expanded', String(show));
  });
}

// ============================================================
//  RENDER
// ============================================================
function render() {
  const vx = varById(state.varX);
  const vy = varById(state.varY);
  const bx = terciles(state.varX);
  const by = terciles(state.varY);

  $('#scatterTitle').textContent = `${vy.label} vs ${vx.label}`;
  $('#mapTitle').textContent = `${vy.label} × ${vx.label}`;

  drawScatter(vx, vy, bx, by);
  drawMap(bx, by);
  drawLegend(vx, vy, bx, by);
  drawTable(vx, vy, bx, by);
}

// ---- scatterplot -----------------------------------------------------
function drawScatter(vx, vy, bx, by) {
  const W = 640, H = 560;
  const m = { top: 14, right: 18, bottom: 46, left: 56 };
  const iw = W - m.left - m.right;
  const ih = H - m.top - m.bottom;

  const svg = d3.select('#scatter')
    .attr('viewBox', `0 0 ${W} ${H}`)
    .attr('aria-label', `${vy.label} versus ${vx.label}`);
  svg.selectAll('*').remove();

  const xs = rows.map(r => r.values[state.varX]).filter(v => v != null);
  const ys = rows.map(r => r.values[state.varY]).filter(v => v != null);

  // When both axes carry the same unit, share one domain so the 1:1 line
  // is a true 45 degrees and "above the line" means "gained" honestly.
  const sameUnit = vx.unit === vy.unit;
  const pad = 0.06;
  const span = (arr) => {
    const [lo, hi] = d3.extent(arr); const g = (hi - lo) * pad;
    return [lo - g, hi + g];
  };
  const domX = sameUnit ? span(xs.concat(ys)) : span(xs);
  const domY = sameUnit ? domX : span(ys);

  const x = d3.scaleLinear().domain(domX).range([0, iw]).nice();
  const y = d3.scaleLinear().domain(domY).range([ih, 0]).nice();

  const g = svg.append('g').attr('transform', `translate(${m.left},${m.top})`);

  g.append('g').attr('class', 'grid')
    .selectAll('line').data(y.ticks(6)).join('line')
    .attr('x1', 0).attr('x2', iw).attr('y1', y).attr('y2', y);
  g.append('g').attr('class', 'grid')
    .selectAll('line').data(x.ticks(6)).join('line')
    .attr('y1', 0).attr('y2', ih).attr('x1', x).attr('x2', x);

  // 1:1 reference line — only meaningful on a shared domain.
  if (sameUnit) {
    const lo = Math.max(x.domain()[0], y.domain()[0]);
    const hi = Math.min(x.domain()[1], y.domain()[1]);
    g.append('line').attr('class', 'refline')
      .attr('x1', x(lo)).attr('y1', y(lo))
      .attr('x2', x(hi)).attr('y2', y(hi));
    // Sits below the line, not across it.
    g.append('text').attr('class', 'refline-label')
      .attr('x', x(hi) - 8).attr('y', y(hi) + 22).attr('text-anchor', 'end')
      .text('no change (1:1)');
  }

  g.append('g').attr('class', 'axis')
    .attr('transform', `translate(0,${ih})`).call(d3.axisBottom(x).ticks(6));
  g.append('g').attr('class', 'axis').call(d3.axisLeft(y).ticks(6));

  g.append('text').attr('class', 'axis-title')
    .attr('x', iw / 2).attr('y', ih + 38).attr('text-anchor', 'middle')
    .text(vx.label);
  g.append('text').attr('class', 'axis-title')
    .attr('transform', `rotate(-90)`)
    .attr('x', -ih / 2).attr('y', -42).attr('text-anchor', 'middle')
    .text(vy.label);

  const marksG = g.append('g');
  const hasSel = state.selectedIds.size > 0;

  const plotted = rows.filter(
    r => r.values[state.varX] != null && r.values[state.varY] != null
  );

  marksG.selectAll('path.mark')
    .data(plotted, d => d.id)
    .join('path')
    .attr('class', d => 'mark' + (hasSel && !state.selectedIds.has(d.id) ? ' dim' : ''))
    .attr('d', d => d.d)
    .attr('transform', d =>
      `translate(${x(d.values[state.varX])},${y(d.values[state.varY])}) scale(${MARKER_SCALE})`)
    .attr('fill', d => colorFor(d, bx, by))
    .attr('stroke', MARKER_RING_COLOR)
    .attr('stroke-width', MARKER_RING_WIDTH / MARKER_SCALE)
    .attr('paint-order', 'stroke')
    .attr('vector-effect', 'non-scaling-stroke')
    .attr('pointer-events', 'none');   // hit-testing happens on the brush layer

  // The brush must sit ABOVE the marks or a drag starting on a silhouette
  // would never begin a selection -- and with 51 marks this size, most of
  // the plot is covered by one. So the marks are inert and the brush
  // overlay resolves hover itself, by nearest anchor within HIT_RADIUS.
  // Anchors are area-weighted centroids, which is also what the marks are
  // positioned by, so "nearest anchor" and "the mark you are pointing at"
  // agree except in dense overlaps -- where no rule can do better.
  const brushG = g.append('g').attr('class', 'brush');
  const HIT_RADIUS = 22 * MARKER_SCALE;
  const tree = d3.quadtree()
    .x(d => x(d.values[state.varX]))
    .y(d => y(d.values[state.varY]))
    .addAll(plotted);

  const brush = d3.brush()
    .extent([[0, 0], [iw, ih]])
    .on('end', ev => {
      if (!ev.sourceEvent) return;
      if (!ev.selection) { state.selectedIds.clear(); render(); return; }
      const [[x0, y0], [x1, y1]] = ev.selection;
      state.selectedIds = new Set(
        plotted.filter(d => {
          const px = x(d.values[state.varX]);
          const py = y(d.values[state.varY]);
          return px >= x0 && px <= x1 && py >= y0 && py <= y1;
        }).map(d => d.id)
      );
      render();
    });
  brushG.call(brush);
  brushG.selectAll('.overlay')
    .attr('cursor', 'crosshair')
    .on('mousemove.hover', ev => {
      const [mx, my] = d3.pointer(ev);
      const hit = tree.find(mx, my, HIT_RADIUS);
      if (hit) {
        if (hit.id !== state.hoverId) { state.hoverId = hit.id; highlight(); }
        showTip(ev, hit);
      } else if (state.hoverId) {
        state.hoverId = null; highlight(); hideTip();
      } else {
        hideTip();
      }
    })
    .on('mouseleave.hover', () => {
      state.hoverId = null; highlight(); hideTip();
    });
}

// ---- choropleth ------------------------------------------------------
function drawMap(bx, by) {
  const W = 975, H = 610;
  const svg = d3.select('#map').attr('viewBox', `0 0 ${W} ${H}`);
  svg.selectAll('*').remove();

  // No projection: the topology is already in this coordinate space.
  const path = d3.geoPath();
  const hasSel = state.selectedIds.size > 0;

  svg.append('g').selectAll('path.map-state')
    .data(rows, d => d.id)
    .join('path')
    .attr('class', d => 'map-state' + (hasSel && !state.selectedIds.has(d.id) ? ' dim' : ''))
    .attr('d', d => path(d.geom))
    .attr('fill', d => colorFor(d, bx, by))
    .on('mouseenter', (ev, d) => { state.hoverId = d.id; highlight(); showTip(ev, d); })
    .on('mousemove', moveTip)
    .on('mouseleave', () => { state.hoverId = null; highlight(); hideTip(); })
    .on('click', (ev, d) => {
      if (state.selectedIds.has(d.id)) state.selectedIds.delete(d.id);
      else state.selectedIds.add(d.id);
      render();
    });

  if (borders) svg.append('path').attr('class', 'state-border').attr('d', path(borders));
  if (nation) svg.append('path').attr('class', 'nation-border').attr('d', path(nation));

  // Selected states get an outline that survives the de-emphasis wash.
  svg.append('g').selectAll('path.sel')
    .data(rows.filter(d => state.selectedIds.has(d.id)), d => d.id)
    .join('path')
    .attr('class', 'sel')
    .attr('d', d => path(d.geom))
    .attr('fill', 'none')
    .attr('stroke', SELECTION_COLOR)
    .attr('stroke-width', 1.6)
    .attr('pointer-events', 'none');

  svg.style('--dim', DEEMPHASIS_OPACITY);
  d3.select('#scatter').style('--dim', DEEMPHASIS_OPACITY);
  highlight();
}

// Cross-view emphasis: hovering either view outlines the same state in both.
function highlight() {
  d3.selectAll('#scatter path.mark, #map path.map-state')
    .classed('hl', d => d && d.id === state.hoverId)
    .filter(d => d && d.id === state.hoverId)
    .raise();
}

// ---- legend ----------------------------------------------------------
// Names the variables and shows the tercile break values, so the key can be
// read without consulting the controls. Truncation keeps a long variable
// label from stretching the panel.
function drawLegend(vx, vy, bx, by) {
  const S = 26, gap = 2;
  const size = S * 3 + gap * 2;
  const padL = 56, padB = 48, padT = 6, padR = 8;
  const W = padL + size + padR;
  const H = padT + size + padB;

  const svg = d3.select('#legendSvg')
    .attr('width', W).attr('height', H).attr('viewBox', `0 0 ${W} ${H}`);
  svg.selectAll('*').remove();

  const colors = BIVARIATE_SCHEMES[state.scheme].colors;
  const g = svg.append('g').attr('transform', `translate(${padL},${padT})`);

  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      // Row 0 is the TOP of the key = the HIGH class on Y.
      g.append('rect')
        .attr('x', c * (S + gap)).attr('y', r * (S + gap))
        .attr('width', S).attr('height', S)
        .attr('fill', colors[bivIndex(c, 2 - r)])
        .attr('stroke', 'rgba(0,0,0,.12)');
    }
  }

  // Wrap rather than truncate. A clipped label reading "…share, 1976–20."
  // looks like a real but WRONG year range, which is worse than no label.
  const wrap = (s, maxChars, maxLines = 2) => {
    const lines = [];
    let cur = '';
    for (const word of s.split(/\s+/)) {
      if (!cur) cur = word;
      else if ((cur + ' ' + word).length <= maxChars) cur += ' ' + word;
      else { lines.push(cur); cur = word; }
    }
    if (cur) lines.push(cur);
    if (lines.length > maxLines) {
      const kept = lines.slice(0, maxLines);
      kept[maxLines - 1] = kept[maxLines - 1].replace(/.{1}$/, '') + '…';
      return kept;
    }
    return lines;
  };

  const multiline = (sel, lines, x, y, dy = 10) =>
    lines.forEach((ln, i) =>
      sel.append('tspan').attr('x', x).attr('y', y + i * dy).text(ln));

  const tick = { 'font-size': 8, fill: '#898781' };

  // Break values at the class boundaries.
  bx.forEach((b, i) => {
    g.append('text')
      .attr('x', (i + 1) * (S + gap) - gap / 2).attr('y', size + 11)
      .attr('text-anchor', 'middle').attr('font-size', 8).attr('fill', tick.fill)
      .text(vx.fmt(b));
  });
  by.forEach((b, i) => {
    g.append('text')
      .attr('x', -5).attr('y', size - (i + 1) * (S + gap) + gap / 2 + 3)
      .attr('text-anchor', 'end').attr('font-size', 8).attr('fill', tick.fill)
      .text(vy.fmt(b));
  });

  const xLab = g.append('text')
    .attr('text-anchor', 'middle')
    .attr('font-size', 9).attr('font-weight', 600).attr('fill', '#52514e');
  multiline(xLab, wrap(vx.label + ' →', 24), size / 2, size + 25);

  const yLab = g.append('text')
    .attr('transform', 'rotate(-90)')
    .attr('text-anchor', 'middle')
    .attr('font-size', 9).attr('font-weight', 600).attr('fill', '#52514e');
  multiline(yLab, wrap(vy.label + ' →', 24), -size / 2, -42);
}

// ---- table view (relief channel; identity never color-alone) ----------
function drawTable(vx, vy, bx, by) {
  $('#thX').textContent = vx.label;
  $('#thY').textContent = vy.label;
  const names = ['low', 'mid', 'high'];
  const tbody = $('#dataTable tbody');
  tbody.innerHTML = '';

  const sorted = [...rows].sort((a, b) => d3.ascending(a.name, b.name));
  for (const r of sorted) {
    const cx = classOf(r.values[state.varX], bx);
    const cy = classOf(r.values[state.varY], by);
    const tr = document.createElement('tr');
    const label = cx == null || cy == null
      ? 'no data'
      : `X ${names[cx]} · Y ${names[cy]}`;
    tr.innerHTML =
      `<td>${r.name}${r.group ? ` <span style="color:#898781">(${r.group})</span>` : ''}</td>` +
      `<td class="num">${r.values[state.varX] == null ? '—' : vx.fmt(r.values[state.varX])}</td>` +
      `<td class="num">${r.values[state.varY] == null ? '—' : vy.fmt(r.values[state.varY])}</td>` +
      `<td><span class="swatch" style="background:${colorFor(r, bx, by)}"></span>${label}</td>`;
    tbody.appendChild(tr);
  }
}

// ---- tooltip ---------------------------------------------------------
function showTip(ev, d) {
  const vx = varById(state.varX), vy = varById(state.varY);
  const fx = d.values[state.varX], fy = d.values[state.varY];
  const delta = vx.unit === vy.unit && fx != null && fy != null
    ? `<div class="k">change: ${(fy - fx >= 0 ? '+' : '')}${(fy - fx).toFixed(1)}${vy.unit}</div>`
    : '';
  $('#tip').innerHTML =
    `<b>${d.name}</b>${d.group ? ` <span class="k">${d.group}</span>` : ''}` +
    `<div><span class="k">${vx.label}:</span> ${fx == null ? '—' : vx.fmt(fx)}</div>` +
    `<div><span class="k">${vy.label}:</span> ${fy == null ? '—' : vy.fmt(fy)}</div>` +
    delta;
  $('#tip').style.opacity = 1;
  moveTip(ev);
}
function moveTip(ev) {
  const t = $('#tip');
  const ox = 14, oy = 14;
  let left = ev.clientX + ox, top = ev.clientY + oy;
  const r = t.getBoundingClientRect();
  if (left + r.width > window.innerWidth) left = ev.clientX - r.width - ox;
  if (top + r.height > window.innerHeight) top = ev.clientY - r.height - oy;
  t.style.left = left + 'px';
  t.style.top = top + 'px';
}
function hideTip() { $('#tip').style.opacity = 0; }
