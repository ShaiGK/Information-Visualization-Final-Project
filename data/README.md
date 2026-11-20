# Data

The three views load one file, `views.json`. It is built from Sam's WebGPU fingerprinting runs on BrowserStack (a desktop sweep on 2026-09-09 with 28 configurations × 20 visits, and a mobile sweep on 2026-09-16 with 48 configurations × 5 visits). Every visit runs the test suite 5 times, so there are 76 configurations, 800 visits and 4,000 runs in total.

## Regenerating `views.json`

The raw and cleaned data are research data, so they are **not committed** (see `.gitignore`). To rebuild from scratch:

1. Download the two SQLite files from the team Drive folder **WebGPU Fingerprinting Data** into `data/raw/`:
   * `browserstack-2026-09-09.db` (desktop sweep)
   * `mobile-v0-2026-09-17.db` (mobile sweep)
2. Run these from the repository root (needs Python 3 with `pandas` and `numpy`):

   ```
   python3 scripts/clean_data.py   # data/raw/*.db -> data/clean/*.csv
   python3 scripts/build_data.py   # data/clean/visits.csv + test_summary.csv -> data/views.json
   ```

`clean_data.py` never modifies the raw files. It flattens them into one row per run (`runs.csv`) and one row per visit (`visits.csv`), and writes the supporting tables `visit_tests_long.csv`, `test_values.csv`, `test_summary.csv` and `fingerprintjs_pro.csv`. It checks that every test result is identical across the 5 runs of a visit and stops with an error if that ever stops being true. Only timing columns differ between runs, so `visits.csv` keeps their median plus the list of all 5 values.

## What is in `views.json`

```
{
  "configs": [ ...76 objects, one per device + OS + browser configuration... ],
  "tests":   [ ...8 objects, one per fingerprinting test... ]
}
```

Each **config** object:

| Field | Meaning | Used by |
|---|---|---|
| `config` | Unique id, e.g. `s26ultra_chrome` | All views (the key that selections share) |
| `sweep` | `desktop` or `mobile` | Tooltips |
| `device`, `os`, `browser`, `gpu` | Labels. `os` is the color encoding in every view | Tooltips, color, box plot groups |
| `visits` | Number of visits (20 desktop, 5 mobile) | Tooltips |
| `visit_ms` | Each visit's median GPU dispatch time in ms (warm-up run dropped) | Box plots (view C) |
| `q` | 101 quantiles (0%, 1%, …, 100%) of every GPU dispatch timing sample for this configuration, in ms (warm-up run dropped) | CDF (view B) |
| `n_samples` | How many timing samples `q` summarizes | Tooltips |
| `results` | For each test, the result id of every visit | Scorecard (view A), so it can be recomputed for any selection |

Each **test** object has `test` (id), `label` (display name), `baseline` (true for the WebGL renderer and FingerprintJS, which we compare against rather than evaluate), `distinct_values` (how many different results the test gives across all configurations) and `configs_stable_pct` (percent of configurations that give the same result on every visit).

## Known data issues

* The first of the five runs in a visit is a warm-up and is slower on average (about 9% on desktop and 40% on tablets). Since Sprint 2 (D2), `build_data.py` drops it (`WARMUP_RUNS = 1`), so `q` and `visit_ms` are built from runs 2 to 5 only (16,000 timing samples in all).
* Two mobile configurations (`s26ultra_chrome` and `iphone17promax_safari`) were run during the desktop sweep. Since Sprint 2 (D2), `clean_data.py` labels every run's `source` by device type, so they count as `mobile_sweep`. The database a run came from is kept in `source_db`, and each config in `views.json` has a `sweep` field (`desktop` or `mobile`).
* 102 of the 20,000 timing samples (on iOS Safari and macOS Firefox) are 0 ms because of timer rounding. They are kept, and the CDF's log scale clamps them to its left edge.
* The user agent fields are unreliable (iPads say they are Macs, iOS 26 says iOS 18), so device and OS labels come from the BrowserStack configuration, not the user agent.
