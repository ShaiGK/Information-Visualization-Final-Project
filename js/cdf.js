// View B: the GPU timing CDF (owner: Sam).
//
// One line per configuration (76 lines), drawn from data/views.json (via shared.loadData()).
//   x = GPU dispatch time in ms, log scale, because timings run from under 0.1 ms on fast
//       real GPUs to over 200 ms on the Windows VMs' software renderer.
//   y = cumulative share of that configuration's timing samples at or below x.
//   color = operating system (shared.osColor), the same in every view.
// A steep line means the device gives nearly the same time on every run (stable). Lines far
// apart mean the timing test can tell those devices apart.
//
// Each configuration's line is built from its 101 precomputed quantiles (q in views.json), so
// the browser never touches the raw samples. The warm-up run of each visit is already dropped (D2).
//
// Interactions:
//   * Hover near a line to raise it and see its device, GPU and timings (details on demand, I4).
//     The brush sits on top of the lines, so hover finds the nearest line from the mouse position.
//   * Drag across the x axis to brush a time range (I2). Configurations whose median time falls in
//     the range are selected, the rest fade (I3). Double-click or Escape clears it.
//   * The chart fires a "select" event with the selected config ids (or null when cleared), so the
//     shared selection event (I1) can pass it to the other views. chart.selected(ids) does the
//     reverse, highlighting a selection made in another view.
//
// Follows the Reusable Chart pattern (https://bost.ocks.org/mike/chart/), like scorecard.js.

((() => {

  function cdf() {
    // Fixed size so the view never changes size or moves while the user interacts with it.
    let width = 640;
    let height = 440;
    const margin = { top: 56, right: 28, bottom: 64, left: 72 };
    let xDomain = [0.05, 300];   // ms, log scale
    let configs = [];            // each config object from views.json
    let selected = null;         // Set of config ids, or null when nothing is selected
    const dispatcher = d3.dispatch("select");

    // Redraw hooks set once the chart is drawn.
    let restyle = () => {};
    let clearBrush = () => {};

    const median = d => d.q[50];
    const fmt = v => (v < 1 ? d3.format(".2f")(v) : v < 10 ? d3.format(".1f")(v) : d3.format(".0f")(v));
    const isSelected = d => !selected || selected.has(d.config);

    function chart(selection) {
      selection.each(function () {
        const container = d3.select(this).style("position", "relative");
        container.selectAll("*").remove();

        const innerW = width - margin.left - margin.right;
        const innerH = height - margin.top - margin.bottom;

        // clamp(true) keeps the few 0 ms samples (timer rounding on some Safari and Firefox
        // runs) at the left edge instead of breaking the log scale.
        const x = d3.scaleLog().domain(xDomain).range([0, innerW]).clamp(true);
        const y = d3.scaleLinear().domain([0, 1]).range([innerH, 0]);
        const xTicks = [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100, 200];
        const yTicks = [0, 0.25, 0.5, 0.75, 1];

        const svg = container.append("svg")
          .attr("viewBox", `0 0 ${width} ${height}`)
          .attr("width", width)
          .attr("height", height)
          .style("max-width", "100%")
          .style("height", "auto")
          .style("display", "block")
          .style("font-family", "inherit");

        svg.append("rect").attr("width", width).attr("height", height).attr("fill", "white");

        svg.append("text").attr("class", "cdf-title")
          .attr("x", margin.left).attr("y", 24)
          .attr("font-size", 17).attr("font-weight", 600).attr("fill", "#222")
          .text("GPU timing by configuration");
        svg.append("text").attr("class", "cdf-subtitle")
          .attr("x", margin.left).attr("y", 44)
          .attr("font-size", 12.5).attr("fill", "#555")
          .text("Each line is one device and browser. Steep = stable timing. Far apart = easy to tell apart.");

        const g = svg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);

        // Light gridlines.
        const grid = g.append("g").attr("class", "grid");
        grid.selectAll("line.h").data(yTicks).join("line")
          .attr("x1", 0).attr("x2", innerW)
          .attr("y1", d => y(d)).attr("y2", d => y(d))
          .attr("stroke", "#eee");
        grid.selectAll("line.v").data(xTicks).join("line")
          .attr("x1", d => x(d)).attr("x2", d => x(d))
          .attr("y1", 0).attr("y2", innerH)
          .attr("stroke", "#f3f3f3");

        g.append("g").attr("transform", `translate(0,${innerH})`)
          .call(d3.axisBottom(x).tickValues(xTicks).tickFormat(d3.format("~g")))
          .call(styleAxis);
        g.append("g")
          .call(d3.axisLeft(y).tickValues(yTicks).tickFormat(d3.format(".0%")))
          .call(styleAxis);

        svg.append("text")
          .attr("x", margin.left + innerW / 2).attr("y", height - 30)
          .attr("text-anchor", "middle").attr("font-size", 13).attr("fill", "#222")
          .text("GPU dispatch time (ms, log scale)");
        svg.append("text")
          .attr("transform", `translate(18,${margin.top + innerH / 2}) rotate(-90)`)
          .attr("text-anchor", "middle").attr("font-size", 13).attr("fill", "#222")
          .text("Share of timings at or below this time");
        svg.append("text").attr("class", "cdf-footnote")
          .attr("x", margin.left).attr("y", height - 10)
          .attr("font-size", 11).attr("fill", "#666")
          .text("Drag across the chart to select devices by median time. Double-click or Esc to clear.");

        // One line per configuration, from its quantiles.
        const line = d3.line()
          .x(d => x(d[0]))
          .y(d => y(d[1]))
          .curve(d3.curveMonotoneY);

        const lines = g.append("g").attr("class", "lines")
          .selectAll("path")
          .data(configs, d => d.config)
          .join("path")
          .attr("fill", "none")
          .attr("stroke-linejoin", "round")
          .attr("d", d => line(d.q.map((t, i) => [t, i / 100])));

        // Brush (I2), selecting configurations by median time.
        const brush = d3.brushX()
          .extent([[0, 0], [innerW, innerH]])
          .on("brush end", brushed);
        const brushG = g.append("g").attr("class", "brush").call(brush);
        brushG.select(".selection")
          .attr("fill", "#444").attr("fill-opacity", 0.06)
          .attr("stroke", "#444").attr("stroke-dasharray", "4 3");
        // Double-click clears, as in d3's brush examples.
        brushG.on("dblclick", () => brushG.call(brush.move, null));

        function brushed({ selection: extent, sourceEvent }) {
          // Ignore moves made by code (clearing or syncing), so we don't fire events in a loop.
          if (!sourceEvent) return;
          if (!extent) {
            selected = null;
          } else {
            const [lo, hi] = extent.map(px => x.invert(px));
            selected = new Set(configs.filter(d => median(d) >= lo && median(d) <= hi).map(d => d.config));
          }
          restyle();
          dispatcher.call("select", null, selected ? [...selected] : null);
        }
        clearBrush = () => brushG.call(brush.move, null);

        // Mouse position readout line for hover, under the tooltip.
        const hoverDot = g.append("circle").attr("r", 4.5)
          .attr("fill", "white").attr("stroke-width", 2)
          .style("pointer-events", "none").style("display", "none");

        // Color legend in the empty upper left, read from the shared color scale.
        const legend = g.append("g").attr("class", "legend").attr("transform", "translate(10,8)")
          .style("pointer-events", "none");
        legend.append("rect").attr("x", -6).attr("y", -8)
          .attr("width", 96).attr("height", shared.OS_ORDER.length * 18 + 6)
          .attr("fill", "white").attr("fill-opacity", 0.85).attr("stroke", "#ddd");
        const item = legend.selectAll("g.item").data(shared.OS_ORDER).join("g")
          .attr("class", "item").attr("transform", (d, i) => `translate(0,${i * 18 + 2})`);
        item.append("line").attr("x1", 0).attr("x2", 18)
          .attr("stroke", d => shared.osColor(d)).attr("stroke-width", 3);
        item.append("text").attr("x", 24).attr("y", 4).attr("font-size", 12).attr("fill", "#222")
          .text(d => d);

        // Tooltip, same look as the scorecard's.
        const tip = container.append("div").attr("class", "cdf-tooltip")
          .attr("role", "tooltip")
          .style("position", "absolute")
          .style("pointer-events", "none")
          .style("display", "none")
          .style("max-width", "250px")
          .style("padding", "8px 10px")
          .style("background", "rgba(255,255,255,0.97)")
          .style("border", "1px solid #888")
          .style("border-radius", "4px")
          .style("box-shadow", "0 2px 6px rgba(0,0,0,0.2)")
          .style("font-size", "13px")
          .style("line-height", "1.35")
          .style("color", "#222")
          .style("z-index", 10);

        function tooltipHtml(d) {
          return `<strong>${d.device}</strong>, ${d.browser}<br>` +
            `${d.os}, GPU ${d.gpu}<br>` +
            `Median <strong>${fmt(median(d))} ms</strong>` +
            ` (middle half ${fmt(d.q[25])} to ${fmt(d.q[75])} ms)<br>` +
            `${d.n_samples} timings from ${d.visits} visits`;
        }

        function showTip(d, px, py) {
          tip.html(tooltipHtml(d)).style("display", "block");
          const tipW = tip.node().offsetWidth;
          const tipH = tip.node().offsetHeight;
          const cw = container.node().clientWidth;
          let left = px + 14;
          let top = py + 14;
          if (left + tipW > cw) left = px - tipW - 14;
          if (left < 0) left = 0;
          if (top + tipH > height) top = py - tipH - 14;
          if (top < 0) top = 0;
          tip.style("left", left + "px").style("top", top + "px");
        }

        let hovered = null;

        // Hover (I4). The brush overlay catches mouse events, so find the line nearest to the
        // mouse: at the mouse's height, compare each line's time to the mouse's time on the log
        // scale. Only lines that are not faded out can be hovered.
        svg.on("mousemove", function (event) {
          const [mx, my] = d3.pointer(event, g.node());
          let best = null;
          if (mx >= 0 && mx <= innerW && my >= 0 && my <= innerH) {
            const i = Math.round(y.invert(my) * 100);
            const t = Math.log(x.invert(mx));
            let bestDist = Infinity;
            configs.forEach(d => {
              if (!isSelected(d)) return;
              const dist = Math.abs(Math.log(Math.max(d.q[i], xDomain[0])) - t);
              if (dist < bestDist) { bestDist = dist; best = d; }
            });
            // About 8 px on screen, so the tooltip only shows when the mouse is on a line.
            if (bestDist > 8 * (Math.log(xDomain[1] / xDomain[0]) / innerW)) best = null;
            if (best) {
              hoverDot.style("display", null)
                .attr("cx", x(best.q[i])).attr("cy", y(i / 100))
                .attr("stroke", shared.osColor(best.os));
              const [px, py] = d3.pointer(event, container.node());
              showTip(best, px, py);
            }
          }
          if (!best) {
            hoverDot.style("display", "none");
            tip.style("display", "none");
          }
          if (best !== hovered) {
            hovered = best;
            restyle();
          }
        }).on("mouseleave", function () {
          hovered = null;
          hoverDot.style("display", "none");
          tip.style("display", "none");
          restyle();
        });

        // Selected lines in color, the rest faded gray. The hovered line is thicker and on top.
        restyle = function () {
          lines
            .attr("stroke", d => isSelected(d) ? shared.osColor(d.os) : "#d0d0d0")
            .attr("stroke-opacity", d => isSelected(d) ? 0.85 : 0.6)
            .attr("stroke-width", d => d === hovered ? 3.5 : (selected && isSelected(d) ? 2 : 1.4));
          // Faded lines first, then selected, then the hovered line, so the important ones are on top.
          lines.sort((a, b) =>
            (isSelected(a) - isSelected(b)) || ((a === hovered) - (b === hovered)));
        };
        restyle();
      });
    }

    function styleAxis(axisGroup) {
      axisGroup.selectAll("text").attr("font-size", 12).attr("fill", "#444");
      axisGroup.selectAll("path, line").attr("stroke", "#888");
    }

    chart.width = function (_) {
      return arguments.length ? (width = +_, chart) : width;
    };
    chart.height = function (_) {
      return arguments.length ? (height = +_, chart) : height;
    };
    chart.xDomain = function (_) {
      return arguments.length ? (xDomain = _, chart) : xDomain;
    };
    // The configs array from views.json.
    chart.data = function (_) {
      return arguments.length ? (configs = _, chart) : configs;
    };
    // Highlight a selection made elsewhere (array of config ids, or null to clear). This clears
    // the brush, since the brush range no longer describes the selection.
    chart.selected = function (_) {
      if (!arguments.length) return selected ? [...selected] : null;
      selected = _ ? new Set(_) : null;
      clearBrush();
      restyle();
      return chart;
    };
    // Clear the selection here and tell every listener (used by the Escape key).
    chart.clear = function () {
      chart.selected(null);
      dispatcher.call("select", null, null);
      return chart;
    };
    // chart.on("select", ids => ...) is called when the user brushes or clears the brush.
    chart.on = function () {
      const value = dispatcher.on.apply(dispatcher, arguments);
      return value === dispatcher ? chart : value;
    };

    return chart;
  }

  // Draw into #cdf with the real data once it has loaded.
  const target = d3.select("#cdf");
  if (!target.empty()) {
    shared.loadData().then(data => {
      const chart = cdf().data(data.configs);
      target.call(chart);

      // Escape clears the brush and the selection.
      d3.select(window).on("keydown.cdf", event => {
        if (event.key === "Escape" && chart.selected()) chart.clear();
      });

      // Exposed so the shared selection event (I1) can link this view to the others.
      window.cdfChart = chart;
    }).catch(err => {
      console.error("CDF could not load data/views.json", err);
      target.append("p")
        .style("color", "#b00020")
        .text("The timing chart could not load its data. Serve the page with a local web server " +
              "(for example python3 -m http.server 8000) and reload.");
    });
  }

  window.cdf = cdf;

})());
