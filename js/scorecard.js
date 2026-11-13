// View A: the test scorecard.
//
// One point per WebGPU test. x is how many distinct results the test gives across
// configurations (more distinct results = better at telling devices apart). y is the percent
// of configurations that give the same result on every visit (higher = more stable).
// Tests in the shaded top-right region are the ones worth writing up.
//
// Sprint 1 scope: axes, axis labels, the "worth writing up" region and seven hard-coded
// placeholder points. Real data, tooltips and linking come in later sprints.
//
// Follows the Reusable Chart pattern (https://bost.ocks.org/mike/chart/): scorecard() returns a
// closure with getter/setter methods and is drawn with d3.select(...).call(chart).

((() => {

  // PLACEHOLDER DATA: made-up numbers that only show the layout. They are not from our dataset.
  // Sprint 2 replaces these with each test's distinct_values and configs_stable_pct from
  // data/views.json.
  const junkPoints = [
    { test: "render_hash",      label: "Render hash",       distinct: 6,  stable: 72 },
    { test: "precision",        label: "Precision",         distinct: 11, stable: 64 },
    { test: "subnormal_mode",   label: "Subnormal mode",    distinct: 2,  stable: 96 },
    { test: "compile_messages", label: "Compile messages",  distinct: 3,  stable: 90 },
    { test: "webgpu_limits",    label: "WebGPU limits",     distinct: 17, stable: 88 },
    { test: "webgpu_features",  label: "WebGPU features",   distinct: 20, stable: 78 },
    { test: "webgl_renderer",   label: "WebGL renderer",    distinct: 24, stable: 52 }
  ];

  function scorecard() {
    // Fixed size so the view never changes size or moves while the user interacts with it.
    let width = 640;
    let height = 480;
    const margin = { top: 56, right: 28, bottom: 64, left: 72 };
    let xDomain = [0, 30];     // distinct results
    let yDomain = [0, 100];    // percent of configurations stable
    // Tests count as "worth writing up" when both measures clear these cutoffs.
    let thresholds = { distinct: 15, stable: 75 };
    let points = [];
    let pointRadius = 7;

    function chart(selection) {
      selection.each(function () {
        const container = d3.select(this);
        container.selectAll("*").remove();

        const innerW = width - margin.left - margin.right;
        const innerH = height - margin.top - margin.bottom;

        const x = d3.scaleLinear().domain(xDomain).range([0, innerW]);
        const y = d3.scaleLinear().domain(yDomain).range([innerH, 0]);

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
        g.append("g").attr("class", "grid")
          .selectAll("line.h")
          .data(y.ticks(5))
          .join("line")
          .attr("class", "h")
          .attr("x1", 0).attr("x2", innerW)
          .attr("y1", d => y(d)).attr("y2", d => y(d))
          .attr("stroke", "#eee");

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
          .attr("x", innerW - 8).attr("y", 18)
          .attr("text-anchor", "end")
          .attr("font-size", 12).attr("font-weight", 600).attr("fill", "#1d5e48")
          .text("Worth writing up");

        // Axes.
        g.append("g").attr("class", "x-axis")
          .attr("transform", `translate(0,${innerH})`)
          .call(d3.axisBottom(x).ticks(6))
          .call(styleAxis);
        g.append("g").attr("class", "y-axis")
          .call(d3.axisLeft(y).ticks(5).tickFormat(d => d + "%"))
          .call(styleAxis);

        // Axis labels.
        svg.append("text").attr("class", "x-label")
          .attr("x", margin.left + innerW / 2).attr("y", height - 16)
          .attr("text-anchor", "middle").attr("font-size", 13).attr("fill", "#222")
          .text("Distinct results across configurations (more = splits devices better)");
        svg.append("text").attr("class", "y-label")
          .attr("transform", `translate(18,${margin.top + innerH / 2}) rotate(-90)`)
          .attr("text-anchor", "middle").attr("font-size", 13).attr("fill", "#222")
          .text("Configurations stable on every visit (%)");

        // Points and their labels.
        const pts = g.append("g").attr("class", "points")
          .selectAll("g.point")
          .data(points, d => d.test)
          .join("g")
          .attr("class", "point")
          .attr("transform", d => `translate(${x(d.distinct)},${y(d.stable)})`);

        pts.append("circle")
          .attr("r", pointRadius)
          .attr("fill", "#4a5568").attr("fill-opacity", 0.85)
          .attr("stroke", "white").attr("stroke-width", 1.5);

        pts.append("text")
          .attr("x", pointRadius + 5).attr("y", 4)
          .attr("font-size", 12).attr("fill", "#222")
          .text(d => d.label);

        // Placeholder note, shown only while the points are made-up values.
        if (chart.placeholder()) {
          svg.append("text").attr("class", "placeholder-note")
            .attr("x", width - margin.right).attr("y", 24)
            .attr("text-anchor", "end").attr("font-size", 11).attr("font-style", "italic")
            .attr("fill", "#b45309")
            .text("Placeholder values, not real data");
        }
      });
    }

    function styleAxis(axisGroup) {
      axisGroup.selectAll("text").attr("font-size", 12).attr("fill", "#444");
      axisGroup.selectAll("path, line").attr("stroke", "#888");
    }

    let placeholder = false;
    chart.placeholder = function (_) {
      return arguments.length ? (placeholder = !!_, chart) : placeholder;
    };

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
    // Each point is { test, label, distinct, stable }.
    chart.data = function (_) {
      return arguments.length ? (points = _, chart) : points;
    };

    return chart;
  }

  // Draw into #scorecard once the page has loaded (scripts sit at the end of <body>).
  const target = d3.select("#scorecard");
  if (!target.empty()) {
    const chart = scorecard().data(junkPoints).placeholder(true);
    target.call(chart);
  }

  // Exposed so later sprints can redraw the view with real data and linked selections.
  window.scorecard = scorecard;

})());
