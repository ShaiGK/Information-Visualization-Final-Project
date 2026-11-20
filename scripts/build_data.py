"""Build data/views.json, the one file the three views load, from data/clean/visits.csv and test_summary.csv.

Run after scripts/clean_data.py:  python3 scripts/build_data.py
"""
import json
from pathlib import Path

import numpy as np
import pandas as pd

DATA = Path(__file__).resolve().parent.parent / "data"
v = pd.read_csv(DATA / "clean" / "visits.csv")
summary = pd.read_csv(DATA / "clean" / "test_summary.csv")

WARMUP_RUNS = 1  # how many runs at the start of each visit to drop from timing summaries

TESTS = ["webgpu_features", "webgpu_limits", "webgl_renderer", "precision", "render_hash",
         "compile_messages", "subnormal_mode", "fpjs_visitor"]
LABEL = {"webgpu_features": "WebGPU features", "webgpu_limits": "WebGPU limits",
         "webgl_renderer": "WebGL renderer", "precision": "Precision", "render_hash": "Render hash",
         "compile_messages": "Compile messages", "subnormal_mode": "Subnormal mode",
         "fpjs_visitor": "FingerprintJS ID"}

configs = []
for cfg, g in v.groupby("config", sort=False):
    g = g.sort_values("visit_num")
    first = g.iloc[0]
    os_ = first.os_family
    # Each visit runs the suite 5 times and the first run is a warm-up (slower on average, by
    # about 9% on desktop and 40% on tablets), so every timing summary skips it (D2).
    runs_kept = [json.loads(r)[WARMUP_RUNS:] for r in g.dispatch_gpu_ns_all]
    # Every GPU timing sample for this config, in ms, summarized as 101 quantiles for the CDF.
    samples = np.array([t for visit in runs_kept for run in visit for t in run]) / 1e6
    # One value per visit: the median of its kept runs' median dispatch times.
    visit_ms = [float(np.median(json.loads(r)[WARMUP_RUNS:])) / 1e6
                for r in g.dispatch_gpu_ns_median_runs]
    configs.append({
        "config": cfg,
        "device": first.device_name.replace(" VM", ""),
        "os": os_,
        "browser": first.browser,
        "sweep": "desktop" if first.source == "desktop_sweep" else "mobile",
        "gpu": f"{first.gpu_vendor} / {first.gpu_architecture}",
        "visits": int(len(g)),
        # One value per visit: that visit's median GPU dispatch time (ms) for the box plots.
        "visit_ms": [round(x, 3) for x in visit_ms],
        "q": [round(float(x), 3) for x in np.quantile(samples, np.linspace(0, 1, 101))],
        "n_samples": int(len(samples)),
        # Each visit's result id per test, so the scorecard can be recomputed for any brushed subset.
        "results": {t: g[f"{t}_id"].astype(str).tolist() for t in TESTS},
    })

tests = [{"test": t, "label": LABEL[t], "baseline": t in ("webgl_renderer", "fpjs_visitor"),
          **summary.set_index("test").loc[t, ["distinct_values", "configs_stable_pct"]].to_dict()}
         for t in TESTS]

(DATA / "views.json").write_text(json.dumps({"configs": configs, "tests": tests}))
print(len(configs), "configs")
