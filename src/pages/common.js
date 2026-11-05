import { HEAT_SCALE } from "../lib/charts.js";
import { h, kpi } from "../lib/ui.js";

export function colorbar(field, [lo, hi, scale]) {
  const stops = scale === "heat" ? HEAT_SCALE.map(([p, c]) => `${c} ${p * 100}%`).join(",") : "#e8eef2 0%, #5f97bd 50%, #0f3c5a 100%";
  return h("span", { style: { display: "inline-flex", alignItems: "center", gap: "6px", marginRight: "10px" } },
    h("span", { class: "muted" }, String(lo)), h("span", { class: "colorbar", style: { display: "inline-block", background: `linear-gradient(90deg, ${stops})` } }),
    h("span", { class: "muted" }, String(hi)));
}

export function kpiGrid(k, items) {
  return h("div", { class: "kpis" }, items.map(([key, label, d, lim]) => (k[key] ? kpi(label, k[key], { d, limits: lim }) : null)));
}

export function limitsOf(cfg) { return Object.fromEntries(cfg.constraints.map((c) => [c.name, c])); }

export const every = (ms, fn) => { const id = setInterval(fn, ms); return () => clearInterval(id); };

export function stamp(text) { return h("p", { class: "note", style: { marginTop: "6px" } }, text); }
