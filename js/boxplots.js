// View C: timing box plots by operating system and browser (owner: Spencer).
//
// One box per operating system and browser group (8 groups), drawn from data/views.json (via
// shared.loadData()).
//   y = GPU dispatch time in ms, log scale, because group medians run from about 2 ms on macOS to
//       about 165 ms on the Windows VMs' software renderer.
//   each box summarizes every visit's median dispatch time (visit_ms) in that group, so it shows
//       both the spread within a device across visits and the spread between devices.
//   color = operating system (shared.osColor), the same in every view.
// A short box means the timing test gives similar times across that group. Boxes that do not
// overlap mean the timing test can tell those groups apart.
//
// Box statistics:
//   * The box runs from the first to the third quartile, with a line at the median.
//   * Whiskers reach the furthest visit within 1.5 box heights of the box (Tukey's rule). We
//     measure that on the log scale, because the axis is logarithmic, so the whiskers match what
//     the eye sees.
//   * Visits beyond the whiskers are drawn as hollow dots (outliers).
//   * Three iOS visits have a median of 0 ms because of timer rounding (see data/README.md). The
//     log scale cannot show 0, so the axis clamps them to its bottom edge and the tooltip says so.
//
// Interactions:
//   * Hover (or tab to) a box to see its statistics, and hover a dot to see its device (I4).
//   * Click a box (or press Enter on it) to select every configuration in that group. Click it
//     again, double-click the background, or press Escape to clear.
//   * The chart fires a "select" event with the selected config ids (or null when cleared), and
//     chart.selected(ids) shows a selection made in another view: boxes with no selected
//     configurations fade, and each visit of a selected configuration is drawn as a filled dot over
//     its box. shared.link() connects both directions to the shared selection event (I1).
//
// Follows the Reusable Chart pattern (https://bost.ocks.org/mike/chart/), like scorecard.js.

((() => {

  function boxplots() {
    // Fixed size so the view never changes size or moves while the user interacts with it.
    let width = 640;
    let height = 460;
    const margin = { top: 56, right: 28, bottom: 84, left: 72 };
    let yDomain = [0.5, 300];   // ms, log scale
    let configs = [];           // each config object from views.json
    let selected = null;        // Set of config ids, or null when nothing is selected
    const dispatcher = d3.dispatch("select");

    // Redraw hook set once the chart is drawn.
    let restyle = () => {};

    const fmt = v => (v === 0 ? "0" : v < 1 ? d3.format(".2f")(v) : v < 10 ? d3.format(".1f")(v) : d3.format(".0f")(v));
    const isSelected = id => !selected || selected.has(id);

    // Build one group per operating system and browser, in the shared OS order and then by browser.
    function buildGroups() {
      const byKey = d3.group(configs, d => d.os, d => d.browser);
      const osOrder = shared.OS_ORDER.filter(os => byKey.has(os))
        .concat([...byKey.keys()].filter(os => !shared.OS_ORDER.includes(os)));
      const groups = [];
      osOrder.forEach(os => {
        [...byKey.get(os).keys()].sort(d3.ascending).forEach(browser => {
          const cfgs = byKey.get(os).get(browser);
          // One value per visit, keeping which configuration it came from.
          const visits = cfgs.flatMap(c => c.visit_ms.map((ms, i) => ({
            config: c.config, device: c.device, gpu: c.gpu, os, browser, ms, visit: i + 1
          })));
          groups.push({ key: `${os}|${browser}`, os, browser, configs: cfgs, visits, ...stats(visits) });
        });
      });
      return groups;
    }

    // Quartiles on the raw times, whiskers and outliers by Tukey's rule on the log scale.
    function stats(visits) {
      const sorted = visits.map(v => v.ms).sort(d3.ascending);
      const q1 = d3.quantileSorted(sorted, 0.25);
      const median = d3.quantileSorted(sorted, 0.5);
      const q3 = d3.quantileSorted(sorted, 0.75);
      const log = v => Math.log10(Math.max(v, yDomain[0]));
      const iqr = log(q3) - log(q1);
      const loFence = log(q1) - 1.5 * iqr;
      const hiFence = log(q3) + 1.5 * iqr;
      const inside = sorted.filter(v => log(v) >= loFence && log(v) <= hiFence);
      return {
        q1, median, q3,
        whiskerLo: d3.min(inside),
        whiskerHi: d3.max(inside),
        min: sorted[0],
        max: sorted[sorted.length - 1],
        outliers: visits.filter(v => log(v.ms) < loFence || log(v.ms) > hiFence),
        zeros: visits.filter(v => v.ms === 0).length
      };
    }

    function chart(selection) {
      selection.each(function () {
        const container = d3.select(this).style("position", "relative");
        container.selectAll("*").remove();

        const innerW = width - margin.left - margin.right;
        const innerH = height - margin.top - margin.bottom;
        const groups = buildGroups();

        // clamp(true) puts the 0 ms visits at the bottom edge instead of breaking the log scale.
        const y = d3.scaleLog().domain(yDomain).range([innerH, 0]).clamp(true);
        const yTicks = [0.5, 1, 2, 5, 10, 20, 50, 100, 200];

        // Horizontal layout: one slot per box, with a wider gap between operating systems so the
        // boxes of one OS read as a group.
        const osList = [...new Set(groups.map(d => d.os))];
        const osGap = 0.6;   // gap between OS groups, as a fraction of a slot
        const slot = innerW / (groups.length + osGap * (osList.length - 1));
        const boxW = Math.min(44, slot * 0.62);
        let cursor = 0;
        groups.forEach((d, i) => {
          if (i > 0 && d.os !== groups[i - 1].os) cursor += osGap * slot;
          d.cx = cursor + slot / 2;
          cursor += slot;
        });

        const svg = container.append("svg")
          .attr("viewBox", `0 0 ${width} ${height}`)
          .attr("width", width)
          .attr("height", height)
          .style("max-width", "100%")
          .style("height", "auto")
          .style("display", "block")
          .style("font-family", "inherit");

        // Background; double-clicking it clears the selection.
        svg.append("rect").attr("width", width).attr("height", height).attr("fill", "white")
          .on("dblclick", () => setSelection(null));

        svg.append("text").attr("class", "boxplots-title")
          .attr("x", margin.left).attr("y", 24)
          .attr("font-size", 17).attr("font-weight", 600).attr("fill", "#222")
          .text("GPU timing by operating system and browser");
        svg.append("text").attr("class", "boxplots-subtitle")
          .attr("x", margin.left).attr("y", 44)
          .attr("font-size", 12.5).attr("fill", "#555")
          .text("Each box is one OS and browser. Short = stable timing. No overlap = easy to tell apart.");

        const g = svg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);

        // Light horizontal gridlines.
        g.append("g").attr("class", "grid")
          .selectAll("line").data(yTicks).join("line")
          .attr("x1", 0).attr("x2", innerW)
          .attr("y1", d => y(d)).attr("y2", d => y(d))
          .attr("stroke", "#eee");

        g.append("g")
          .call(d3.axisLeft(y).tickValues(yTicks).tickFormat(d3.format("~g")))
          .call(styleAxis);
        // Baseline under the boxes (no tick marks: the labels below name each box).
        g.append("line").attr("x1", 0).attr("x2", innerW)
          .attr("y1", innerH).attr("y2", innerH).attr("stroke", "#888");

        svg.append("text")
          .attr("transform", `translate(18,${margin.top + innerH / 2}) rotate(-90)`)
          .attr("text-anchor", "middle").attr("font-size", 13).attr("fill", "#222")
          .text("Median GPU dispatch time per visit (ms, log scale)");

        // Labels under each box: browser, then how many configurations and visits.
        const labels = g.append("g").attr("class", "box-labels")
          .selectAll("g").data(groups).join("g")
          .attr("transform", d => `translate(${d.cx},${innerH})`);
        labels.append("text").attr("y", 17).attr("text-anchor", "middle")
          .attr("font-size", 12).attr("fill", "#222").text(d => d.browser);
        labels.append("text").attr("y", 31).attr("text-anchor", "middle")
          .attr("font-size", 10.5).attr("fill", "#777").text(d => `${d.configs.length} dev.`);

        // Operating system names under each OS's boxes, with a bracket spanning them.
        const osLabels = g.append("g").attr("class", "os-labels")
          .selectAll("g").data(osList).join("g");
        osLabels.each(function (os) {
          const members = groups.filter(d => d.os === os);
          const x0 = members[0].cx - boxW / 2;
          const x1 = members[members.length - 1].cx + boxW / 2;
          const og = d3.select(this);
          og.append("line")
            .attr("x1", x0).attr("x2", x1).attr("y1", innerH + 39).attr("y2", innerH + 39)
            .attr("stroke", shared.osColor(os)).attr("stroke-width", 3);
          og.append("text")
            .attr("x", (x0 + x1) / 2).attr("y", innerH + 56).attr("text-anchor", "middle")
            .attr("font-size", 12.5).attr("font-weight", 600).attr("fill", "#222")
            .text(os);
        });

        svg.append("text").attr("class", "boxplots-footnote")
          .attr("x", margin.left).attr("y", height - 8)
          .attr("font-size", 11).attr("fill", "#666")
          .text("Whiskers: furthest visit within 1.5 box heights. Hollow dots: outliers. Click a box to select it; Esc clears.");

        // One group of marks per box.
        const boxes = g.append("g").attr("class", "boxes")
          .selectAll("g.box").data(groups, d => d.key).join("g")
          .attr("class", "box")
          .attr("transform", d => `translate(${d.cx},0)`)
          .attr("tabindex", 0)
          .attr("role", "button")
          .attr("aria-label", d => `${d.os} ${d.browser}: median ${fmt(d.median)} ms, ` +
            `middle half ${fmt(d.q1)} to ${fmt(d.q3)} ms, ${d.configs.length} configurations. ` +
            `Press Enter to select.`)
          .style("cursor", "pointer")
          .style("outline", "none");

        // Whisker line and caps.
        boxes.append("line").attr("class", "whisker")
          .attr("x1", 0).attr("x2", 0)
          .attr("y1", d => y(d.whiskerHi)).attr("y2", d => y(d.whiskerLo))
          .attr("stroke-width", 1.5);
        boxes.selectAll("line.cap").data(d => [d.whiskerLo, d.whiskerHi]).join("line")
          .attr("class", "cap")
          .attr("x1", -boxW / 4).attr("x2", boxW / 4)
          .attr("y1", v => y(v)).attr("y2", v => y(v))
          .attr("stroke-width", 1.5);

        // The box itself (at least 2 px tall so a very tight group is still visible).
        boxes.append("rect").attr("class", "iqr")
          .attr("x", -boxW / 2).attr("width", boxW)
          .attr("y", d => Math.min(y(d.q3), y(d.q1) - 2))
          .attr("height", d => Math.max(2, y(d.q1) - y(d.q3)))
          .attr("rx", 2);

        boxes.append("line").attr("class", "median")
          .attr("x1", -boxW / 2).attr("x2", boxW / 2)
          .attr("y1", d => y(d.median)).attr("y2", d => y(d.median))
          .attr("stroke", "#222").attr("stroke-width", 2.5);

        // Invisible hit area covering the box and whiskers, so the whole box is easy to hover.
        boxes.append("rect").attr("class", "hit")
          .attr("x", -slot / 2).attr("width", slot)
          .attr("y", d => y(d.whiskerHi) - 4)
          .attr("height", d => y(d.whiskerLo) - y(d.whiskerHi) + 8)
          .attr("fill", "transparent");

        // Outliers (hollow) and, when something is selected, the selected configurations' visits
        // (filled). Both live in one layer above the boxes so they can be hovered on their own.
        // Horizontal jitter is seeded, so the dots do not move between redraws.
        const jitter = d3.randomUniform.source(d3.randomLcg(0.116))(-0.32, 0.32);
        groups.forEach(d => d.visits.forEach(v => { v.dx = jitter() * boxW; }));
        const dotLayer = g.append("g").attr("class", "dots");

        // Tooltip, same look as the other views.
        const tip = container.append("div").attr("class", "boxplots-tooltip")
          .attr("role", "tooltip")
          .style("position", "absolute")
          .style("pointer-events", "none")
          .style("display", "none")
          .style("max-width", "260px")
          .style("padding", "8px 10px")
          .style("background", "rgba(255,255,255,0.97)")
          .style("border", "1px solid #888")
          .style("border-radius", "4px")
          .style("box-shadow", "0 2px 6px rgba(0,0,0,0.2)")
          .style("font-size", "13px")
          .style("line-height", "1.35")
          .style("color", "#222")
          .style("z-index", 10);

        function boxHtml(d) {
          const nSel = selected ? d.configs.filter(c => selected.has(c.config)).length : null;
          return `<strong>${d.os}, ${d.browser}</strong><br>` +
            `${d.configs.length} configurations, ${d.visits.length} visits<br>` +
            `Median <strong>${fmt(d.median)} ms</strong>` +
            ` (middle half ${fmt(d.q1)} to ${fmt(d.q3)} ms)<br>` +
            `Whiskers ${fmt(d.whiskerLo)} to ${fmt(d.whiskerHi)} ms, ` +
            `${d.outliers.length} outlier${d.outliers.length === 1 ? "" : "s"}` +
            (d.zeros ? `<br><em>${d.zeros} visit${d.zeros === 1 ? "" : "s"} read 0 ms (timer rounding), ` +
              `shown at the bottom edge.</em>` : "") +
            (nSel !== null ? `<br>${nSel} of ${d.configs.length} configurations selected` : "");
        }

        function dotHtml(v) {
          return `<strong>${v.device}</strong>, ${v.browser}<br>` +
            `${v.os}, GPU ${v.gpu}<br>` +
            `Visit ${v.visit}: median <strong>${fmt(v.ms)} ms</strong>` +
            (v.ms === 0 ? "<br><em>0 ms from timer rounding, shown at the bottom edge.</em>" : "");
        }

        function showTip(html, px, py) {
          tip.html(html).style("display", "block");
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
        const hideTip = () => tip.style("display", "none");

        // Clicking a box selects its group, or clears if that group is already the selection.
        function toggleGroup(d) {
          const ids = d.configs.map(c => c.config);
          const same = selected && selected.size === ids.length && ids.every(id => selected.has(id));
          setSelection(same ? null : ids);
        }

        let hovered = null;
        boxes
          .on("mouseenter", function (event, d) {
            hovered = d; restyle();
            const [px, py] = d3.pointer(event, container.node());
            showTip(boxHtml(d), px, py);
          })
          .on("mousemove", function (event, d) {
            const [px, py] = d3.pointer(event, container.node());
            showTip(boxHtml(d), px, py);
          })
          .on("mouseleave", function () {
            hovered = null; restyle(); hideTip();
          })
          .on("click", (event, d) => toggleGroup(d))
          // Keyboard users can tab to a box, see the same details, and select with Enter or Space.
          .on("focus", function (event, d) {
            hovered = d; restyle();
            showTip(boxHtml(d), margin.left + d.cx + boxW / 2, margin.top + y(d.q3));
          })
          .on("blur", function () {
            hovered = null; restyle(); hideTip();
          })
          .on("keydown", (event, d) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              toggleGroup(d);
            }
          });

        // Draw the dots for the current selection. Outliers are always shown; a selection adds a
        // filled dot for every visit of each selected configuration.
        function drawDots() {
          const outlierKeys = new Set();
          const dots = [];
          groups.forEach(d => {
            d.outliers.forEach(v => {
              outlierKeys.add(v);
              dots.push({ v, group: d, filled: selected ? selected.has(v.config) : false });
            });
            if (selected) {
              d.visits.forEach(v => {
                if (selected.has(v.config) && !outlierKeys.has(v)) dots.push({ v, group: d, filled: true });
              });
            }
          });
          // Faded dots first so the selected ones are drawn on top.
          dots.sort((a, b) => isSelected(a.v.config) - isSelected(b.v.config));

          dotLayer.selectAll("circle").data(dots, d => `${d.v.config}|${d.v.visit}`).join("circle")
            .attr("cx", d => d.group.cx + (d.filled ? d.v.dx : 0))
            .attr("cy", d => y(d.v.ms))
            .attr("r", d => d.filled ? 3.2 : 3)
            .attr("fill", d => d.filled ? shared.osColor(d.v.os) : "white")
            .attr("fill-opacity", d => d.filled ? 0.85 : 1)
            .attr("stroke", d => d.filled ? "white" : (isSelected(d.v.config) ? shared.osColor(d.v.os) : "#c8c8c8"))
            .attr("stroke-width", d => d.filled ? 0.8 : 1.4)
            .style("cursor", "pointer")
            .on("mouseenter", function (event, d) {
              d3.select(this).attr("r", 5);
              const [px, py] = d3.pointer(event, container.node());
              showTip(dotHtml(d.v), px, py);
            })
            .on("mouseleave", function (event, d) {
              d3.select(this).attr("r", d.filled ? 3.2 : 3);
              hideTip();
            })
            // Clicking a dot selects just that configuration.
            .on("click", (event, d) => setSelection([d.v.config]));
        }

        // Boxes with a selected configuration (or all, when nothing is selected) in OS color, the
        // rest faded gray. The hovered box gets a darker outline.
        restyle = function () {
          const active = d => !selected || d.configs.some(c => selected.has(c.config));
          boxes.select("rect.iqr")
            .attr("fill", d => active(d) ? shared.osColor(d.os) : "#e4e4e4")
            .attr("fill-opacity", d => active(d) ? (selected ? 0.3 : 0.45) : 0.6)
            .attr("stroke", d => d === hovered ? "#000" : (active(d) ? shared.osColor(d.os) : "#c8c8c8"))
            .attr("stroke-width", d => d === hovered ? 2.5 : 1.5);
          boxes.selectAll("line.whisker, line.cap")
            .attr("stroke", function () {
              const d = d3.select(this.parentNode).datum();
              return active(d) ? "#555" : "#c8c8c8";
            });
          boxes.select("line.median")
            .attr("stroke", d => active(d) ? "#222" : "#aaa");
          drawDots();
        };
        restyle();
      });
    }

    // Change the selection from inside this view, redraw, and tell the listeners.
    function setSelection(ids) {
      selected = ids ? new Set(ids) : null;
      restyle();
      dispatcher.call("select", null, selected ? [...selected] : null);
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
    chart.yDomain = function (_) {
      return arguments.length ? (yDomain = _, chart) : yDomain;
    };
    // The configs array from views.json.
    chart.data = function (_) {
      return arguments.length ? (configs = _, chart) : configs;
    };
    // Show a selection made elsewhere (array of config ids, or null to clear; an empty array
    // means a selection that matched nothing, so every box fades). Does not fire
    // "select", so linked views do not send the same selection back and forth.
    chart.selected = function (_) {
      if (!arguments.length) return selected ? [...selected] : null;
      selected = _ ? new Set(_) : null;
      restyle();
      return chart;
    };
    // chart.on("select", ids => ...) is called when the user selects or clears inside this view.
    chart.on = function () {
      const value = dispatcher.on.apply(dispatcher, arguments);
      return value === dispatcher ? chart : value;
    };

    return chart;
  }

  // Draw into #boxplots with the real data once it has loaded, and link it to the other views.
  const target = d3.select("#boxplots");
  if (!target.empty()) {
    shared.loadData().then(data => {
      const chart = boxplots().data(data.configs);
      target.call(chart);
      shared.link("boxplots", chart);
      window.boxplotsChart = chart;
    }).catch(err => {
      console.error("Box plots could not load data/views.json", err);
      target.append("p")
        .style("color", "#b00020")
        .text("The box plots could not load their data. Serve the page with a local web server " +
              "(for example python3 -m http.server 8000) and reload.");
    });
  }

  window.boxplots = boxplots;

})());
