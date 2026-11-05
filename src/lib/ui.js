// Small DOM toolkit: element builder, formatting, faceplates, tables, toasts, dialogs.

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "style" && typeof v === "object") Object.assign(el.style, v);
    else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v);
    else if (k === "html") el.innerHTML = v;
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children.flat(Infinity)) {
    if (c === undefined || c === null || c === false) continue;
    el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export const clear = (el) => { while (el.firstChild) el.removeChild(el.firstChild); return el; };

// ---------------------------------------------------------------------------------- formatting
export function fmt(v, d = 1) {
  if (v === null || v === undefined || (typeof v === "number" && !Number.isFinite(v))) return "-";
  if (typeof v !== "number") return String(v);
  const a = Math.abs(v);
  if (a >= 1e6) return (v / 1e6).toFixed(2) + "M";
  if (a >= 1e4) return v.toLocaleString("en-IN", { maximumFractionDigits: 0 });
  return v.toFixed(d);
}
export const pct = (v, d = 1) => (v === null || v === undefined ? "-" : `${fmt(v, d)} %`);
export function timeUTC(iso) {
  if (!iso) return "-";
  const t = new Date(iso);
  return Number.isNaN(t.getTime()) ? iso : t.toISOString().slice(11, 16) + "Z";
}
export function dateTimeUTC(iso) {
  if (!iso) return "-";
  const t = new Date(iso);
  return Number.isNaN(t.getTime()) ? iso : t.toISOString().replace("T", " ").slice(0, 16) + "Z";
}
export const labelize = (k) => String(k).replace(/_/g, " ").replace(/\bpct\b/g, "%").replace(/\bC\b$/, "°C").replace(/^./, (c) => c.toUpperCase());

const PROV = { MEASURED: ["measured", "Measured"], MODEL: ["model", "Model"], HYBRID: ["hybrid", "Hybrid"],
  DERIVED: ["derived", "Derived"], PROXY: ["derived", "Proxy"] };
export const provenance = (p) => { const [c, t] = PROV[p] || PROV.MODEL; return h("span", { class: `prov ${c}`, title: `${t} value` }, t); };

// ---------------------------------------------------------------------------------- faceplates
export function panel(title, sub, body, tools) {
  return h("section", { class: "panel" },
    h("header", {}, h("h2", {}, title), sub ? h("span", { class: "sub" }, sub) : null, tools ? h("div", { class: "tools" }, tools) : null),
    body instanceof Node ? body : h("div", { class: "body" }, body));
}
export function kpi(label, q, { d = 1, unit, limits, prov } = {}) {
  const v = q && typeof q === "object" ? q.value : q;
  const u = unit || (q && q.unit) || "";
  const p = prov || (q && q.provenance) || "MODEL";
  let cls = "kpi " + (p === "MODEL" ? "model" : p === "HYBRID" ? "hybrid" : "");
  if (limits && typeof v === "number") {
    if ((limits.low_hard != null && v < limits.low_hard) || (limits.high_hard != null && v > limits.high_hard)) cls += " alarm-crit";
    else if ((limits.low_alarm != null && v < limits.low_alarm) || (limits.high_alarm != null && v > limits.high_alarm)) cls += " alarm-warn";
  }
  return h("div", { class: cls }, provenance(p), h("div", {}, h("span", { class: "v" }, fmt(v, d)), h("span", { class: "u" }, u.replace("degC", "°C"))),
    h("div", { class: "l" }, label));
}
export function table(cols, rows, { maxHeight, onRow } = {}) {
  const t = h("table", { class: "t" },
    h("thead", {}, h("tr", {}, cols.map((c) => h("th", { class: c.num ? "n" : "" }, c.label)))),
    h("tbody", {}, rows.map((r, i) => h("tr", { onclick: onRow ? () => onRow(r, i) : null, style: onRow ? { cursor: "pointer" } : null },
      cols.map((c) => {
        const raw = typeof c.get === "function" ? c.get(r) : r[c.key];
        const cell = raw instanceof Node ? raw : c.num ? fmt(raw, c.d ?? 2) : raw ?? "-";
        return h("td", { class: c.num ? "n" : "" }, cell);
      })))));
  return maxHeight ? h("div", { class: "tablewrap", style: { maxHeight } }, t) : t;
}
export const kv = (obj, fmtFn) => h("dl", { class: "kv" }, Object.entries(obj).flatMap(([k, v]) => [h("dt", {}, labelize(k)),
  h("dd", {}, fmtFn ? fmtFn(k, v) : typeof v === "number" ? fmt(v, 3) : typeof v === "object" && v !== null ? JSON.stringify(v) : String(v ?? "-"))]));
export function badge(text, kind = "") { return h("span", { class: `badge ${kind}` }, text); }
export function seg(options, value, onChange) {
  const el = h("div", { class: "seg", role: "group" });
  const render = (val) => {
    clear(el);
    options.forEach(([v, label]) => el.appendChild(h("button", { type: "button", "aria-pressed": String(v === val),
      onclick: () => { render(v); onChange(v); } }, label)));
  };
  render(value);
  return el;
}
export function select(options, value, onChange, attrs = {}) {
  const s = h("select", { ...attrs, onchange: (e) => onChange(e.target.value) },
    options.map(([v, label]) => h("option", { value: v, selected: v === value ? true : null }, label)));
  return s;
}
export const field = (label, input) => h("label", { class: "field" }, label, input);
export const empty = (msg, action) => h("div", { class: "empty" }, h("p", {}, msg), action || null);

export function toast(msg, kind = "info", ms = 6000) {
  const wrap = document.getElementById("toasts");
  if (!wrap) return;
  const t = h("div", { class: `toast ${kind}`, role: kind === "err" ? "alert" : "status" }, msg);
  wrap.appendChild(t);
  setTimeout(() => t.remove(), ms);
}
export function errorMsg(e) {
  if (!e) return "Unknown error";
  const det = e.details && Array.isArray(e.details) ? " - " + e.details.slice(0, 3).map((d) => d.msg || d.error || JSON.stringify(d)).join("; ") : "";
  return `${e.message}${det}${e.requestId ? ` (request ${e.requestId})` : ""}`;
}
export function confirmDialog(title, text, okLabel = "Confirm") {
  return new Promise((resolve) => {
    const d = h("dialog", {},
      h("div", { class: "body" }, h("h3", { style: { marginTop: 0 } }, title), h("p", {}, text)),
      h("footer", {}, h("button", { class: "btn", onclick: () => { d.close(); resolve(false); } }, "Cancel"),
        h("button", { class: "btn primary", onclick: () => { d.close(); resolve(true); } }, okLabel)));
    document.body.appendChild(d);
    d.addEventListener("close", () => setTimeout(() => d.remove(), 0));
    d.showModal();
  });
}
export function progressBar(frac) { return h("div", { class: "progress", role: "progressbar", "aria-valuenow": Math.round(frac * 100) }, h("i", { style: { width: `${Math.round(frac * 100)}%` } })); }
export function downloadJSON(obj, name) {
  const a = h("a", { href: URL.createObjectURL(new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" })), download: name });
  document.body.appendChild(a); a.click(); setTimeout(() => a.remove(), 500);
}
export function downloadText(text, name, type = "text/csv") {
  const a = h("a", { href: URL.createObjectURL(new Blob([text], { type })), download: name });
  document.body.appendChild(a); a.click(); setTimeout(() => a.remove(), 500);
}
// unit from the API's key-suffix convention (hmt_C, production_t_d, fuel_rate_kg_tHM ...)
const UNIT_SUFFIX = [["_kg_tHM", "kg/tHM"], ["_Nm3_tHM", "Nm³/tHM"], ["_t_m3_d", "t/m³·d"], ["_Nm3_min", "Nm³/min"], ["_g_Nm3", "g/Nm³"],
  ["_Nm3_h", "Nm³/h"], ["_kPa_g", "kPa(g)"], ["_kPa", "kPa"], ["_Pa_s", "Pa·s"], ["_t_d", "t/d"], ["_t_h", "t/h"], ["_MW", "MW"],
  ["_pct", "%"], ["_C", "°C"], ["_m", "m"], ["_kgC_tHM", "kgC/tHM"]];
export function unitOf(key) {
  const k = String(key);
  if (k.endsWith("_kgC_tHM")) return "kgC/tHM";
  const hit = UNIT_SUFFIX.find(([s]) => k.endsWith(s));
  return hit ? hit[1] : "";
}
// display form of API unit strings (degC -> °C, Nm3 -> Nm³ ...); CSV exports keep the API spelling
export const pu = (u) => String(u ?? "").replace(/degC/g, "°C").replace(/Nm3/g, "Nm³").replace(/\bm3\b/g, "m³").replace(/\bm2\b/g, "m²").replace(/kg\/m3/g, "kg/m³");
