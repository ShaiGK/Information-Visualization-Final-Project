// Shared module for all three views.
//
// Everything the views have in common lives here so they stay consistent and never talk to
// each other directly:
//   * the operating system color scale (color means operating system in every view)
//   * loading data/views.json once
//   * the shared selection event (Sprint 2, I1), a d3.dispatch that every view listens to
//   * the shared operating system legend (Sprint 2, V4), drawn once above the views
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

  // ---------------------------------------------------------------------------------------------
  // Shared selection event (I1).
  //
  // A selection is an array of config ids (the `config` field in views.json), or null for "nothing
  // selected". An empty array is a selection that matched nothing (for example an empty brush). Any view can change it with shared.select(ids, source), where source names the view
  // that made the change. Every listener gets (ids, source), so a view can skip events it sent
  // itself. The views never call each other; they only talk through this dispatch.
  const dispatcher = d3.dispatch("select");
  let current = null;

  function select(ids, source) {
    current = ids ? [...ids] : null;
    dispatcher.call("select", null, current, source);
  }

  // Listen for selection changes. `name` keeps each listener separate (d3 dispatch namespaces),
  // so registering again under the same name replaces the old listener instead of adding one.
  function onSelect(name, callback) {
    dispatcher.on("select." + name, callback);
  }

  function selected() {
    return current ? [...current] : null;
  }

  // Connect a reusable chart to the shared selection. The chart must have
  //   chart.on("select", ids => ...)   fired when the user selects inside the chart, and
  //   chart.selected(ids)              to show a selection made somewhere else.
  // The CDF (view B) and the box plots (view C) both follow this contract.
  function link(name, chart) {
    chart.on("select.shared", ids => select(ids, name));
    onSelect(name, (ids, source) => {
      if (source !== name) chart.selected(ids);
    });
  }

  // Escape clears the selection in every view.
  d3.select(window).on("keydown.shared", event => {
    if (event.key === "Escape" && current) select(null, "keyboard");
  });

  // ---------------------------------------------------------------------------------------------
  // Shared operating system legend (V4).
  //
  // One legend for the whole page, so the views do not each need their own key and the colors are
  // always read from the same scale. Each entry is a button: clicking it selects every
  // configuration on that operating system in all views (through the selection event above), and
  // clicking it again clears the selection. `configs` is the configs array from views.json.
  function osLegend(selection, configs) {
    const counts = d3.rollup(configs, v => v.length, d => d.os);
    const idsByOs = d3.group(configs, d => d.os);
    let active = null;   // the OS whose button made the current selection, if any

    selection.selectAll("*").remove();
    selection.attr("role", "group").attr("aria-label", "Operating system color legend");

    selection.append("span").attr("class", "os-legend-title").text("OS:");

    const items = selection.selectAll("button.os-legend-item")
      .data(OS_ORDER.filter(os => counts.has(os)))
      .join("button")
      .attr("type", "button")
      .attr("class", "os-legend-item")
      .attr("title", os => `Select all ${counts.get(os)} ${os} configurations in every view (Esc clears)`)
      .on("click", (event, os) => {
        if (active === os) {
          select(null, "legend");
        } else {
          select(idsByOs.get(os).map(d => d.config), "legend");
          active = os;
          restyle();
        }
      });

    items.append("span").attr("class", "os-swatch")
      .style("background", os => osColor(os));
    items.append("span").attr("class", "os-name")
      .text(os => `${os} (${counts.get(os)})`);

    function restyle() {
      items
        .classed("active", os => os === active)
        .attr("aria-pressed", os => os === active ? "true" : "false");
    }

    // Any selection that did not come from this legend means no legend button is active anymore.
    onSelect("legend", (ids, source) => {
      if (source !== "legend" || !ids) active = null;
      restyle();
    });
    restyle();
  }

  window.shared = {
    OS_ORDER,
    osColor,
    loadData,
    select,
    onSelect,
    selected,
    link,
    osLegend
  };

  // Draw the shared legend into #os-legend (above the three views) once the data has loaded.
  // If loading fails, each view already shows its own error message, so nothing is added here.
  const legendTarget = d3.select("#os-legend");
  if (!legendTarget.empty()) {
    loadData()
      .then(data => osLegend(legendTarget, data.configs))
      .catch(err => console.error("OS legend could not load data/views.json", err));
  }

})());
