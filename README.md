# Pictogram Bivariate EDA

A bivariate choropleth linked to a brushable scatterplot, where **each scatter mark is
the silhouette of the geography it represents**, normalized so every unit encloses the
same area.

The map shows *where*; the scatterplot shows *how much*; and the mark itself shows
*which* — so a reader can identify Texas or Michigan in the scatter without a tooltip,
a legend lookup, or a hover.

The published instance plots US presidential election returns, 1976–2024. The tool
itself is data-agnostic: see [Adapting the tool](#adapting-the-tool-to-your-own-data).

---

## Live demo

[View on GitHub Pages](https://ssitari.github.io/PictogramBivariateEDA/)

---

## When this works, and when it doesn't

This is a deliberately narrow tool. It only works for **vernacular geographies** — ones
whose outlines a reader already carries in their head. US states are the sweet spot;
European countries might work; second-level administrative areas of an unfamiliar
country will not. Past that, the silhouette stops doing identification work and becomes
a noisy dot.

Three further limits worth knowing before you invest in an instance:

- **Feature count: roughly 20–150.** Every interaction rebuilds both views, which is
  imperceptible at 51 features and won't be at 500. More to the point, silhouettes
  overlap where data clusters, and past a couple of hundred marks the dense middle of
  the plot is a pile no ring width can rescue.
- **Desktop-first.** The layout reflows to one column on a phone, but the marks scale
  down with it — below about 10px the shapes stop being nameable, which is the whole
  premise. There is also no hover on touch. The table view is the small-screen path.
- **One outlier will squash the plot.** When both axes carry the same unit the tool
  shares one domain across them so the 1:1 line is a true 45°, and a single extreme
  value then compresses everything else. On this data DC sits at (90, 92) while 49
  states live between 26 and 68.

No named precedent turned up for this exact inversion — taking a geographic shape *off*
the map and making it do statistical work in an abstract coordinate space. The nearest
relatives are:

- **`ggmulti`** (R) — polygon glyph layers in scatterplots, but glyphs *on* maps
- **linked micromaps** / `micromapST` — statistical panels linked to small state maps
- **`loon`** (R) — custom polygon glyphs with linked brushing
- **Dorling cartograms** — distorting geographic shape to encode a statistic

## Running locally

The app loads ES modules and data via `fetch()`, so it must be served over HTTP —
opening `index.html` as a `file://` URL will not work.

```bash
python3 -m http.server 8000
# or
npx serve .
```

Then open `http://localhost:8000`.

`validate-grid.html` is the exception: it is self-contained and opens directly from
the file system.

## Architecture

Three files, with one rule between them:

- **`config.js`** — the only file you edit. Read by *both* halves of the tool.
- **`app.js`** — the visualization engine. Don't edit unless changing the tool itself.
- **`preprocess.js`** — the Node step that derives marker silhouettes from the topology.
  Don't edit either; it takes its settings from `config.js` too.

Everything on the page comes from `config.js`, including the heading, the panel captions
and the footer credit, so publishing a situated instance never means touching markup.

Diagnostics go to the browser console rather than onto the page, since a clean load is
the normal case. If something looks wrong, look there first — the messages name the
config key at fault.

---

## Adapting the tool to your own data

### 1. Get a **pre-projected** TopoJSON

This is the step that costs people the most time, so it comes first. The tool consumes
geometry whose coordinates are already planar screen space, not lon/lat — that is what
lets a unit's silhouette in the scatter be geometrically identical to its shape on the
map, and it means no projection is applied anywhere at runtime.

If you are mapping US states, this is done for you: use
[`us-atlas`](https://github.com/topojson/us-atlas), which ships pre-projected.

For anything else, project it yourself. Pick a projection suited to your area —
`geoAlbersUsa` is US-only, with the Alaska and Hawaii insets baked in:

```bash
# 1. project into a planar layout (numbers below suit a wide-ish map panel)
npx -p d3-geo-projection geoproject \
  'd3.geoConicConformal().parallels([35,65]).rotate([-10,0]).fitSize([975,610], d)' \
  < units.geojson > units-projected.json

# 2. wrap as TopoJSON. The name you give the object here is TOPOLOGY_OBJECT
npx -p topojson-server geo2topo units=units-projected.json > units-topo.json

# 3. optional but usually worth it: simplify and quantize
npx -p topojson-simplify toposimplify -p 0.5 -f < units-topo.json \
  | npx -p topojson-client topoquantize 1e5 > data/units-projected.json
```

The `fitSize` numbers only set the coordinate scale — the page derives its viewBox from
the topology's own bounds — but keeping them panel-shaped keeps the map from being
letterboxed.

If you also want a single outline drawn over the whole map (a national border, a
coastline), merge one into the same topology and name it in `TOPOLOGY_OUTLINE_OBJECT`.

### 2. Describe the topology in `config.js`

```js
export const TOPOLOGY_FILE = './data/units-projected.json';
export const TOPOLOGY_OBJECT = 'units';          // object holding the geographies
export const TOPOLOGY_OUTLINE_OBJECT = null;     // or 'nation', 'coast', ...
export const TOPOLOGY_ID_PROP = null;            // null = the feature's own `id`
export const TOPOLOGY_NAME_PROP = 'name';        // 'NAME', 'ADMIN', ...
export const GEOGRAPHY_LABEL = 'province';       // singular; carries the page copy
```

`TOPOLOGY_ID_PROP` matters: TopoJSON conventionally keys features by `id`, but plenty of
files put the key in `properties` instead. Get it wrong and `preprocess.js` stops and
tells you which properties the file actually has.

### 3. Generate the markers, then **look at them**

```bash
npm install          # topojson-client, d3-geo, d3-polygon (preprocessing only)
node preprocess.js
```

This writes the marker lookup named by `SILHOUETTE_FILE` and, next to it,
`validate-grid.html`. Open that file — this is the step not to skip. It shows every
silhouette labeled with its normalized bounding box, and then three strips at real
marker size. If you can't name the shapes in those strips, the tool will not work on
this geography, and it is much cheaper to learn that now than after wiring up data.

Tune with `MARKER_TARGET_AREA`, `MARKER_MIN_PART_AREA_FRAC` and `MARKER_MAX_EXTENT` in
`config.js`, re-running after each change. The console output tells you what tripped the
part filter and the extent cap.

### 4. Point at your data

```js
export const DATA_FILE = './my-data.csv';
export const FEATURE_ID_FIELD = 'geoid';     // CSV column matching the topology id
export const FEATURE_NAME_FIELD = 'name';    // fallback if TOPOLOGY_NAME_PROP misses
export const FEATURE_GROUP_FIELD = null;     // optional, shown in the tooltip
export const ID_PAD_WIDTH = 2;               // 0 for none — see the FIPS note below

export const VARIABLES = [
  { id: 'pop_density', label: 'People per km²', prop: 'dens',
    fmt: v => v.toFixed(0), unit: '/km²' },
  // ...
];
export const DEFAULT_VAR_X = 'pop_density';
export const DEFAULT_VAR_Y = 'median_rent';
```

One row per unit, all variables pre-computed and numeric. `prop` is the CSV column;
`unit` is what makes two variables comparable — variables sharing a unit get a shared
axis domain, a 1:1 reference line, and a change figure in the tooltip. Leave `unit` off
when that would be meaningless.

### 5. Situate the instance

`TITLE`, `SUBTITLE`, `DATA_CREDIT`, `REPO_URL` and `REPO_LABEL` set the heading, the tab
title and the footer credit. `DEFAULT_BIVARIATE_SCHEME` picks the palette; `NULL_COLOR`
and `NULL_HATCH_COLOR` set the no-data hatch. If you are deploying your own copy,
replace or delete the Cloudflare Analytics token at the bottom of `index.html`.

### 6. Open the console

A clean load says nothing. Otherwise you'll be told, by name:

- data rows with no matching geometry, and geometries with no data row
- variables whose `prop` isn't in the CSV header, or whose column is entirely blank
- a silhouette file generated from a different topology than the one being loaded

### Config reference

| Export | Read by | Purpose |
|---|---|---|
| `DATA_FILE` | app | CSV, one row per unit |
| `TOPOLOGY_FILE` | both | pre-projected TopoJSON |
| `SILHOUETTE_FILE` | both | generated marker lookup |
| `TOPOLOGY_OBJECT` | both | object holding the geographies |
| `TOPOLOGY_OUTLINE_OBJECT` | app | optional single outline over the map |
| `TOPOLOGY_ID_PROP` | both | `null` for `f.id`, else a property name |
| `TOPOLOGY_NAME_PROP` | both | property holding the display name |
| `GEOGRAPHY_LABEL` | both | singular noun; carries the page copy |
| `FEATURE_ID_FIELD` | app | CSV column matching the topology id |
| `FEATURE_NAME_FIELD` | app | CSV name column (fallback) |
| `FEATURE_GROUP_FIELD` | app | optional tooltip subtitle; `null` to omit |
| `ID_PAD_WIDTH` | app | zero-pad CSV ids to this width |
| `TITLE`, `SUBTITLE` | app | heading and tab title |
| `DATA_CREDIT`, `REPO_URL`, `REPO_LABEL` | app | footer credit |
| `VARIABLES` | app | mappable fields: `id`, `label`, `prop`, `fmt`, `unit` |
| `DEFAULT_VAR_X`, `DEFAULT_VAR_Y` | app | initial axes |
| `DEFAULT_BIVARIATE_SCHEME` | app | initial palette |
| `NULL_COLOR`, `NULL_HATCH_COLOR` | app | no-data hatch |
| `SELECTION_COLOR`, `DEEMPHASIS_OPACITY` | app | selection styling |
| `MARKER_TARGET_AREA` | preprocess | px² enclosed by every silhouette |
| `MARKER_MIN_PART_AREA_FRAC` | preprocess | drop outlying parts below this share |
| `MARKER_MAX_EXTENT` | preprocess | cap runaway bounding boxes |
| `MARKER_SCALE` | app | on-page multiplier for the generated size |
| `MARKER_RING_WIDTH`, `MARKER_RING_COLOR` | app | the ring separating overlapping marks |

### Three things that will cost you hours if you don't know them

**1. The topology must already be projected**, and once it is, spherical math is wrong
on it. Compute area and centroids with **`d3-polygon`** (`polygonArea`,
`polygonCentroid`), never `d3-geo`'s `geoArea` / `geoCentroid` — the spherical versions
assume lon/lat and return garbage on projected coordinates. `preprocess.js` already does
this; the trap is for anyone extending it.

**2. Numeric ids need zero-padding.** In this instance the TopoJSON keys states as
`"01"`, `"02"` while the CSV stores `1`, `2`. Unpadded, exactly **7 of 51** rows silently
fail to join — every single-digit FIPS (AL, AK, AZ, AR, CA, CO, CT). The other 44 join
fine, so it looks like it worked. `ID_PAD_WIDTH` handles it; set it to `0` for ids that
aren't numeric.

**3. Equal-area normalization is not enough on its own.** Two adjustments, both tunable
in `config.js`:

- `MARKER_MIN_PART_AREA_FRAC` (1%) drops outlying parts. Alaska ships 56 polygons — one
  mainland and 55 Aleutian specks that contribute almost no area but more than double
  the bounding box. The part-area distribution is cleanly bimodal, so 1% keeps
  everything that matters (Michigan's UP at 28.5%, Hawaii's islands, Rhode Island,
  Virginia, Massachusetts) and drops 137 parts that are visual dust. It also removes
  Delaware's degenerate zero-area part, which would otherwise poison its centroid
  with `NaN`.
- `MARKER_MAX_EXTENT` (50px) caps runaway footprints. Hawaii's seven islands need an
  88×57 box to enclose the same ink Kansas fits in 28×15. Rather than falsify the
  geometry by compressing the water between islands, the whole marker scales down until
  it fits — Hawaii keeps true shape *and* true spacing, and pays by carrying ~32% of the
  standard ink. Capped units record an `inkFrac` in the lookup.

**Hawaii is therefore the one state whose marker is not size-identical to its map
shape.** Every other state is.

---

## This instance

### Color and political data

The default scheme is **Cyan / Brown**, not Blue / Red. On US election data a red-blue
ramp reads as party affiliation, so a Republican-leaning state would appear red for
reasons the legend never claims — and here *both* axes measure the same quantity
(Democratic share), so a party-coded palette actively fights the encoding. Blue / Red
remains in the picker for data that doesn't carry that association.

The default axes pair each state's 1976–2024 average against its 2024 result, so the 1:1
line reads as "2024 versus its own historical norm". Setting X to `democratic_pct_1976`
instead frames the whole series as endpoints and puts the realignment on the diagonal —
Arkansas and West Virginia fall ~30 points, Vermont climbs 23.

### Interaction

- **Brush** the scatterplot to select; selected units stay lit on the map, and the
  rectangle stays put so you can adjust it
- **Click** a unit on the map to toggle it in or out of the selection
- **Hover** either view to trace the same unit in both

Clicking in the *scatter* clears the brush rather than toggling — the brush layer has
to sit above the marks (at this size a mark covers most drag origins), so hover there
is resolved by nearest anchor within a radius, and one gesture is not overloaded to
mean two things.

## Data sources and citations

### Election returns

> MIT Election Data and Science Lab. 2017. *U.S. President 1976–2024*. V10.0.
> Harvard Dataverse. <https://doi.org/10.7910/DVN/42MVDX>

State-level returns for 13 presidential elections × 51 jurisdictions (50 states plus
DC). Deposited 2017 and versioned forward as elections are added, so the title and
coverage change with each release — **cite the version you actually downloaded.**
Distributed under [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/),
Harvard Dataverse's default waiver; confirm on the landing page for your version.

Landing page:
<https://dataverse.harvard.edu/dataset.xhtml?persistentId=doi:10.7910/DVN/42MVDX>

Note the local raw file is named `1976-2020-president.csv` but contains all 13
elections **through 2024** — the upstream file name lags its coverage.
`reshape_wide.py` pivots the long file to one row per state, producing
`State_Dem_pct_wide.csv`, which is what the app reads. That script is specific to this
dataset; it is an example of step 4 above, not part of the tool.

### Geography

> Bostock, Mike. *us-atlas: Pre-built TopoJSON from the U.S. Census Bureau.*
> Version 3.0.1. ISC License. <https://github.com/topojson/us-atlas>

The file used is `states-albers-10m.json`, containing the `states` and `nation`
geometry collections — quantized, simplified, and projected with `d3.geoAlbersUsa`
to fit a 975×610 viewport, with Alaska and Hawaii insets already placed.

**The `-10m` in that file name is a display-resolution label, not the Census scale.**
The underlying shapefile is `cb_2017_us_state_5m`, the 1:5,000,000 cartographic
boundary file:

> U.S. Census Bureau. *Cartographic Boundary Shapefiles*, 2017 edition
> (`cb_2017_us_state_5m`). <https://www2.census.gov/geo/tiger/GENZ2017/shp/>

Census landing page:
<https://www.census.gov/geographies/mapping-files/time-series/geo/carto-boundary-file.html>

As a work of the U.S. federal government the Census source data is in the public
domain; Bostock's redistribution and build scripts are ISC-licensed.

### Software

> Bostock, Mike, et al. *D3.js.* v7.8.5. ISC License.
> <https://d3js.org> · <https://github.com/d3/d3>

Also `topojson-client` v3 (ISC) at runtime, plus `d3-geo`, `d3-polygon` and
`topojson-client` in the Node preprocessing step.

---

## Acknowledgements

Bivariate color schemes by [Joshua Stevens](https://www.joshuastevens.net/cartography/make-a-bivariate-choropleth-map/).

Most of the code written with assistance from [Claude](https://claude.ai) (Anthropic).

---

## License

MIT — see `LICENSE`. That covers the code in this repository. The election returns
(CC0 1.0), the Census geography (public domain), and the us-atlas redistribution
(ISC) each carry their own terms, cited above.
