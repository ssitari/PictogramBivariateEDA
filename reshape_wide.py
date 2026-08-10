"""
reshape_wide.py
---------------
Long -> wide reshape of the state Democratic-share file.

Input  (663 rows = 51 states x 13 elections), columns:
    year, state, state_po, state_fips,
    candidatevotes, democratic_pct, democratic_pct_ave_1976_2024

Output (51 rows, one per state):
    state, state_po, state_fips, democratic_pct_ave_1976_2024,
    candidatevotes_1976, democratic_pct_1976,
    candidatevotes_1980, democratic_pct_1980, ... (through 2024)

Run:
    python reshape_wide.py State_Dem_pct_1976_2024.csv
"""

import sys
import pandas as pd

inp = sys.argv[1] if len(sys.argv) > 1 else "State_Dem_pct_1976_2024.csv"
out = sys.argv[2] if len(sys.argv) > 2 else "State_Dem_pct_wide.csv"

df = pd.read_csv(inp)
df.columns = [c.strip() for c in df.columns]

id_cols   = ["state", "state_po", "state_fips"]   # constant per state
value_cols = ["candidatevotes", "democratic_pct"] # vary by year -> pivot
avg_col   = "democratic_pct_ave_1976_2024"        # constant per state

# --- sanity check before reshaping -----------------------------------
years = sorted(df["year"].unique())
counts = df.groupby("state").size()
print(f"States: {df['state'].nunique()}   Elections: {len(years)} -> {years}")
odd = counts[counts != len(years)]
if not odd.empty:
    print("  ** WARNING: these states don't have exactly one row per year: **")
    print(odd.to_string())
    # also flag any duplicate (state, year) that would break the pivot
    d = df[df.duplicated(["state", "year"], keep=False)].sort_values(["state", "year"])
    if not d.empty:
        print("\n  Duplicate (state, year) rows:")
        print(d.to_string(index=False))
        sys.exit("Fix duplicates before reshaping.")

# --- pivot -----------------------------------------------------------
wide = df.pivot(index=id_cols, columns="year", values=value_cols)

# interleave columns as (votes_YYYY, pct_YYYY) pairs, in year order
ordered = []
for y in years:
    for v in value_cols:
        ordered.append((v, y))
wide = wide[ordered]
wide.columns = [f"{v}_{y}" for v, y in wide.columns]
wide = wide.reset_index()

# --- bring the per-state average back, placed right after the ids ----
avg = df.groupby(id_cols, as_index=False)[avg_col].first()
wide = avg.merge(wide, on=id_cols)
# reorder so avg sits just after state_fips
front = id_cols + [avg_col]
wide = wide[front + [c for c in wide.columns if c not in front]]

wide.to_csv(out, index=False)
print(f"\nWrote {len(wide)} rows x {wide.shape[1]} cols -> {out}")
print("First columns:", list(wide.columns[:6]), "...")
