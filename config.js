// ============================================================
//  config.js  —  Edit this file to use your own data
// ============================================================
//
//  This tool differs from ChoroplethEDABivariate in one way: the
//  scatterplot marks are silhouettes of the geographies themselves
//  rather than dots. That only works for VERNACULAR geographies whose
//  outlines a reader already recognizes -- US states, perhaps European
//  countries. It is not a general-purpose substitution for a dot.
//
//  Geometry is consumed from TWO derived files, both produced by
//  `node preprocess.js` from a single pre-projected TopoJSON:
//    TOPOLOGY_FILE   -> the choropleth
//    SILHOUETTE_FILE -> the scatterplot marks
//  Regenerate both together; never hand-edit the silhouette file.

export const DATA_FILE       = './State_Dem_pct_wide.csv';
export const TOPOLOGY_FILE   = './data/states-albers-10m.json';
export const SILHOUETTE_FILE = './data/state-silhouettes.json';

// Object name inside the TopoJSON topology holding the geographies.
export const TOPOLOGY_OBJECT = 'states';

export const GEOGRAPHY_LABEL  = 'state';
export const FEATURE_ID_FIELD = 'state_fips';
export const FEATURE_NAME_FIELD  = 'state';
export const FEATURE_GROUP_FIELD = 'state_po';  // shown in tooltip, null to omit

// The TopoJSON keys states by ZERO-PADDED 2-character FIPS ("01", "02"),
// but the CSV stores them as bare integers (1, 2). Unpadded, exactly 7 of
// 51 rows silently fail to join -- every state with a single-digit FIPS
// (AL, AK, AZ, AR, CA, CO, CT) -- which looks like success. Width 2 here.
export const ID_PAD_WIDTH = 2;

// ============================================================
//  VARIABLES
//  All mappable numeric fields. Any two can be chosen as X / Y.
// ============================================================

const pct = (label, prop) => ({
  id: prop,
  label,
  prop,
  fmt: v => v.toFixed(1) + '%',
  unit: '%',
});

const ELECTIONS = [
  1976, 1980, 1984, 1988, 1992, 1996, 2000,
  2004, 2008, 2012, 2016, 2020, 2024,
];

export const VARIABLES = [
  pct('Democratic share, 1976–2024 average', 'democratic_pct_ave_1976_2024'),
  ...ELECTIONS.map(y => pct(`Democratic share, ${y}`, `democratic_pct_${y}`)),
];

// ============================================================
//  DEFAULTS
// ============================================================

// The endpoints of the series: the realignment is the story. Arkansas and
// West Virginia fall ~30 points, Vermont climbs 23. Because both axes carry
// the same measure in the same unit, the app draws a 1:1 reference line.
export const DEFAULT_VAR_X = 'democratic_pct_1976';
export const DEFAULT_VAR_Y = 'democratic_pct_2024';

// Bivariate color scheme — choose from BIVARIATE_SCHEMES in app.js:
//   'DkBlue_DkRed', 'DkViolet_DkGreen', 'DkCyan_DkBrown',
//   'GrPink', 'PurpleOrange', 'BlueTan', 'None'
export const DEFAULT_BIVARIATE_SCHEME = 'DkBlue_DkRed';

// Color for features with null / no-data values
export const NULL_COLOR = '#d0d0d0';

// Color for selected features in the map overlay
export const SELECTION_COLOR = '#e07b39';

// Opacity for de-emphasised (non-selected) features
export const DEEMPHASIS_OPACITY = 0.2;

// ============================================================
//  MARKER SIZING
// ============================================================
//
// Silhouettes arrive from preprocess.js already normalized to a common
// area, centered on (0,0), in units where a typical state is ~20px across.
// MARKER_SCALE multiplies that. Below ~0.4 the shapes stop being
// recognizable, which defeats the entire point of the tool; above ~1.3
// the plot becomes an unreadable pile in the dense middle.
export const MARKER_SCALE = 0.85;

// Silhouettes overlap heavily wherever states cluster. Each mark carries a
// ring in the surface color so an overlapped outline stays separable.
export const MARKER_RING_WIDTH = 1.5;
