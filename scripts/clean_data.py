"""Flatten the raw BrowserStack SQLite dumps into Tableau-ready CSVs.

Reads   data/raw/*.db   (never modified)
Writes  data/clean/runs.csv            one row per test run (4,000)
        data/clean/run_tests_long.csv  one row per run x fingerprint test
        data/clean/test_values.csv     lookup: value id -> raw value
        data/clean/test_summary.csv    one row per test (how well it splits configs)
        data/clean/fingerprintjs_pro.csv  commercial FingerprintJS Pro baseline (mobile)

Run:  python3 scripts/clean_data.py
"""
import collections
import csv
import hashlib
import json
import math
import re
import sqlite3
import statistics
from pathlib import Path

DATA = Path(__file__).resolve().parent.parent / "data"
RAW = DATA / "raw"
OUT = DATA / "clean"

SOURCES = {
    "browserstack-2026-09-09.db": "desktop_sweep",
    "mobile-v0-2026-09-17.db": "mobile_sweep",
}

# Categorical fingerprint tests that end up in run_tests_long / test_summary.
TESTS = [
    "render_hash",
    "precision",
    "subnormal_mode",
    "webgpu_features",
    "webgpu_limits",
    "compile_messages",
    "webgl_renderer",
    "fpjs_visitor",
]

# The only run-level columns that differ between the 5 runs of a visit.
RUN_VARYING_NUMERIC = ["compile_baseline_ms", "compile_big_ms", "dispatch_gpu_ns_median",
                       "dispatch_wall_ms_median", "run_wall_ms"]
RUN_VARYING_LISTS = ["dispatch_gpu_ns_all", "dispatch_wall_ms_all", "atomic_traces"]


def short_hash(obj):
    return hashlib.sha1(json.dumps(obj, sort_keys=True).encode()).hexdigest()[:12]


def parse_config(nickname, notes):
    """Device attributes as requested from BrowserStack.

    These sit next to the self-reported values (user agent, reported_os), which
    often disagree: every Android says "Android 10; K", iPads claim to be Macs,
    iOS 26 reports "iPhone OS 18_7".
    """
    config = re.sub(r"_\d+$", "", nickname)
    visit_num = int(nickname.rsplit("_", 1)[1])
    req = json.loads(notes[notes.index("{"):])

    if "deviceName" in req:
        device_name = req["deviceName"]
        is_ios = req.get("browser") == "safari"
        os_family = "iOS" if is_ios else "Android"
        if "iPad" in device_name:
            os_family = "iPadOS"
        os_version = req["osVersion"]
        tablet = "iPad" in device_name or " Tab " in device_name
        device_type = "Tablet" if tablet else "Phone"
    else:
        os_family = "macOS" if req["os"] == "OS X" else "Windows"
        os_version = req["os_version"]
        device_name = f"{os_family} {os_version} VM"
        device_type = "Desktop"
    return config, visit_num, device_name, device_type, os_family, os_version


def parse_browser(ua):
    for name, pat in [("Edge", r"Edg/([\d.]+)"), ("Firefox", r"Firefox/([\d.]+)"),
                      ("Chrome", r"Chrome/([\d.]+)"), ("Safari", r"Version/([\d.]+)")]:
        m = re.search(pat, ua)
        if m:
            return name, m.group(1), int(m.group(1).split(".")[0])
    return "Unknown", "", None


def ua_platform(ua):
    m = re.search(r"\(([^)]*)\)", ua)
    return m.group(1) if m else ""


def load_runs():
    runs, fp_pro = [], []
    for db_name, source in SOURCES.items():
        con = sqlite3.connect(f"file:{RAW / db_name}?mode=ro", uri=True)
        con.row_factory = sqlite3.Row
        q = """select s.*, a.nickname, a.notes from submissions s
               join active_codes a using(code) order by s.id"""
        for r in con.execute(q):
            runs.append((source, r, json.loads(r["results"])))
        if source == "mobile_sweep":
            fp_pro = [dict(r) for r in con.execute("select * from fp_pro")]
    return runs, fp_pro


def build():
    raw_runs, fp_pro = load_runs()
    rows, tests_per_run = [], []

    for source, r, d in raw_runs:
        config, visit_num, device_name, device_type, os_family, os_version = \
            parse_config(r["nickname"], r["notes"])
        browser, browser_version, browser_major = parse_browser(r["user_agent"])
        fpc = d["fpjs"]["components"]
        prec = d["precision"]
        dt = d["dispatch_timing"]
        comp = d["compilation"]
        adapter = d["adapter_comparison"]
        oob = d["oob_uniform"]
        nav = json.loads(r["navigator_info"])
        gpu_arch = r["gpu_architecture"] or "(not reported)"

        run_id = f"{source}:{r['id']}"
        rows.append({
            "run_id": run_id,
            "source": source,
            "config": config,
            "visit_num": visit_num,
            "visit_id": r["visit_id"],
            "run_index": r["run_index"],
            "submitted_at": r["submitted_at"],
            "device_type": device_type,
            "device_name": device_name,
            "os_family": os_family,
            "os_version": os_version,
            "browser": browser,
            "browser_version": browser_version,
            "browser_major": browser_major,
            # Self-reported by the browser; kept because it often disagrees with the request.
            "reported_browser": r["reported_browser"],
            "reported_os": r["reported_os"],
            "ua_platform": ua_platform(r["user_agent"]),
            "navigator_platform": nav["platform"],
            "user_agent": r["user_agent"],
            "gpu_vendor": r["gpu_vendor"] or "(not reported)",
            "gpu_architecture": gpu_arch,
            # BrowserStack Windows VMs have no GPU; WebGPU runs on Microsoft WARP.
            "software_gpu": gpu_arch == "warp",
            "webgl_renderer": fpc["webGlBasics"]["value"]["rendererUnmasked"],
            "hardware_concurrency": fpc["hardwareConcurrency"]["value"],
            # FingerprintJS omits "value" when the browser doesn't expose an API.
            "screen_w": (fpc["screenResolution"].get("value") or [None])[0],
            "screen_h": (fpc["screenResolution"].get("value") or [None, None])[1],
            "device_memory_gb": fpc["deviceMemory"].get("value"),
            "webgpu_feature_count": len(d["test1"]["features"]),
            "subnormal_mode": prec["subnormal"]["mode"],
            "precision_trig": prec["trig"],
            "precision_logexp": prec["logExp"],
            "precision_power": prec["power"],
            "unreachable_warning": bool(comp["unreachable"]["messages"]),
            "compile_baseline_ms": comp["baseline"]["module_ms"],
            "compile_big_ms": comp["big"]["module_ms"],
            "timestamp_query_supported": dt["timestamp_query_supported"],
            "dispatch_gpu_ns_median": dt["gpu_ns_median"],
            "dispatch_gpu_ns_all": json.dumps(dt["gpu_ns_all"]),
            "dispatch_wall_ms_median": dt["wall_ms_median"],
            "dispatch_wall_ms_all": json.dumps(dt["wall_ms_all"]),
            "atomic_traces": json.dumps(d["atomic_workgroup_race"]["traces"]),
            "oob_behavior": oob["oob_behavior"],
            "oob_as_floats": json.dumps(oob["oob_as_floats"]),
            "multiple_gpus_detected": adapter["multiple_gpus_detected"],
            "run_wall_ms": d["timing"]["run_wall_ms"],
            "suite_wall_ms": d["timing"]["suite_wall_ms"],
            "fpjs_confidence": d["fpjs"]["confidence"]["score"],
        })
        tests_per_run.append((run_id, {
            "render_hash": d["render_hash"],
            "precision": {k: prec[k] for k in ("trig", "logExp", "power")},
            "subnormal_mode": prec["subnormal"]["mode"],
            "webgpu_features": sorted(d["test1"]["features"]),
            "webgpu_limits": d["test1"]["limits"],
            "compile_messages": [[m["type"], m["message"]] for k in comp for m in comp[k]["messages"]],
            "webgl_renderer": fpc["webGlBasics"]["value"]["rendererUnmasked"],
            "fpjs_visitor": d["fpjs"]["visitor_id"],
        }))

    # Give every distinct raw value a readable id ("render_hash-1" = most common).
    counts = {t: collections.Counter(short_hash(v[t]) for _, v in tests_per_run) for t in TESTS}
    raw_by_hash = {(t, short_hash(v[t])): v[t] for _, v in tests_per_run for t in TESTS}
    value_id = {(t, h): f"{t}-{i}" for t in TESTS
                for i, (h, _) in enumerate(counts[t].most_common(), start=1)}

    by_run = {row["run_id"]: row for row in rows}
    for run_id, vals in tests_per_run:
        for t in TESTS:
            by_run[run_id][f"{t}_id"] = value_id[(t, short_hash(vals[t]))]

    visits = build_visits(rows)

    long_rows = [{k: v[k] for k in (
        "config", "visit_id", "visit_num", "device_type", "device_name", "os_family",
        "os_version", "browser", "browser_major", "gpu_vendor", "gpu_architecture")}
        | {"test": t, "value_id": v[f"{t}_id"]} for v in visits for t in TESTS]

    # Lookup table for details-on-demand.
    value_rows = []
    for (t, h), vid in value_id.items():
        hits = [v for v in visits if v[f"{t}_id"] == vid]
        configs = {v["config"] for v in hits}
        raw = raw_by_hash[(t, h)]
        value_rows.append({"test": t, "value_id": vid, "n_visits": len(hits),
                           "n_configs": len(configs), "configs": "; ".join(sorted(configs)),
                           "raw_value": raw if isinstance(raw, str) else json.dumps(raw)})

    # Per-test summary: how many groups it makes and how stable it is.
    summary = []
    n_configs = len({v["config"] for v in visits})
    for t in TESTS:
        col = f"{t}_id"
        dist = collections.Counter(v[col] for v in visits)
        entropy = -sum(c / len(visits) * math.log2(c / len(visits)) for c in dist.values())
        per_config = collections.defaultdict(set)
        for v in visits:
            per_config[v["config"]].add(v[col])
        summary.append({
            "test": t,
            "distinct_values": len(dist),
            "entropy_bits": round(entropy, 3),
            "configs_total": n_configs,
            "configs_with_unique_value": sum(
                1 for c, vs in per_config.items()
                if all({cc for cc, vv in per_config.items() if v in vv} == {c} for v in vs)),
            "configs_stable_pct": round(100 * sum(len(s) == 1 for s in per_config.values()) / n_configs, 1),
        })

    for r in fp_pro:
        r["config"] = re.sub(r"_\d+$", "", r["label"])

    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "run_tests_long.csv").unlink(missing_ok=True)  # replaced by visit_tests_long.csv
    write_csv(OUT / "visits.csv", visits)
    write_csv(OUT / "runs.csv", rows)
    write_csv(OUT / "visit_tests_long.csv", long_rows)
    write_csv(OUT / "test_values.csv", sorted(value_rows, key=lambda r: (r["test"], -r["n_visits"])))
    write_csv(OUT / "test_summary.csv", sorted(summary, key=lambda r: -r["entropy_bits"]))
    write_csv(OUT / "fingerprintjs_pro.csv", fp_pro)
    print(f"{len(rows)} runs -> {len(visits)} visits, {n_configs} configs -> {OUT}")


def build_visits(rows):
    """Collapse the 5 runs of each visit into one row.

    Only timings and atomic traces differ between runs of a visit; every other
    column must be identical, and the script fails loudly if that ever stops
    being true. Numeric timings become the median over the 5 runs, with the
    per-run values kept in a *_runs column. List columns become a list of the
    5 per-run lists.
    """
    groups = collections.defaultdict(list)
    for r in rows:
        groups[r["visit_id"]].append(r)

    visits = []
    for runs in groups.values():
        runs.sort(key=lambda r: r["run_index"])
        visit: dict = {"n_runs": len(runs)}
        for col in runs[0]:
            if col in ("run_id", "run_index"):
                continue
            values = [r[col] for r in runs]
            if col in RUN_VARYING_NUMERIC:
                visit[col] = statistics.median(values)
                visit[f"{col}_runs"] = json.dumps(values)
            elif col in RUN_VARYING_LISTS:
                visit[col] = json.dumps([json.loads(v) for v in values])
            else:
                assert len(set(map(str, values))) == 1, f"{col} differs within visit {runs[0]['visit_id']}"
                visit[col] = values[0]
        # Median arrival position (0 = first) of each workgroup over all traces of all runs.
        traces = [t for r in runs for t in json.loads(r["atomic_traces"])]
        for wg in range(len(traces[0])):
            visit[f"atomic_wg{wg:02d}_median_pos"] = statistics.median(t.index(wg) for t in traces)
        visits.append(visit)
    return visits


def write_csv(path, rows):
    with open(path, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
        w.writeheader()
        w.writerows(rows)


if __name__ == "__main__":
    build()
