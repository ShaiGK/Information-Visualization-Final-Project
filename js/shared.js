// Shared module for all three views.
//
// Everything the views have in common lives here so they stay consistent and never talk to
// each other directly:
//   * the operating system color scale (color means operating system in every view)
//   * loading data/views.json once
//   * (Sprint 2, I1) the shared selection event, a d3.dispatch that every view listens to
//
// Load this after d3 and before any view file. It exposes one global, `shared`.

((() => {

  // Operating systems in the order legends list them. These match the `os` values in
  // data/views.json.
  const OS_ORDER = ["Android", "iOS", "iPadOS", "macOS", "Windows"];

  // Okabe-Ito colorblind-safe palette (https://jfly.uni-koeln.de/color/). iOS and iPadOS share
  // a blue family on purpose, since both are Apple mobile platforms, but differ in lightness.
  const OS_COLORS = {
    Android: "#009E73", // bluish green
    iOS:     "#0072B2", // blue
    iPadOS:  "#56B4E9", // sky blue
    macOS:   "#CC79A7", // reddish purple
    Windows: "#E69F00"  // orange
  };

  // Gray for any value not listed above, so a new or mislabeled OS stands out.
  const UNKNOWN_COLOR = "#999999";

  const osColor = d3.scaleOrdinal()
    .domain(OS_ORDER)
    .range(OS_ORDER.map(os => OS_COLORS[os]))
    .unknown(UNKNOWN_COLOR);

  // Load views.json once and hand every view the same promise.
  let dataPromise = null;
  function loadData() {
    if (!dataPromise) {
      dataPromise = d3.json("data/views.json");
    }
    return dataPromise;
  }

  window.shared = {
    OS_ORDER,
    osColor,
    loadData
  };

})());
