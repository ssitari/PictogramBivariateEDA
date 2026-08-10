# Pictogram Bivariate EDA — US States

A bivariate choropleth linked to a brushable scatterplot, where **each scatter mark is
the silhouette of the geography it represents**, normalized so every state encloses the
same area.

The map shows *where*; the scatterplot shows *how much*; and the mark itself shows
*which* — so a reader can identify Texas or Michigan in the scatter without a tooltip,
a legend lookup, or a hover.

## When this works, and when it doesn't

This is a deliberately narrow tool. It only works for **vernacular geographies** — ones
whose outlines a reader already carries in their head. US states are the sweet spot;
European countries might work; second-level administrative areas of an unfamiliar
country will not. Past that, the silhouette stops doing identification work and becomes
a noisy dot.

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

Same two-file pattern as the other choropleth tools in this collection:

- **`app.js`** — the visualization engine; do not edit unless changing the tool itself
- **`config.js`** — the only file to edit when adapting the tool to new data

`config.js` exports `DATA_FILE`, `TOPOLOGY_FILE`, `SILHOUETTE_FILE`, `TOPOLOGY_OBJECT`,
`GEOGRAPHY_LABEL`, `FEATURE_ID_FIELD`, `FEATURE_NAME_FIELD`, `FEATURE_GROUP_FIELD`,
`ID_PAD_WIDTH`, a `VARIABLES` array, and defaults for the two axes, the color scheme,
and marker sizing.

## Geometry pipeline

Both the map and the markers derive from **one** pre-projected TopoJSON, which is what
makes a state's silhouette in the scatter geometrically identical to its shape on the
map. Regenerate with:

```bash
npm install          # topojson-client, d3-geo, d3-polygon
node preprocess.js
```

This writes `data/state-silhouettes.json` (the marker lookup) and `validate-grid.html`
(a visual check: all 51 shapes labeled, plus strips at 10px, 15px and 20px to confirm
they stay recognizable at real marker size).

### Three things that will cost you hours if you don't know them

**1. The topology is already projected.** `states-albers-10m.json` from `us-atlas` has
been run through `d3.geoAlbersUsa().scale(1300).translate([487.5, 305])` for a 975×610
viewport, with Alaska and Hawaii insets already placed. Its coordinates are planar
screen space, not lon/lat. So:

- render with `d3.geoPath()` and **no projection**
- compute area and centroids with **`d3-polygon`** (`polygonArea`, `polygonCentroid`),
  never `d3-geo`'s `geoArea` / `geoCentroid` — the spherical versions assume lon/lat
  and return garbage on projected coordinates

**2. The FIPS join needs zero-padding.** The TopoJSON keys states as `"01"`, `"02"`;
the CSV stores `1`, `2`. Unpadded, exactly **7 of 51** rows silently fail to join —
every single-digit FIPS (AL, AK, AZ, AR, CA, CO, CT). The other 44 join fine, so it
looks like it worked. `ID_PAD_WIDTH` in `config.js` handles it.

**3. Equal-area normalization is not enough on its own.** Two adjustments, both tunable
constants at the top of `preprocess.js`:

- `MIN_PART_AREA_FRAC` (1%) drops outlying parts. Alaska ships 56 polygons — one
  mainland and 55 Aleutian specks that contribute almost no area but more than double
  the bounding box. The part-area distribution is cleanly bimodal, so 1% keeps
  everything that matters (Michigan's UP at 28.5%, Hawaii's islands, Rhode Island,
  Virginia, Massachusetts) and drops 137 parts that are visual dust. It also removes
  Delaware's degenerate zero-area part, which would otherwise poison its centroid
  with `NaN`.
- `MAX_EXTENT` (50px) caps runaway footprints. Hawaii's seven islands need an 88×57
  box to enclose the same ink Kansas fits in 28×15. Rather than falsify the geometry
  by compressing the water between islands, the whole marker scales down until it
  fits — Hawaii keeps true shape *and* true spacing, and pays by carrying ~32% of the
  standard ink. Capped states record an `inkFrac` in the lookup.

**Hawaii is therefore the one state whose marker is not size-identical to its map
shape.** Every other state is.

## Interaction

- **Brush** the scatterplot to select; selected states stay lit on the map
- **Click** a state on the map to toggle it in or out of the selection
- **Hover** either view to trace the same state in both

Clicking in the *scatter* clears the brush rather than toggling — the brush layer has
to sit above the marks (at this size a mark covers most drag origins), so hover there
is resolved by nearest anchor within a radius, and one gesture is not overloaded to
mean two things.

## Data

MIT Election Data and Science Lab, U.S. President state-level returns, 1976–2024
(13 elections × 51 jurisdictions). Note the raw file is named `1976-2020-president.csv`
but contains 2024.

`reshape_wide.py` pivots the long file to one row per state; `State_Dem_pct_wide.csv`
is what the app reads. Verify the dataset's current citation and terms of use at
Harvard Dataverse before redistributing.

## License

MIT — see `LICENSE`. The license covers the code; the election data carries its own
terms.
