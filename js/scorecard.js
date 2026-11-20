// View A: the test scorecard.
//
// One point per WebGPU test, drawn from data/views.json (via shared.loadData()).
//   x = how many distinct results the test gives across all configurations (more distinct
//       results = the test splits devices into more groups). Log scale, because the counts run
//       from 2 to 128.
//   y = percent of configurations that give the same result on every visit (higher = more stable).
// Tests in the shaded top-right region are stable and good at splitting devices apart, so they
// are the ones worth writing up. The cutoffs for that region are our own judgment.
//
// The two baseline tests (WebGL renderer and FingerprintJS) are not tests we are evaluating, only
// things we compare against, so they get a different marker (hollow diamond).
//
// Hovering (or tabbing to) a point shows its exact values in a tooltip (details on demand).
//
// Follows the Reusable Chart pattern (https://bost.ocks.org/mike/chart/): scorecard() returns a
// closure with getter/setter methods and is drawn with d3.select(...).call(chart).

((() => {

  function scorecard() {
    // Fixed size so the view never changes size or moves while the user interacts with it.
    let width = 640;
    let height = 480;
    const margin = { top: 56, right: 28, bottom: 64, left: 72 };
    let xDomain = [1.5, 200];  // distinct results (log scale)
    let yDomain = [0, 110];    // percent stable, with headroom above 100 so labels fit
    // A test is "worth writing up" when it clears both cutoffs (our judgment, shown in the chart).
    let thresholds = { distinct: 15, stable: 85 };
    let points = [];           // each { test, label, distinct, stable, baseline }
    let totalConfigs = 0;      // how many configurations the percentages are out of
    let pointRadius = 7;

    // Where each label sits relative to its point (dx, dy in pixels). The default is to the
    // right. A few points are close together, so they get hand-placed labels to avoid overlap.
    let labelOffsets = {
      subnormal_mode:  { dx: -6,  dy: -11, anchor: "start" },
      compile_messages: { dx: 12,  dy: 4,   anchor: "start" },
      render_hash:     { dx: -12, dy: 4,   anchor: "end" },
      precision:       { dx: -6,  dy: 22,  anchor: "start" },
      fpjs_visitor:    { dx: -12, dy: 4,   anchor: "end" }
    };
    const defaultLabel = { dx: 12, dy: 4, anchor: "start" };

    const inRegion = d => d.distinct >= thresholds.distinct && d.stable >= thresholds.stable;

    function chart(selection) {
      selection.each(function () {
        // The container is the positioning parent for the tooltip.
        const container = d3.select(this).style("position", "relative");
        container.selectAll("*").remove();

        const innerW = width - margin.left - margin.right;
        const innerH = height - margin.top - margin.bottom;

        const x = d3.scaleLog().domain(xDomain).range([0, innerW]);
        const y = d3.scaleLinear().domain(yDomain).range([innerH, 0]);
        const xTicks = [2, 5, 10, 20, 50, 100, 200];
        const yTicks = [0, 20, 40, 60, 80, 100];

        const svg = container.append("svg")
          .attr("viewBox", `0 0 ${width} ${height}`)
          .attr("width", width)
          .attr("height", height)
          .style("max-width", "100%")
          .style("height", "auto")
          .style("display", "block")
          .style("font-family", "inherit");

        svg.append("rect").attr("class", "scorecard-bg")
          .attr("width", width).attr("height", height).attr("fill", "white");

        // Title and one-line "how to read this".
        svg.append("text").attr("class", "scorecard-title")
          .attr("x", margin.left).attr("y", 24)
          .attr("font-size", 17).attr("font-weight", 600).attr("fill", "#222")
          .text("Test scorecard");
        svg.append("text").attr("class", "scorecard-subtitle")
          .attr("x", margin.left).attr("y", 44)
          .attr("font-size", 12.5).attr("fill", "#555")
          .text("Each point is one WebGPU test. Top right = stable and good at telling devices apart.");

        const g = svg.append("g")
          .attr("transform", `translate(${margin.left},${margin.top})`);

        // Light gridlines under everything else.
        const grid = g.append("g").attr("class", "grid");
        grid.selectAll("line.h").data(yTicks).join("line")
          .attr("class", "h")
          .attr("x1", 0).attr("x2", innerW)
          .attr("y1", d => y(d)).attr("y2", d => y(d))
          .attr("stroke", "#eee");
        grid.selectAll("line.v").data(xTicks).join("line")
          .attr("class", "v")
          .attr("x1", d => x(d)).attr("x2", d => x(d))
          .attr("y1", 0).attr("y2", innerH)
          .attr("stroke", "#f3f3f3");

        // Shaded "worth writing up" region in the top right.
        const regionX = x(thresholds.distinct);
        const regionY = y(thresholds.stable);
        g.append("rect").attr("class", "worth-region")
          .attr("x", regionX).attr("y", 0)
          .attr("width", innerW - regionX).attr("height", regionY)
          .attr("fill", "#2a7f62").attr("fill-opacity", 0.1)
          .attr("stroke", "#2a7f62").attr("stroke-opacity", 0.5)
          .attr("stroke-dasharray", "5 4");
        g.append("text").attr("class", "worth-label")
          .attr("x", innerW - 8).attr("y", 16)
          .attr("text-anchor", "end")
          .attr("font-size", 12).attr("font-weight", 600).attr("fill", "#1d5e48")
          .text("Worth writing up");

        // Axes.
        g.append("g").attr("class", "x-axis")
          .attr("transform", `translate(0,${innerH})`)
          .call(d3.axisBottom(x).tickValues(xTicks).tickFormat(d3.format("d")))
          .call(styleAxis);
        g.append("g").attr("class", "y-axis")
          .call(d3.axisLeft(y).tickValues(yTicks).tickFormat(d => d + "%"))
          .call(styleAxis);

        // Axis labels.
        svg.append("text").attr("class", "x-label")
          .attr("x", margin.left + innerW / 2).attr("y", height - 30)
          .attr("text-anchor", "middle").attr("font-size", 13).attr("fill", "#222")
          .text("Distinct results across configurations (log scale; more = splits devices better)");
        svg.append("text").attr("class", "y-label")
          .attr("transform", `translate(18,${margin.top + innerH / 2}) rotate(-90)`)
          .attr("text-anchor", "middle").attr("font-size", 13).attr("fill", "#222")
          .text("Configurations stable on every visit (%)");

        // Footnote that says how the shaded region is defined.
        svg.append("text").attr("class", "scorecard-footnote")
          .attr("x", margin.left).attr("y", height - 10)
          .attr("font-size", 11).attr("fill", "#666")
          .text(`Shaded region: at least ${thresholds.distinct} distinct results and at least ` +
                `${thresholds.stable}% of configurations stable (our cutoffs).`);

        // Legend for the two marker types, tucked into the empty lower right of the plot.
        const legend = g.append("g").attr("class", "legend")
          .attr("transform", `translate(${innerW - 210},${innerH - 58})`);
        legend.append("rect").attr("x", -8).attr("y", -10).attr("width", 214).attr("height", 52)
          .attr("fill", "white").attr("fill-opacity", 0.85).attr("stroke", "#ddd");
        legend.append("circle").attr("cx", 4).attr("cy", 4).attr("r", pointRadius - 1)
          .attr("fill", "#4a5568").attr("stroke", "white").attr("stroke-width", 1.5);
        legend.append("text").attr("x", 20).attr("y", 8).attr("font-size", 12).attr("fill", "#222")
          .text("A WebGPU test we evaluate");
        legend.append("path").attr("transform", "translate(4,28)")
          .attr("d", diamond()).attr("fill", "white").attr("stroke", "#4a5568").attr("stroke-width", 2);
        legend.append("text").attr("x", 20).attr("y", 32).attr("font-size", 12).attr("fill", "#222")
          .text("Baseline we compare against");

        // Tooltip (details on demand). Positioned over the container, never changes layout.
        const tip = container.append("div").attr("class", "scorecard-tooltip")
          .attr("role", "tooltip")
          .style("position", "absolute")
          .style("pointer-events", "none")
          .style("display", "none")
          .style("max-width", "230px")
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
          const stableCount = totalConfigs ? Math.round(d.stable * totalConfigs / 100) : null;
          const verdict = d.baseline
            ? "Baseline for comparison, not one of our tests."
            : (inRegion(d) ? "In the worth-writing-up region." : "Outside the worth-writing-up region.");
          return `<strong>${d.label}</strong><br>` +
            `Distinct results: <strong>${d.distinct}</strong><br>` +
            `Stable on every visit: <strong>${d.stable}%</strong>` +
            (stableCount !== null ? ` (${stableCount} of ${totalConfigs} configurations)` : "") +
            `<br><em>${verdict}</em>`;
        }

        // Place the tooltip near (px, py) in container pixels, flipping to stay inside the view.
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

        // Points and their labels.
        const pts = g.append("g").attr("class", "points")
          .selectAll("g.point")
          .data(points, d => d.test)
          .join("g")
          .attr("class", d => "point" + (d.baseline ? " baseline" : ""))
          .attr("transform", d => `translate(${x(d.distinct)},${y(d.stable)})`)
          .attr("tabindex", 0)
          .attr("role", "img")
          .attr("aria-label", d => `${d.label}: ${d.distinct} distinct results, ${d.stable}% stable`)
          .style("cursor", "pointer")
          .style("outline", "none");

        // Ours are filled circles, baselines are hollow diamonds.
        pts.filter(d => !d.baseline).append("circle").attr("class", "mark")
          .attr("r", pointRadius)
          .attr("fill", "#4a5568").attr("fill-opacity", 0.85)
          .attr("stroke", "white").attr("stroke-width", 1.5);
        pts.filter(d => d.baseline).append("path").attr("class", "mark")
          .attr("d", diamond())
          .attr("fill", "white")
          .attr("stroke", "#4a5568").attr("stroke-width", 2);

        // Bigger invisible target so the points are easy to hover.
        pts.append("circle").attr("class", "hit").attr("r", 14).attr("fill", "transparent");

        pts.append("text").attr("class", "point-label")
          .attr("x", d => (labelOffsets[d.test] || defaultLabel).dx)
          .attr("y", d => (labelOffsets[d.test] || defaultLabel).dy)
          .attr("text-anchor", d => (labelOffsets[d.test] || defaultLabel).anchor)
          .attr("font-size", 12).attr("fill", "#222")
          .style("pointer-events", "none")
          .text(d => d.label);

        function highlight(sel, on) {
          sel.select(".mark")
            .attr("stroke", on ? "#000" : (d => d.baseline ? "#4a5568" : "white"))
            .attr("stroke-width", on ? 3 : (d => d.baseline ? 2 : 1.5));
        }

        pts
          .on("mouseenter", function (event, d) {
            highlight(d3.select(this), true);
            const [px, py] = d3.pointer(event, container.node());
            showTip(d, px, py);
          })
          .on("mousemove", function (event, d) {
            const [px, py] = d3.pointer(event, container.node());
            showTip(d, px, py);
          })
          .on("mouseleave", function () {
            highlight(d3.select(this), false);
            tip.style("display", "none");
          })
          // Keyboard users can tab to a point to see the same details.
          .on("focus", function (event, d) {
            highlight(d3.select(this), true);
            showTip(d, margin.left + x(d.distinct), margin.top + y(d.stable));
          })
          .on("blur", function () {
            highlight(d3.select(this), false);
            tip.style("display", "none");
          });
      });
    }

    // Diamond path centered on (0, 0), sized to match the circles.
    function diamond() {
      return d3.symbol(d3.symbolDiamond, 190)();
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
    chart.yDomain = function (_) {
      return arguments.length ? (yDomain = _, chart) : yDomain;
    };
    chart.thresholds = function (_) {
      return arguments.length ? (thresholds = _, chart) : thresholds;
    };
    chart.labelOffsets = function (_) {
      return arguments.length ? (labelOffsets = _, chart) : labelOffsets;
    };
    // How many configurations the stability percentages are out of (used in the tooltip).
    chart.totalConfigs = function (_) {
      return arguments.length ? (totalConfigs = +_, chart) : totalConfigs;
    };
    // Each point is { test, label, distinct, stable, baseline }.
    chart.data = function (_) {
      return arguments.length ? (points = _, chart) : points;
    };

    return chart;
  }

  // Draw into #scorecard with the real data once it has loaded.
  const target = d3.select("#scorecard");
  if (!target.empty()) {
    shared.loadData().then(data => {
      const points = data.tests.map(t => ({
        test: t.test,
        label: t.label,
        distinct: t.distinct_values,
        stable: t.configs_stable_pct,
        baseline: t.baseline
      }));
      const chart = scorecard().data(points).totalConfigs(data.configs.length);
      target.call(chart);
    }).catch(err => {
      // Most likely cause: the page was opened as a file instead of through a local web server.
      console.error("Scorecard could not load data/views.json", err);
      target.append("p")
        .style("color", "#b00020")
        .text("The scorecard could not load its data. Serve the page with a local web server " +
              "(for example python3 -m http.server 8000) and reload.");
    });
  }

  // Exposed so later sprints can redraw the view with linked selections.
  window.scorecard = scorecard;

})());
