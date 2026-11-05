// L2 process-unit displays: burden & charging, blast & raceway, gas & permeability, hearth, refractory.
import { api, hasRole } from "../lib/api.js";
import { C, bars, line, plot, points, purge, SERIES, stack } from "../lib/charts.js";
import { config, geometry, state } from "../lib/store.js";
import { badge, clear, errorMsg, field, fmt, h, kpi, kv, labelize, panel, table, timeUTC, toast, pu } from "../lib/ui.js";
import { kpiGrid, limitsOf } from "./common.js";

const charts = new Set();
// backend data-clock seconds -> ISO UTC (epoch published in /system/status)
export const tsIso = (t) => new Date(Date.parse((state.status && state.status.data_epoch_utc) || "2026-11-01T00:00:00Z") + t * 1000).toISOString();
const track = (el) => { charts.add(el); return el; };
const cleanup = () => { charts.forEach(purge); charts.clear(); };
const chart = (cls = "chart") => track(h("div", { class: cls }));

function setpointForm(keys, sp, lim, units, onDone) {
  const inputs = {};
  const form = h("form", { class: "form", onsubmit: async (e) => {
    e.preventDefault();
    const changes = {};
    for (const [k, inp] of Object.entries(inputs)) if (inp.value !== "" && Number(inp.value) !== sp[k]) changes[k] = Number(inp.value);
    if (!Object.keys(changes).length) return toast("No setpoint changed", "info");
    try { await api.post("/api/v1/twin/setpoints", { changes }); toast("Synthetic plant setpoints applied (demo only)", "ok"); onDone && onDone(); }
    catch (err) { toast(errorMsg(err), "err"); }
  } });
  for (const k of keys) {
    const l = lim[k];
    inputs[k] = h("input", { type: "number", step: "any", value: sp[k], min: l ? l[0] : null, max: l ? l[1] : null, disabled: !hasRole("OPERATOR") || null });
    form.append(field(`${labelize(k)} [${units[k] || ""}]${l ? ` (${l[0]}-${l[1]})` : ""}`, inputs[k]));
  }
  form.append(h("button", { class: "btn primary", type: "submit", disabled: !hasRole("OPERATOR") || null }, "Apply to synthetic plant"));
  return h("div", {}, h("p", { class: "note" }, "These inputs change the SYNTHETIC demo plant only (equipment envelope enforced server-side). In plant modes this form is refused - the twin follows measured inputs."), form);
}

// ----------------------------------------------------------------------------------------- burden
export const burden = {
  title: "Burden and charging",
  purpose: "Charge make-up, burden chemistry, ore/coke layering in the shaft and the charging programme.",
  async mount(root) {
    const [cfg, st, sp, streams] = await Promise.all([config(), api.get("/api/v1/twin/state"), api.get("/api/v1/twin/setpoints"), api.get("/api/v1/twin/streams")]);
    const c = cfg.config;
    const mix = sp.setpoints.burden_mix;
    const charge = chart(), layer = chart("chart tall"), chem = h("div", {});
    root.append(h("div", { class: "grid g2" },
      panel("Charge composition", "kg per charge (as charged, wet)", h("div", { class: "body flush" }, charge)),
      panel("Burden layers in the shaft", "model layer tracker", h("div", { class: "body flush" }, layer)),
      panel("Burden chemistry", "configured assays (illustrative)", h("div", { class: "body" }, chem)),
      panel("Charging setpoints", "demo plant", h("div", { class: "body" },
        kpiGrid(st.kpis, [["charges_per_h", "Charges per hour", 1], ["stockline_m", "Stockline", 2], ["burden_descent_time_h", "Burden descent time", 1], ["slag_rate_kg_tHM", "Slag rate", 0]]),
        h("div", { style: { height: "8px" } }),
        setpointForm(["coke_batch_t", "ore_batch_t"], sp.setpoints, sp.limits, sp.units, () => location.reload()),
        h("h3", {}, "Burden mix (fractions of ore batch)"),
        mixForm(mix, c.materials)))));
    const ins = streams.inputs.filter((s) => s.kind === "burden" || s.stream === "coke");
    plot(charge, [bars(ins.map((s) => s.stream), ins.map((s) => s.kg_per_charge), "kg/charge", { color: C.model() })], { yaxis: { title: { text: "kg per charge" } } });
    const L = (st.layers || (await api.get("/api/v1/twin/layers")).layers);
    plot(layer, [{ type: "bar", orientation: "h", y: L.map((l) => (l.z_top + l.z_bot) / 2), x: L.map((l) => l.z_top - l.z_bot),
      marker: { color: L.map((l) => (l.kind === "ore" ? C.ore() : C.coke())) }, width: L.map((l) => Math.max(l.z_top - l.z_bot, 0.05)), name: "layer thickness",
      hovertemplate: "%{y:.1f} m: %{x:.2f} m thick<extra></extra>" }],
    { xaxis: { title: { text: "Layer thickness (m)" } }, yaxis: { title: { text: "Height above tuyeres (m)" } }, showlegend: false, bargap: 0 });
    const mats = Object.entries(c.materials);
    const keys = ["Fe_total", "Fe_met", "FeO", "SiO2", "Al2O3", "CaO", "MgO", "MnO", "P", "S"];
    clear(chem).append(table([{ label: "Material", key: "name" }, { label: "Kind", key: "kind" }, { label: "Share", key: "share", num: true, d: 2 },
      ...keys.map((k) => ({ label: k.replace("_", " "), key: k, num: true, d: 2 })), { label: "H₂O %", key: "moisture_pct", num: true, d: 1 }, { label: "Price INR/t", key: "price", num: true, d: 0 }],
    mats.map(([id, m]) => ({ name: m.name, kind: m.kind, share: mix[id] || 0, moisture_pct: m.moisture_pct, price: m.price_INR_t, ...m.chem }))));
    function mixForm(mix0, materials) {
      const ins = {};
      const f = h("form", { class: "form", onsubmit: async (e) => {
        e.preventDefault();
        const m = Object.fromEntries(Object.entries(ins).map(([k, i]) => [k, Number(i.value) || 0]).filter(([, v]) => v > 0));
        const s = Object.values(m).reduce((a, b) => a + b, 0);
        if (Math.abs(s - 1) > 1e-3) return toast(`Fractions sum to ${s.toFixed(3)} - they must sum to 1`, "err");
        try { await api.post("/api/v1/twin/setpoints", { changes: { burden_mix: m } }); toast("Burden mix applied to the synthetic plant", "ok"); }
        catch (err) { toast(errorMsg(err), "err"); }
      } });
      for (const [id, m] of Object.entries(materials)) if (["sinter", "pellet", "lump", "hbi", "dri", "scrap"].includes(m.kind)) {
        ins[id] = h("input", { type: "number", step: "0.01", min: 0, max: 1, value: mix0[id] || 0, disabled: !hasRole("OPERATOR") || null });
        f.append(field(m.name, ins[id]));
      }
      f.append(h("button", { class: "btn primary", type: "submit", disabled: !hasRole("OPERATOR") || null }, "Apply mix"));
      return f;
    }
  },
  unmount: cleanup,
};

// ----------------------------------------------------------------------------------- blast/raceway
export const blast = {
  title: "Blast, PCI and raceway",
  purpose: "Hot blast, oxygen enrichment, humidity and coal injection with the raceway flame temperature, bosh gas and tuyere conditions they produce.",
  async mount(root) {
    const [st, sp, cfg, hist] = await Promise.all([api.get("/api/v1/twin/state"), api.get("/api/v1/twin/setpoints"), config(), api.get("/api/v1/twin/history", { hours: 24, max_points: 400 })]);
    const k = st.kpis;
    const lim = limitsOf(cfg.config);
    const tr = chart("chart tall");
    const rw = st.raceway || {};
    root.append(h("div", { class: "grid g2" },
      panel("Blast and injection", "4-h averages", h("div", { class: "body" }, kpiGrid(k, [["blast_volume_Nm3_min", "Blast volume", 0], ["blast_temp_C", "Blast temperature", 0], ["blast_moisture_g_Nm3", "Blast humidity", 1],
        ["o2_enrichment_pct", "Oxygen enrichment", 2], ["pci_t_h", "PCI", 1], ["pci_rate_kg_tHM", "PCI rate", 0], ["blast_Nm3_tHM", "Blast per tHM", 0], ["oxygen_Nm3_tHM", "Oxygen per tHM", 0],
        ["blast_pressure_kPa_g", "Blast pressure", 0], ["tuyere_velocity_m_s", "Tuyere velocity", 0], ["blast_kinetic_energy_kW", "Kinetic energy", 1], ["tuyere_cooling_MW", "Tuyere cooling", 1]]))),
      panel("Raceway", "model", h("div", { class: "body" }, kpiGrid(k, [["raft_C", "RAFT", 0, lim.raft_C], ["raceway_gas_T_C", "Raceway gas temperature", 0], ["raceway_depth_m", "Raceway depth", 2],
        ["pci_burnout_pct", "PCI burnout", 1], ["bosh_gas_Nm3_min", "Bosh gas", 0]]),
        h("div", { style: { height: "8px" } }), kv({ bosh_CO_pct: rw.bosh_CO_pct, bosh_H2_pct: rw.bosh_H2_pct, bosh_N2_pct: rw.bosh_N2_pct, o2_to_pci_C_ratio: rw.o2_to_pci_c_ratio,
          oxygen_deficient: rw.oxygen_deficient }, (kk, v) => (typeof v === "number" ? fmt(v, 2) : String(v))),
        h("p", { class: "note" }, "RAFT follows the standard adiabatic convention (blast sensible heat + carbon to CO at the tuyere, minus moisture and injectant decomposition)."))),
      h("div", { class: "spanall" }, panel("Raceway and blast trends", "24 h, model", h("div", { class: "body flush" }, tr))),
      h("div", { class: "spanall" }, panel("Blast setpoints", "demo plant", h("div", { class: "body" },
        setpointForm(["blast_volume_Nm3_min", "blast_temp_C", "blast_moisture_g_Nm3", "o2_enrichment_pct", "pci_t_h", "top_pressure_kPa_g"], sp.setpoints, sp.limits, sp.units)))))) ;
    const t = hist.rows.map((r) => r.t_utc);
    tr.style.height = "560px";
    stack(tr, [{ title: "°C", weight: 1.4, traces: [line(t, hist.rows.map((r) => r.raft_C), "RAFT", { color: SERIES[0] }), line(t, hist.rows.map((r) => r.blast_temp_C), "Hot blast T", { color: SERIES[1] })] },
      { title: "PCI t/h", traces: [line(t, hist.rows.map((r) => r.pci_t_h), "PCI t/h", { color: C.model() })] },
      { title: "O₂ enrichment %", traces: [line(t, hist.rows.map((r) => r.o2_enrichment_pct), "O₂ %", { color: C.model() })] }],
    { xaxis: { type: "date" }, legend: { orientation: "h", y: 1.06 } });
  },
  unmount: cleanup,
};

// --------------------------------------------------------------------------------- gas/permeability
export const gas = {
  title: "Gas flow and permeability",
  purpose: "Pressure distribution, bed resistance, gas velocity and composition along the height, and the top gas leaving the furnace.",
  async mount(root) {
    const [pr, st, cfg] = await Promise.all([api.get("/api/v1/twin/profiles"), api.get("/api/v1/twin/state"), config()]);
    const k = st.kpis, tg = st.top_gas;
    const pc = chart("chart tall"), comp = chart("chart tall"), vel = chart(), topc = chart();
    root.append(h("div", { class: "grid g2" },
      panel("Permeability", "model", h("div", { class: "body" }, kpiGrid(k, [["pressure_drop_kPa", "Bed pressure drop", 0, limitsOf(cfg.config).pressure_drop_kPa], ["permeability_index", "Permeability index", 2],
        ["resistance_index_K", "Resistance index K", 3], ["blast_pressure_kPa_g", "Blast pressure", 0], ["top_pressure_kPa_g", "Top pressure", 0], ["top_gas_Nm3_tHM", "Top gas per tHM", 0],
        ["flooding_ratio", "Dripping-zone flooding ratio (> 1 = risk)", 3], ["fluidisation_ratio", "Stockline fluidisation ratio (> 1 = fines blow-out risk)", 2]]),
        h("p", { class: "note" }, "Flooding and fluidisation ratios are proxies from packed-bed correlations (Sherwood-type flooding chart; Wen & Yu minimum fluidisation of 3 mm fines), not measurements."))),
      panel("Top gas", "dry and wet basis (model)", h("div", { class: "body" }, kpiGrid(k, [["top_gas_T_uptake_C", "Temperature (uptake, lagged)", 0], ["top_gas_T_C", "Temperature (instantaneous)", 0], ["eta_CO_pct", "CO utilisation", 1], ["eta_H2_pct", "H₂ utilisation", 1],
        ["top_gas_LHV_MJ_Nm3", "LHV (dry)", 2]]), topc)),
      panel("Pressure along the height", "kPa(g) at cell faces", h("div", { class: "body flush" }, pc)),
      panel("Gas composition along the height", "vol% (model)", h("div", { class: "body flush" }, comp)),
      h("div", { class: "spanall" }, panel("Gas velocity and cell pressure drop", "superficial velocity, Ergun layered bed", h("div", { class: "body flush" }, vel)))));
    plot(pc, [line(pr.pressure_kPa_g, pr.z_faces_m, "Pressure", { color: C.model(), mode: "lines+markers" })], { xaxis: { title: { text: "kPa(g)" } }, yaxis: { title: { text: "Height above tuyeres (m)" } }, hovermode: "closest" });
    plot(comp, ["y_CO_pct", "y_CO2_pct", "y_H2_pct", "y_H2O_pct", "y_N2_pct"].map((key, i) => line(pr[key], pr.z_m, key.replace("y_", "").replace("_pct", ""), { color: SERIES[i] })),
      { xaxis: { title: { text: "vol%" } }, yaxis: { title: { text: "Height (m)" } }, hovermode: "closest" });
    stack(vel, [{ title: "Velocity m/s", traces: [bars(pr.z_m.map((z) => z.toFixed(1)), pr.gas_velocity_m_s, "Gas velocity m/s", { color: C.model() })] },
      { title: "Cell ΔP kPa", traces: [bars(pr.z_m.map((z) => z.toFixed(1)), pr.dP_cell_kPa, "Cell ΔP kPa", { color: C.ink3() })] }],
    { xaxis: { title: { text: "Cell centre height (m)" } }, showlegend: false });
    const d = tg.dry_vol_pct;
    plot(topc, [bars(["CO", "CO₂", "H₂", "N₂"], [d.CO, d.CO2, d.H2, d.N2], "dry vol%", { color: C.model() })], { yaxis: { title: { text: "vol% (dry)" } }, showlegend: false, margin: { l: 46, r: 8, t: 6, b: 28 } });
  },
  unmount: cleanup,
};

// -------------------------------------------------------------------------------------------- hearth
export const hearth = {
  title: "Hearth, hot metal and slag",
  purpose: "Liquid inventories and levels, casting sequence, hot metal and slag chemistry, slag properties, and laboratory results against the model.",
  async mount(root) {
    const [hs, st, lab] = await Promise.all([api.get("/api/v1/twin/hearth"), api.get("/api/v1/twin/state"),
      api.get("/api/v1/telemetry/history", { tags: "HMT_DIP,HM_SI,HM_S,SLAG_B2,HM_C,HM_MN", max_points: 3000 })]);
    const k = st.kpis;
    const castc = chart(), labc = chart("chart tall"), hm = chart("chart short"), sl = chart("chart short");
    root.append(h("div", { class: "grid g2" },
      panel("Hearth state", hs.casting ? `casting from taphole ${hs.taphole} for ${fmt(hs.cast_elapsed_min, 0)} min` : "tapholes closed", h("div", { class: "body" },
        h("div", { class: "kpis" }, kpi("Hot metal temperature", { value: hs.T_hm_C, unit: "°C", provenance: "MODEL" }, { d: 0 }), kpi("Slag temperature", { value: hs.T_slag_C, unit: "°C", provenance: "MODEL" }, { d: 0 }),
          kpi("Metal in hearth", { value: hs.metal_t, unit: "t", provenance: "MODEL" }, { d: 0 }), kpi("Slag in hearth", { value: hs.slag_t, unit: "t", provenance: "MODEL" }, { d: 0 }),
          kpi("Metal level", { value: hs.metal_level_m, unit: "m", provenance: "MODEL" }, { d: 2 }), kpi("Slag top", { value: hs.slag_top_m, unit: "m", provenance: "MODEL" }, { d: 2 }),
          kpi("Margin to tuyeres", { value: hs.liquid_margin_to_tuyeres_m, unit: "m", provenance: "MODEL" }, { d: 2 }), kpi("Taphole diameter", { value: hs.taphole_diameter_mm, unit: "mm", provenance: "MODEL" }, { d: 0 })),
        h("p", { class: "note" }, `Levels: ${hs.levels_basis}. Taphole axis ${fmt(hs.taphole_level_m, 2)} m, tuyeres ${fmt(hs.tuyere_level_m, 2)} m above the pad.`))),
      panel("Slag properties", "model", h("div", { class: "body" }, kpiGrid(k, [["slag_B2", "Basicity B2", 2], ["slag_B4", "Basicity B4", 2], ["slag_MgO_Al2O3", "MgO/Al₂O₃", 2], ["slag_Al2O3_pct", "Al₂O₃", 1],
        ["slag_FeO_pct", "FeO", 2], ["slag_viscosity_Pa_s", "Viscosity", 2], ["slag_liquidus_C", "Liquidus estimate", 0], ["optical_basicity", "Optical basicity", 3], ["sulfur_partition_LS", "Sulphur partition Ls", 0]]))),
      panel("Hot metal composition", "wt% (model, hearth pool)", h("div", { class: "body flush" }, hm)),
      panel("Slag composition", "wt% (model, hearth pool)", h("div", { class: "body flush" }, sl)),
      panel("Cast sequence", "tonnage and duration per cast", h("div", { class: "body flush" }, castc)),
      panel("Laboratory and dip results", "measured, at sampling time", h("div", { class: "body flush" }, labc)),
      h("div", { class: "spanall" }, panel("Cast log", "", h("div", { class: "body" }, table([
        { label: "Cast", key: "cast_no" }, { label: "Taphole", key: "taphole" }, { label: "End (UTC)", get: (r) => timeUTC(tsIso(r.t_end)) },
        { label: "Duration min", key: "duration_min", num: true, d: 0 }, { label: "Hot metal t", key: "hm_t", num: true, d: 0 }, { label: "Slag t", key: "slag_t", num: true, d: 0 },
        { label: "HMT °C", key: "T_hm_C", num: true, d: 0 }, { label: "Si %", get: (r) => fmt(r.hm_wt_pct && r.hm_wt_pct.Si, 2) }, { label: "Dry end", get: (r) => (r.dry ? "yes" : "no") }],
      hs.last_casts.slice().reverse(), { maxHeight: "300px" }))))));
    const w = hs.hm_wt_pct, s = hs.slag_wt_pct;
    plot(hm, [bars(Object.keys(w).filter((x) => x !== "Fe"), Object.entries(w).filter(([x]) => x !== "Fe").map(([, v]) => v), "wt%", { color: C.molten() })], { showlegend: false, margin: { l: 40, r: 8, t: 6, b: 28 } });
    plot(sl, [bars(Object.keys(s), Object.values(s), "wt%", { color: C.slag() })], { showlegend: false, margin: { l: 40, r: 8, t: 6, b: 28 } });
    const c = hs.last_casts;
    stack(castc, [{ title: "Tapped t", weight: 1.5, traces: [bars(c.map((x) => `#${x.cast_no}`), c.map((x) => x.hm_t), "Hot metal t", { color: C.molten() }),
      bars(c.map((x) => `#${x.cast_no}`), c.map((x) => x.slag_t), "Slag t", { color: C.slag() })] },
    { title: "Duration min", traces: [line(c.map((x) => `#${x.cast_no}`), c.map((x) => x.duration_min), "Duration min", { color: C.ink2(), mode: "lines+markers" })] }],
    { barmode: "stack", legend: { orientation: "h", y: 1.1 } });
    const R = lab.rows;
    const series = (tag) => R.filter((r) => r[tag] !== undefined && r[tag] !== null).map((r) => [r[tag + "__t_sample"] != null ? tsIso(r[tag + "__t_sample"]) : r.t_utc, r[tag]]);
    const dip = series("HMT_DIP"), si = series("HM_SI"), b2 = series("SLAG_B2");
    labc.style.height = "520px";
    stack(labc, [{ title: "HMT dip °C", traces: [points(dip.map((x) => x[0]), dip.map((x) => x[1]), "HMT dip °C", { color: C.measured(), size: 8 })] },
      { title: "Si wt%", traces: [points(si.map((x) => x[0]), si.map((x) => x[1]), "Si wt%", { color: C.measured(), size: 8, symbol: "diamond" })], yaxis: { tickformat: ".2f" } },
      { title: "Slag B2", traces: [points(b2.map((x) => x[0]), b2.map((x) => x[1]), "Slag B2", { color: C.measured(), size: 8, symbol: "square" })], yaxis: { tickformat: ".2f" } }],
    { xaxis: { type: "date" }, hovermode: "closest", showlegend: false });
  },
  unmount: cleanup,
};

// ------------------------------------------------------------------------------------- refractory
export const refractory = {
  title: "Refractory and cooling",
  purpose: "Temperature through every lining layer (implicit 1-D conduction with water-side convection and shell radiation), heat flux by zone and thermocouple comparison.",
  async mount(root) {
    const [w, st, tl] = await Promise.all([api.get("/api/v1/twin/walls"), api.get("/api/v1/twin/state"), api.get("/api/v1/telemetry/latest")]);
    const prof = chart("chart tall"), flux = chart("chart tall");
    const segs = w.segments;
    const tcs = tl.tags.filter((t) => ["HTC_SUMP", "HTC_BOTTOM", "ST_Q_BOSH", "ST_Q_BELLY", "ST_Q_MID", "ST_Q_UPPER"].includes(t.tag));
    root.append(h("div", { class: "grid g2" },
      panel("Temperature through the lining", "hot face (0 mm) to cold face", h("div", { class: "body flush" }, prof)),
      panel("Heat flux by wall segment", "kW/m², model", h("div", { class: "body flush" }, flux)),
      panel("Wall heat loads", "MW by cooling zone (model)", h("div", { class: "body" }, kv(st.walls_MW || {}, (k, v) => `${fmt(v, 2)} MW`),
        h("div", { style: { height: "8px" } }), kpiGrid(st.kpis, [["heat_loss_total_MW", "Total heat loss", 1], ["heat_loss_GJ_tHM", "Heat loss per tHM", 3], ["tuyere_cooling_MW", "Tuyere cooling", 1]]))),
      panel("Thermocouples and stave loads", "measured (synthetic sensors)", h("div", { class: "body" }, table([{ label: "Tag", key: "tag" }, { label: "Value", key: "value", num: true, d: 1 },
        { label: "Unit", get: (r) => pu(r.unit) }, { label: "Quality", get: (r) => badge(r.quality.toLowerCase(), r.quality === "GOOD" ? "ok" : "warn") }], tcs))),
      h("div", { class: "spanall" }, panel("Segment detail", "lining materials and state", h("div", { class: "body" }, table([
        { label: "Segment", key: "name" }, { label: "Zone", key: "zone" }, { label: "Height m", key: "z_m", num: true, d: 1 }, { label: "Hot face °C", key: "hot_face_C", num: true, d: 0 },
        { label: "Cold face °C", key: "cold_face_C", num: true, d: 0 }, { label: "Flux kW/m²", key: "heat_flux_kW_m2", num: true, d: 1 }, { label: "Water kW", key: "Q_water_kW", num: true, d: 0 },
        { label: "Shell kW", key: "Q_shell_kW", num: true, d: 1 },
        { label: "1150 °C isotherm from cold face mm", get: (r) => (r.isotherm_1150C_depth_from_cold_face_m != null ? fmt(r.isotherm_1150C_depth_from_cold_face_m * 1000, 0) : "-") },
        { label: "Cooling", key: "cooling" }, { label: "Layers", get: (r) => [...new Set(r.materials)].join(", ").replace(/_/g, " ") }], segs, { maxHeight: "360px" }))))));
    plot(prof, segs.map((s, i) => line(s.depth_m.map((d) => d * 1000), s.T_C, s.name, { color: SERIES[i % SERIES.length], mode: "lines+markers" })),
      { xaxis: { title: { text: "Depth from hot face (mm)" } }, yaxis: { title: { text: "°C" } }, hovermode: "closest", legend: { orientation: "v", x: 1.02, y: 1 } });
    plot(flux, [bars(segs.map((s) => s.name), segs.map((s) => s.heat_flux_kW_m2), "kW/m²", { color: C.water() })], { yaxis: { title: { text: "kW/m²" } }, showlegend: false });
  },
  unmount: cleanup,
};
