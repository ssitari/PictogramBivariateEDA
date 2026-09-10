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
//  This file is read by BOTH halves of the tool -- app.js in the browser and
//  preprocess.js under Node -- so the topology is described once and only
//  once. Adapting the tool to new data should never mean editing either of
//  them. (Paths are resolved relative to the project root either way, so run
//  `node preprocess.js` from there.)
//
//  Geometry reaches the page as TWO files: the pre-projected TopoJSON drives
//  the choropleth, and preprocess.js derives the marker silhouettes from that
//  same topology. Regenerate after any change to the topology; never hand-edit
//  the silhouette file. app.js warns if the two fall out of step.

export const DATA_FILE       = './State_Dem_pct_wide.csv';
export const TOPOLOGY_FILE   = './data/states-albers-10m.json';
export const SILHOUETTE_FILE = './data/state-silhouettes.json';

// Object name inside the TopoJSON topology holding the geographies.
export const TOPOLOGY_OBJECT = 'states';

// Optional second object drawn as a single outline over the whole map -- the
// national border here. Set to null if the topology has no such object.
export const TOPOLOGY_OUTLINE_OBJECT = 'nation';

// Where each feature's identity lives in the topology. TopoJSON conventionally
// puts the key on the geometry itself (`f.id`), which is what null means here;
// plenty of files put it in properties instead, in which case name the property
// ("GEOID", "iso_a2", "code"). This value is what FEATURE_ID_FIELD in the CSV
// has to match, after ID_PAD_WIDTH below.
export const TOPOLOGY_ID_PROP = null;

// Property holding each feature's display name. us-atlas uses "name"; Natural
// Earth uses "NAME" or "ADMIN". If it doesn't resolve, the tool falls back to
// FEATURE_NAME_FIELD from the CSV.
export const TOPOLOGY_NAME_PROP = 'name';

// Singular noun for one unit of this geography. It carries the running copy on
// the page ("Marks are state silhouettes") as well as the console diagnostics,
// so a county or province instance reads correctly without touching markup.
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
//  PRESENTATION
// ============================================================
//
// The tool is generic; a published instance of it is not. Name what the
// reader is actually looking at rather than the machinery -- these set both
// the page heading and the browser tab title.

export const TITLE = 'Presidential Elections 1976–2024, Democratic Vote Share';
export const SUBTITLE =
  "Each scatterplot mark is the state's own outline, normalized to equal area.";

// Small credit line at the foot of the page. DATA_CREDIT names the source in
// passing; REPO_URL points at the repository, where the full formal citations
// (DOI, version, license) and the method notes live. Set REPO_URL to null to
// drop the link entirely.
export const DATA_CREDIT = 'MIT Election Data and Science Lab';
export const REPO_URL = 'https://github.com/ssitari/PictogramBivariateEDA';
export const REPO_LABEL = 'ssitari/PictogramBivariateEDA';

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

// A state's long-run average against its most recent result. Because both
// axes carry the same measure in the same unit, the app draws a 1:1
// reference line -- and here that line reads as "2024 versus its own
// historical norm": above it, the state ran ahead of its average; below,
// behind. Set X to democratic_pct_1976 instead to frame the whole series
// as endpoints and put the realignment on the diagonal (Arkansas and West
// Virginia fall ~30 points, Vermont climbs 23).
export const DEFAULT_VAR_X = 'democratic_pct_ave_1976_2024';
export const DEFAULT_VAR_Y = 'democratic_pct_2024';

// Bivariate color scheme — choose from BIVARIATE_SCHEMES in app.js:
//   'DkBlue_DkRed', 'DkViolet_DkGreen', 'DkCyan_DkBrown',
//   'GrPink', 'PurpleOrange', 'BlueTan', 'None'
//
// Cyan/Brown by default, NOT Blue/Red: on US election data a red-blue ramp
// reads as party affiliation, so a Republican-leaning state would appear
// red for reasons the legend never claims. Both axes here measure the same
// thing -- Democratic share -- so any party-coded palette would fight the
// encoding. Blue/Red stays available in the picker for data without that
// baggage.
export const DEFAULT_BIVARIATE_SCHEME = 'DkCyan_DkBrown';

// No-data fill. NOT a flat colour: it is drawn as a diagonal hatch, because
// the lowest cell of every bivariate scheme above is itself a pale grey
// (#e8e8e8 / #f3f3f3), and a grey null is then indistinguishable from a real
// low-low value -- on this dataset that cell already covers a third of the map.
// NULL_COLOR is the ground of the hatch, NULL_HATCH_COLOR the ruling over it.
export const NULL_COLOR = '#e3e2dd';
export const NULL_HATCH_COLOR = '#8f8e88';

// Color for selected features in the map overlay
export const SELECTION_COLOR = '#e07b39';

// Opacity for de-emphasised (non-selected) features
export const DEEMPHASIS_OPACITY = 0.2;

// ============================================================
//  MARKER GENERATION  (read by preprocess.js only)
// ============================================================
//
// Change any of these and re-run `node preprocess.js`, then open the
// validate-grid.html it writes: the small-size strips at the bottom are the
// only real test of whether the shapes still read.

// Area in px^2 enclosed by every silhouette -- 400 makes a typical unit about
// 20px across. Equal AREA, not equal bounding box: a thin unit and a chunky one
// with matching bboxes carry very different amounts of ink.
export const MARKER_TARGET_AREA = 400;

// Outlying parts below this share of a unit's total area are dropped. They are
// visual dust at marker size but wreck the bounding box: Alaska's 55 Aleutian
// specks span more than twice the mainland's width. Check the console output
// after running -- if the part-area distribution has no clean gap around this
// value, the threshold is being asked to make a judgement it can't.
export const MARKER_MIN_PART_AREA_FRAC = 0.01;

// A multipart unit can enclose the right area while sprawling across a huge
// bounding box (Hawaii's seven islands need 88x57 to hold the ink Kansas fits
// in 28x15). Rather than compress the space between parts, which would falsify
// the geometry, any silhouette exceeding this width or height is scaled down as
// a whole. Set it just above the widest ORDINARY unit -- 50 clears Maryland's
// 48.7 here, so only genuine sprawl trips it. preprocess.js prints what did.
//
// TRADEOFF: a capped unit keeps true shape and true spacing but breaks the
// equal-area rule, carrying proportionally less ink. Geometric honesty over
// uniform visual weight, deliberately.
export const MARKER_MAX_EXTENT = 50;

// ============================================================
//  MARKER SIZING  (read by app.js)
// ============================================================
//
// Silhouettes arrive from preprocess.js already normalized to MARKER_TARGET_AREA
// and centered on (0,0). MARKER_SCALE multiplies that on the page. Below ~0.4
// the shapes stop being recognizable, which defeats the entire point of the
// tool; above ~1.3 the plot becomes an unreadable pile in the dense middle.
export const MARKER_SCALE = 0.85;

// Silhouettes overlap heavily wherever states cluster, so each mark carries
// a ring that separates it from whatever sits beneath.
//
// The ring is grey rather than the surface white on purpose: the lightest
// cell of every bivariate scheme is near-white (#e8e8e8 or #f3f3f3), and a
// white-ringed pale mark on a white panel has no edge at all -- those states
// vanish. A grey ring both separates overlapping marks AND gives pale ones a
// visible outline.
export const MARKER_RING_WIDTH = 1.5;
export const MARKER_RING_COLOR = '#9c9b95';
