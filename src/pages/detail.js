// L3 engineering detail: zone profiles (Baur-Glaessner, Rist), mass & energy balance, inputs/outputs, thermochemistry.
import { api } from "../lib/api.js";
import { C, bars, line, plot, Plotly, points, purge, SERIES, stack } from "../lib/charts.js";
import { badge, clear, errorMsg, fmt, h, kv, panel, seg, table, toast } from "../lib/ui.js";

const charts = new Set();
const chart = (cls = "chart") => { const el = h("div", { class: cls }); charts.add(el); return el; };
const cleanup = () => { charts.forEach(purge); charts.clear(); };
const ZONE_COLOR = { active_coke_dripping: "rgba(242,137,29,.10)", cohesive: "rgba(155,74,47,.14)", thermal_reserve: "rgba(31,95,134,.08)", preheating: "rgba(125,134,142,.10)", lumpy: "rgba(125,134,142,.06)" };

function zoneShapes(pr, horizontal = true) {
  const s = [];
  for (let i = 0; i < pr.zone.length; i++) {
    const c = ZONE_COLOR[pr.zone[i]] || "rgba(0,0,0,0)";
    s.push(horizontal ? { type: "rect", xref: "paper", x0: 0, x1: 1, y0: pr.z_faces_m[i], y1: pr.z_faces_m[i + 1], fillcolor: c, line: { width: 0 }, layer: "below" }
      : { type: "rect", yref: "paper", y0: 0, y1: 1, x0: pr.z_faces_m[i], x1: pr.z_faces_m[i + 1], fillcolor: c, line: { width: 0 }, layer: "below" });
  }
  return s;
}

// ------------------------------------------------------------------------------------------ profiles
export const profiles = {
  title: "Zone profiles",
  purpose: "Temperatures, reduction, gas composition, reaction rates and heat exchange along the furnace height, with the Baur-Glaessner and Rist views of the same state.",
  async mount(root) {
    const [pr, bg, rist] = await Promise.all([api.get("/api/v1/twin/profiles"), api.get("/api/v1/thermo/baur-glaessner"), api.get("/api/v1/twin/rist")]);
    const T = chart("chart tall"), RD = chart("chart tall"), rates = chart("chart tall"), heat = chart(), bgc = chart("chart tall"), ristc = chart("chart tall");
    root.append(h("p", { class: "note" }, "Shaded bands: model zone classification (dripping/active coke, cohesive, thermal reserve, preheating). All values are model-computed."),
      h("div", { class: "grid g2" },
        panel("Temperature profiles", "gas and solid, °C", h("div", { class: "body flush" }, T)),
        panel("Reduction and utilisation", "", h("div", { class: "body flush" }, RD)),
        panel("Reaction rates", "mol/m³/s, log scale", h("div", { class: "body flush" }, rates)),
        panel("Heat exchange and melting", "MW per cell, kg/s", h("div", { class: "body flush" }, heat)),
        panel("Baur-Glaessner diagram", "equilibria with the model gas state per cell", h("div", { class: "body flush" }, bgc)),
        panel("Rist operating diagram", "C gasified per Fe vs O supplied", h("div", { class: "body" }, ristc, kv({ slope_mu_C_per_Fe: rist.mu_C_per_Fe, top_eta_CO: rist.eta_CO_top, W_point_eta_CO_equilibrium: rist.eta_CO_W_equilibrium, T_W_C: rist.T_W_C }, (k, v) => fmt(v, 3)), h("p", { class: "note" }, rist.note)))));
    const z = pr.z_m;
    plot(T, [line(pr.T_gas_C, z, "Gas", { color: C.molten() }), line(pr.T_solid_C, z, "Solid", { color: C.model(), dash: "dash" })],
      { xaxis: { title: { text: "°C" } }, yaxis: { title: { text: "Height above tuyeres (m)" } }, shapes: zoneShapes(pr), hovermode: "closest" });
    plot(RD, [line(pr.reduction_degree_pct, z, "Reduction degree %", { color: C.model() }), line(pr.eta_CO_pct, z, "η CO %", { color: SERIES[1] }),
      line(pr.ore_volume_fraction.map((x) => 100 * x), z, "Ore volume %", { color: C.ore(), dash: "dot" }), line(pr.softening_index.map((x) => 100 * x), z, "Softening %", { color: C.ink3(), dash: "dash" })],
    { xaxis: { title: { text: "%" } }, yaxis: { title: { text: "Height (m)" } }, shapes: zoneShapes(pr), hovermode: "closest" });
    const keys = Object.keys(pr.rates_mol_m3_s).filter((k) => pr.rates_mol_m3_s[k].some((v) => Math.abs(v) > 1e-7));
    plot(rates, keys.map((k, i) => line(pr.rates_mol_m3_s[k].map((v) => Math.max(Math.abs(v), 1e-7)), z, k.replace("R_", ""), { color: SERIES[i % SERIES.length] })),
      { xaxis: { type: "log", title: { text: "|rate| mol/m³/s" } }, yaxis: { title: { text: "Height (m)" } }, shapes: zoneShapes(pr), hovermode: "closest", legend: { orientation: "v", x: 1.02 } });
    stack(heat, [{ title: "MW", weight: 1.6, traces: [bars(z.map((v) => v.toFixed(1)), pr.gas_solid_heat_MW, "Gas-solid heat MW", { color: C.molten() }),
      bars(z.map((v) => v.toFixed(1)), pr.wall_heat_MW, "Wall loss MW", { color: C.water() })] },
    { title: "Melt kg/s", traces: [line(z.map((v) => v.toFixed(1)), pr.melt_rate_kg_s, "Melt rate kg/s", { color: C.ink2(), mode: "lines+markers" })] }],
    { xaxis: { title: { text: "Cell centre height (m)" } } });
    const yco = pr.y_CO_pct.map((co, i) => (co + pr.y_CO2_pct[i] > 0.5 ? (100 * co) / (co + pr.y_CO2_pct[i]) : null));
    plot(bgc, [line(bg.T_C, bg.wus_CO, "FeO/Fe (CO)", { color: C.ink2() }), line(bg.T_C, bg.mag_CO, "Fe₃O₄/FeO (CO)", { color: C.ink3(), dash: "dash" }),
      line(bg.boud_T_C, bg["boud_1.0bar"], "Boudouard 1 bar", { color: C.coke(), dash: "dot" }),
      points(pr.T_gas_C, yco, "Model gas per cell", { color: C.model(), size: 8 })],
    { xaxis: { title: { text: "Temperature (°C)" }, range: [500, 1350] }, yaxis: { title: { text: "CO / (CO + CO₂) (%)" }, range: [0, 100] }, hovermode: "closest" });
    plot(ristc, [line(rist.line_x, rist.line_y, "Operating line", { color: C.model(), mode: "lines+markers" }),
      points([rist.point_A[0]], [rist.point_A[1]], "A (top gas)", { color: C.measured(), size: 9 }), points([rist.W_point[0]], [rist.W_point[1]], "W (wüstite eq.)", { color: C.crit(), size: 9, symbol: "x" })],
    { xaxis: { title: { text: "O/C in gas" } }, yaxis: { title: { text: "O/Fe" } }, hovermode: "closest" });
  },
  unmount: cleanup,
};

// --------------------------------------------------------------------------------------------- balance
export const balance = {
  title: "Mass and energy balance",
  purpose: "Element-by-element conservation of the last step, cumulative closure since start, energy residual and the conventional heat balance per tonne of hot metal.",
  async mount(root, ctx) {
    const [b, rep] = await Promise.all([api.get("/api/v1/twin/balances"), api.get("/api/v1/reports/balance")]);
    const res = chart(), sk = chart("chart tall");
    const e = b.step.energy;
    ctx.actions(h("button", { class: "btn", onclick: () => api.download("/api/v1/reports/export", { kind: "balance", format: "xlsx" }) }, "Export XLSX"),
      h("button", { class: "btn", onclick: () => api.download("/api/v1/reports/export", { kind: "balance", format: "csv" }) }, "Export CSV"));
    root.append(h("div", { class: "banner advisory" }, `Step balance ${b.step.status === "OK" ? "closed" : "FAILED"}: largest element residual ${fmt(Math.max(...b.step.elements.map((r) => Math.abs(r.residual_pct_of_throughput))), 8)} % of throughput; energy residual ${fmt(e.residual_pct_of_basis, 8)} % of the fuel basis. Tolerances (demo acceptance): ${b.tolerances.element_residual_pct} % / ${b.tolerances.energy_residual_pct_of_fuel_basis} %.`),
      h("div", { class: "grid g2" },
        panel("Element balance, last step", `dt ${b.step.dt_s} s`, h("div", { class: "body" }, table([{ label: "Element", key: "element" }, { label: "In kg", key: "in_kg", num: true, d: 3 }, { label: "Out kg", key: "out_kg", num: true, d: 3 },
          { label: "Accumulation kg", key: "accumulation_kg", num: true, d: 3 }, { label: "Residual kg", key: "residual_kg", num: true, d: 6 }, { label: "Residual %", key: "residual_pct_of_throughput", num: true, d: 8 },
          { label: "Status", get: (r) => badge(r.status.toLowerCase(), r.status === "OK" ? "ok" : "crit") }], b.step.elements))),
        panel("Energy balance, last step", "absolute enthalpy basis", h("div", { class: "body" }, kv({ in_GJ: e.in_J / 1e9, out_GJ: e.out_J / 1e9, accumulation_GJ: e.accumulation_J / 1e9, residual_kJ: e.residual_J / 1e3,
          residual_pct_of_basis: e.residual_pct_of_basis }, (k, v) => fmt(v, k.includes("pct") ? 9 : 4)), h("h3", {}, "Terms (W)"), kv(e.terms_W || {}, (k, v) => fmt(v / 1e6, 3) + " MW"),
          h("h3", {}, "Boundaries"), kv(rep.boundaries))),
        panel("Residual history", "per step (model numerics)", h("div", { class: "body flush" }, res)),
        panel("Cumulative element closure", "since the twin started", h("div", { class: "body" }, table([{ label: "Element", key: "element" }, { label: "In kg", key: "cum_in_kg", num: true, d: 0 },
          { label: "Out kg", key: "cum_out_kg", num: true, d: 0 }, { label: "Out/In", get: (r) => fmt(r.cum_out_kg / Math.max(r.cum_in_kg, 1e-9), 4) }], rep.cumulative_elements_kg),
          h("p", { class: "note" }, "Out/In differs from 1 by the inventory accumulated in the furnace (burden column, deadman, hearth) - the per-step balance includes it explicitly."))),
        h("div", { class: "spanall" }, panel("Conventional heat balance", `${rep.conventional_heat_balance.method}, window ${fmt(rep.conventional_heat_balance.window_h, 0)} h`, h("div", { class: "body" },
          h("div", { class: "grid g2" }, sk, table([{ label: "Side", key: "side" }, { label: "Item", key: "item" }, { label: "MW", key: "MW", num: true, d: 1 }, { label: "GJ/tHM", key: "GJ_per_tHM", num: true, d: 3 }],
            rep.conventional_heat_balance.rows)), kv({ supply_GJ_tHM: rep.conventional_heat_balance.supply_GJ_tHM, demand_GJ_tHM: rep.conventional_heat_balance.demand_GJ_tHM,
            closure_GJ_tHM: rep.conventional_heat_balance.closure_GJ_tHM, unallocated_pct_of_supply: rep.conventional_heat_balance.unallocated_pct_of_supply }, (k, v) => fmt(v, 3)))))));
    const rh = b.residual_history;
    // both are relative residuals: one log axis, energy converted from % to a fraction
    plot(res, [line(rh.t_utc, rh.max_rel_element_residual.map((v) => Math.max(v || 1e-16, 1e-16)), "Max element residual", { color: SERIES[0] }),
      line(rh.t_utc, rh.energy_residual_pct.map((v) => Math.abs(v || 0) / 100 + 1e-16), "Energy residual", { color: SERIES[1] })],
    { yaxis: { type: "log", title: { text: "Relative residual (fraction)" }, exponentformat: "power" } });
    const rows = rep.conventional_heat_balance.rows.filter((r) => r.GJ_per_tHM > 0);
    const nodes = ["Blast furnace", ...rows.map((r) => r.item)];
    Plotly.react(sk, [{ type: "sankey", arrangement: "snap", node: { label: nodes, pad: 12, thickness: 14, color: nodes.map((n, i) => (i === 0 ? C.process() : rows[i - 1].side === "supply" ? C.molten() : C.model())) },
      link: { source: rows.map((r, i) => (r.side === "supply" ? i + 1 : 0)), target: rows.map((r, i) => (r.side === "supply" ? 0 : i + 1)), value: rows.map((r) => r.GJ_per_tHM),
        color: rows.map((r) => (r.side === "supply" ? "rgba(242,137,29,.35)" : "rgba(31,95,134,.30)")) } }],
    { margin: { l: 8, r: 8, t: 8, b: 8 }, paper_bgcolor: "rgba(0,0,0,0)", font: { size: 11.5, color: C.ink2() } }, { displaylogo: false, responsive: true });
  },
  unmount: cleanup,
};

// --------------------------------------------------------------------------------------------- streams
export const streams = {
  title: "Inputs and outputs",
  purpose: "Every stream entering and leaving the furnace: rates, specific consumption, compositions, and cumulative weights since the twin started.",
  async mount(root, ctx) {
    const s = await api.get("/api/v1/twin/streams");
    ctx.actions(h("button", { class: "btn", onclick: () => api.download("/api/v1/reports/export", { kind: "streams", format: "xlsx" }) }, "Export XLSX"),
      h("button", { class: "btn", onclick: () => api.download("/api/v1/reports/export", { kind: "streams", format: "csv" }) }, "Export CSV"),
      h("button", { class: "btn", onclick: () => api.download("/api/v1/reports/export", { kind: "streams", format: "json" }) }, "Export JSON"));
    const cum = chart(), comp = chart("chart tall");
    const compCell = (o) => (o ? Object.entries(o).filter(([, v]) => typeof v === "number" && v > 0.005).map(([k, v]) => `${k} ${fmt(v, 2)}`).join(", ") : "-");
    root.append(h("p", { class: "note" }, `Provenance: ${s.provenance.label}. Config v${s.provenance.config_version}, model ${s.provenance.model_version}, data time ${s.provenance.data_time_utc}.`),
      h("div", { class: "grid g2" },
        h("div", { class: "spanall" }, panel("Inputs", "as charged / injected", h("div", { class: "body" }, table([{ label: "Stream", key: "stream" }, { label: "Kind", key: "kind" },
          { label: "t/h", key: "t_h", num: true, d: 1 }, { label: "kg/tHM", key: "kg_tHM", num: true, d: 1 }, { label: "kg/charge", key: "kg_per_charge", num: true, d: 0 },
          { label: "Nm³/h", key: "Nm3_h", num: true, d: 0 }, { label: "T °C", key: "T_C", num: true, d: 0 }, { label: "Moisture %", key: "moisture_pct", num: true, d: 2 },
          { label: "Composition", get: (r) => h("span", { class: "wrap-anywhere" }, compCell(r.chem_wt_pct || r.wt_pct || r.vol_pct_dry || r.vol_pct_wet)) }], s.inputs)))),
        h("div", { class: "spanall" }, panel("Outputs", "tapped / leaving the top", h("div", { class: "body" }, table([{ label: "Stream", key: "stream" }, { label: "t/h", key: "t_h", num: true, d: 1 },
          { label: "kg/tHM", key: "kg_tHM", num: true, d: 1 }, { label: "Nm³/h", key: "Nm3_h", num: true, d: 0 }, { label: "T °C", key: "T_C", num: true, d: 0 },
          { label: "Composition", get: (r) => h("span", { class: "wrap-anywhere" }, compCell(r.wt_pct || r.vol_pct_dry || r.chem_wt_pct)) }], s.outputs)))),
        panel("Cumulative weights", `since start (${fmt(s.cumulative.elapsed_h, 1)} h)`, h("div", { class: "body flush" }, cum)),
        panel("Tapped hot metal and slag composition", "cumulative, wt%", h("div", { class: "body flush" }, comp))));
    const ci = s.cumulative.inputs_t, co = s.cumulative.outputs_t;
    plot(cum, [bars(Object.keys(ci), Object.values(ci), "inputs (t or kNm³)", { color: C.model() }), bars(Object.keys(co), Object.values(co), "outputs (t)", { color: C.molten() })],
      { barmode: "group", yaxis: { title: { text: "t (gases kNm³)" } } });
    const hm = s.cumulative.tapped_hot_metal_wt_pct || {}, sl = s.cumulative.tapped_slag_wt_pct || {};
    plot(comp, [bars(Object.keys(hm).filter((k) => k !== "Fe"), Object.entries(hm).filter(([k]) => k !== "Fe").map(([, v]) => v), "Hot metal wt%", { color: C.molten() }),
      bars(Object.keys(sl), Object.values(sl), "Slag wt%", { color: C.slag() })], { barmode: "group" });
  },
  unmount: cleanup,
};

// ---------------------------------------------------------------------------------------------- thermo
export const thermo = {
  title: "Thermochemistry and kinetics",
  purpose: "Reaction catalogue with enthalpies and free energies from the species database, literature equilibrium constants, Ellingham lines and the rate constants used by the twin.",
  async mount(root) {
    const [rx, el, kin, sp] = await Promise.all([api.get("/api/v1/thermo/reactions"), api.get("/api/v1/thermo/ellingham"), api.get("/api/v1/thermo/kinetics"), api.get("/api/v1/thermo/species")]);
    const ell = chart("chart tall"), arr = chart("chart tall");
    const rows = rx.table.filter((r) => r.name);
    const T = (rx.table.find((r) => r.T_K) || {}).T_K || [];
    root.append(h("div", { class: "grid g2" },
      panel("Ellingham diagram", "ΔG° per mol O₂ (orientation)", h("div", { class: "body flush" }, ell, h("p", { class: "note", style: { padding: "0 12px 8px" } }, el.note))),
      panel("Rate constants", "k(T) with calibration multipliers", h("div", { class: "body flush" }, arr, h("p", { class: "note", style: { padding: "0 12px 8px" } }, kin.note))),
      h("div", { class: "spanall" }, panel("Reaction catalogue", `ΔH and ΔG at ${T.join(", ")} K`, h("div", { class: "body" }, table([
        { label: "Reaction", key: "name" }, { label: "Equation", key: "equation" }, { label: "Zone", key: "zone" },
        { label: "ΔH kJ", get: (r) => (r.dH_kJ || []).map((v) => fmt(v, 1)).join(" / ") }, { label: "ΔG kJ", get: (r) => (r.dG_species_kJ || []).map((v) => fmt(v, 1)).join(" / ") },
        { label: "log K (lit.)", get: (r) => (r.logK_lit ? r.logK_lit.map((v) => fmt(v, 2)).join(" / ") : "-") }, { label: "Kinetics", key: "kinetics" },
        { label: "Status", get: (r) => badge(r.provisional ? "provisional" : "literature", r.provisional ? "warn" : "ok") }], rows, { maxHeight: "460px" })))),
      h("div", { class: "spanall" }, panel("Kinetic parameters", "lumped mixed-control forms", h("div", { class: "body" }, table([{ label: "Reaction", key: "name" }, { label: "Equation", key: "equation" },
        { label: "k_ref 1/s", key: "k_ref_per_s", num: true, d: 4 }, { label: "E kJ/mol", key: "E_kJ_per_mol", num: true, d: 0 }, { label: "T_ref K", key: "T_ref_K", num: true, d: 0 },
        { label: "Rate form", key: "rate_form" }, { label: "Source", key: "source" }], kin.rows, { maxHeight: "360px" })))),
      h("div", { class: "spanall" }, panel("Species database", `${sp.species.length} species`, h("div", { class: "body" }, table([{ label: "Key", key: "key" }, { label: "Phase", key: "phase" },
        { label: "Formula", get: (r) => Object.entries(r.formula).map(([e, n]) => `${e}${n !== 1 ? n : ""}`).join("") }, { label: "M g/mol", key: "molar_mass_g_mol", num: true, d: 3 }, { label: "Label", key: "label" }], sp.species, { maxHeight: "320px" }))))));
    plot(ell, el.lines.map((l, i) => line(el.T_C, l.dG_kJ_per_molO2, l.reaction, { color: SERIES[i % SERIES.length] })),
      { xaxis: { title: { text: "Temperature (°C)" } }, yaxis: { title: { text: "ΔG° (kJ/mol O₂)" } }, hovermode: "closest", legend: { orientation: "v", x: 1.02, font: { size: 11 } } });
    const ks = Object.entries(kin.arrhenius.k_per_s);
    plot(arr, ks.map(([k, v], i) => line(kin.arrhenius.T_K.map((t) => t - 273.15), v, k.replace("R_", ""), { color: SERIES[i % SERIES.length] })),
      { xaxis: { title: { text: "Temperature (°C)" } }, yaxis: { type: "log", title: { text: "k (1/s)" } }, hovermode: "closest", legend: { orientation: "v", x: 1.02, font: { size: 11 } } });
  },
  unmount: cleanup,
};
