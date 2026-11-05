// Plotly wrappers with the desk's visual language: grey process lines, steel blue for model values,
// ink for measurements, purple for hybrid (physics + correction), molten orange only for heat.
import Plotly from "plotly.js-dist-min";

export const C = {
  ink: () => css("--ink"), ink2: () => css("--ink-2"), ink3: () => css("--ink-3"), line: () => css("--line-soft"),
  model: () => css("--model"), measured: () => css("--measured"), hybrid: () => css("--hybrid"), molten: () => css("--molten"),
  crit: () => css("--crit"), warn: () => css("--warn"), info: () => css("--info"), ok: () => css("--ok"), panel: () => css("--panel"),
  process: () => css("--process"), slag: () => css("--slag"), water: () => css("--water"), ore: () => css("--ore"), coke: () => css("--coke"),
};
// Categorical sequence for several series on one chart, assigned in this fixed order (never cycled past 8).
// Validated with the dataviz palette checker against the desk's panel surfaces: day #e4e7e9, night #252d33
// (lightness band, chroma floor, adjacent-pair CVD dE >= 8, normal-vision dE >= 15). Some day-mode slots sit
// below 3:1 contrast on the panel, so multi-series charts always carry a legend (and hover values).
const SERIES_DAY = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#6250d6", "#e34948"];
const SERIES_NIGHT = ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#008300", "#9085e9", "#e66767"];
const night = () => typeof document !== "undefined" && document.documentElement.dataset.theme === "night";
export const SERIES = new Proxy([], {
  get(_, k) {
    const arr = night() ? SERIES_NIGHT : SERIES_DAY;
    if (k === "length") return arr.length;
    if (typeof k === "string" && /^\d+$/.test(k)) return arr[Number(k)];
    return Reflect.get(arr, k);
  },
});

function css(v) {
  return getComputedStyle(document.documentElement).getPropertyValue(v).trim() || "#333";
}

export function baseLayout(extra = {}) {
  const font = { family: getComputedStyle(document.body).fontFamily, size: 12.5, color: C.ink2() };
  return {
    margin: { l: 52, r: 16, t: 14, b: 38 }, paper_bgcolor: "rgba(0,0,0,0)", plot_bgcolor: "rgba(0,0,0,0)", font,
    xaxis: { gridcolor: C.line(), zerolinecolor: C.line(), linecolor: C.line(), automargin: true },
    yaxis: { gridcolor: C.line(), zerolinecolor: C.line(), linecolor: C.line(), automargin: true },
    legend: { orientation: "h", y: -0.2, font: { size: 12 } }, hovermode: "x unified",
    ...extra,
  };
}
const CONFIG = { displaylogo: false, responsive: true, modeBarButtonsToRemove: ["lasso2d", "select2d", "autoScale2d"] };

export function plot(el, traces, layout = {}, config = {}) {
  return Plotly.react(el, traces, baseLayout(layout), { ...CONFIG, ...config });
}
export function purge(el) { try { Plotly.purge(el); } catch { /* not a plot */ } }

// Small multiples on one shared x axis - the replacement for dual y-axis charts: each measure gets its
// own panel and scale. panels: [{ traces, title, yaxis: {...}, weight }]; shapes may use yref "y", "y2" ...
export function stack(el, panels, layout = {}) {
  const n = panels.length, gap = n > 1 ? 0.07 : 0;
  const wsum = panels.reduce((a, p) => a + (p.weight || 1), 0);
  const L = { ...layout, xaxis: { gridcolor: C.line(), zerolinecolor: C.line(), linecolor: C.line(), automargin: true, ...(layout.xaxis || {}), anchor: n === 1 ? "y" : `y${n}` } };
  const traces = [];
  let top = 1;
  panels.forEach((p, i) => {
    const hgt = ((1 - gap * (n - 1)) * (p.weight || 1)) / wsum;
    const key = i === 0 ? "yaxis" : `yaxis${i + 1}`;
    L[key] = { domain: [Math.max(top - hgt, 0), top], gridcolor: C.line(), zerolinecolor: C.line(), linecolor: C.line(), automargin: true,
      title: { text: p.title || "", font: { size: 11.5 } }, ...(p.yaxis || {}) };
    // a panel with one series is named by its axis title, so it gets no legend entry
    p.traces.forEach((t) => traces.push({ ...t, xaxis: "x", yaxis: i === 0 ? "y" : `y${i + 1}`, ...(p.traces.length === 1 ? { showlegend: false } : {}) }));
    top -= hgt + gap;
  });
  return plot(el, traces, L);
}

export function line(x, y, name, { color, dash, width = 2, yaxis, mode = "lines", fill, opacity } = {}) {
  return { type: "scatter", mode, x, y, name, yaxis, fill, opacity, line: { color: color || C.model(), dash, width }, connectgaps: false };
}
export function points(x, y, name, { color, size = 7, symbol = "circle" } = {}) {
  return { type: "scatter", mode: "markers", x, y, name, marker: { color: color || C.measured(), size, symbol } };
}
export function band(x, lo, hi, name, color) {
  return [
    { type: "scatter", mode: "lines", x, y: hi, line: { width: 0 }, hoverinfo: "skip", showlegend: false },
    { type: "scatter", mode: "lines", x, y: lo, line: { width: 0 }, fill: "tonexty", fillcolor: color || "rgba(31,95,134,.15)", name, hoverinfo: "skip" },
  ];
}
export function limitShapes(lim, xref = "paper") {
  if (!lim) return [];
  const s = [];
  const add = (v, color, dash) => v !== null && v !== undefined && s.push({ type: "line", xref, x0: 0, x1: 1, y0: v, y1: v, line: { color, width: 1.2, dash } });
  add(lim.low_alarm, C.warn(), "dash"); add(lim.high_alarm, C.warn(), "dash");
  add(lim.low_hard, C.crit(), "dot"); add(lim.high_hard, C.crit(), "dot");
  return s;
}
export function targetBand(lo, hi) {
  return { type: "rect", xref: "paper", x0: 0, x1: 1, y0: lo, y1: hi, fillcolor: "rgba(60,141,90,.10)", line: { width: 0 }, layer: "below" };
}
export function bars(x, y, name, { color, orientation = "v", text } = {}) {
  return { type: "bar", x: orientation === "v" ? x : y, y: orientation === "v" ? y : x, orientation, name, text,
    marker: { color: color || C.model() } };
}
// molten heat ramp for temperature fields (cool grey -> ore red -> molten orange -> glow)
export const HEAT_SCALE = [[0, "#5a6772"], [0.25, "#7c6f8a"], [0.45, "#9b4a2f"], [0.7, "#f2891d"], [0.88, "#ffc266"], [1, "#fff1c9"]];
export const SEQ_SCALE = [[0, "#e8eef2"], [0.5, "#5f97bd"], [1, "#0f3c5a"]];
export function heatColor(t) {
  t = Math.max(0, Math.min(1, t));
  for (let i = 1; i < HEAT_SCALE.length; i++) {
    const [p1, c1] = HEAT_SCALE[i];
    const [p0, c0] = HEAT_SCALE[i - 1];
    if (t <= p1) {
      const f = (t - p0) / (p1 - p0 || 1);
      const a = hex(c0), b = hex(c1);
      return `rgb(${Math.round(a[0] + f * (b[0] - a[0]))},${Math.round(a[1] + f * (b[1] - a[1]))},${Math.round(a[2] + f * (b[2] - a[2]))})`;
    }
  }
  return HEAT_SCALE[HEAT_SCALE.length - 1][1];
}
function hex(c) { const n = parseInt(c.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
export function seqColor(t) {
  t = Math.max(0, Math.min(1, t));
  const a = t < 0.5 ? hex("#e8eef2") : hex("#5f97bd"), b = t < 0.5 ? hex("#5f97bd") : hex("#0f3c5a");
  const f = t < 0.5 ? t / 0.5 : (t - 0.5) / 0.5;
  return `rgb(${Math.round(a[0] + f * (b[0] - a[0]))},${Math.round(a[1] + f * (b[1] - a[1]))},${Math.round(a[2] + f * (b[2] - a[2]))})`;
}
export { Plotly };
