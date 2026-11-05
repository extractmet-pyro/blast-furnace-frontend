// System pages: data & sensors, energy/carbon/cost, furnace design & configuration, administration, help.
import { API_BASE, api, auth, hasRole } from "../lib/api.js";
import { C, SERIES, bars, line, plot, purge, Plotly } from "../lib/charts.js";
import { config as getConfig, invalidate, refreshStatus, state } from "../lib/store.js";
import { badge, clear, confirmDialog, dateTimeUTC, downloadText, errorMsg, field, fmt, h, kpi, kv, labelize, panel, pu, seg, table, toast } from "../lib/ui.js";

const charts = new Set();
const chart = (cls = "chart") => { const el = h("div", { class: cls }); charts.add(el); return el; };
const unmountCharts = () => { charts.forEach(purge); charts.clear(); };
const Q_KIND = { GOOD: "ok", SUSPECT: "warn", BAD: "crit", MISSING: "crit", UNAVAILABLE: "" };
const exportBtn = (kind, format, label) => h("button", { class: "btn", onclick: () => api.download("/api/v1/reports/export", { kind, format, hours: 24 }).catch((e) => toast(errorMsg(e), "err")) }, label);

// ============================================================================================ data
export const data = {
  title: "Data and sensors",
  purpose: "Where the data comes from, how good it is, and how site tags map to the model. Values shown here are as received, with quality flags; a missing or uninstalled tag is reported as such, never as zero.",
  async mount(root, ctx) {
    ctx.actions(exportBtn("telemetry", "csv", "Telemetry CSV"), exportBtn("telemetry", "xlsx", "Telemetry XLSX"));
    const modeBox = h("div", { class: "body" }), dqBox = h("div", { class: "body" }), dqChart = chart("chart short"), obsBox = h("div", { class: "body" });
    const catBox = h("div", { class: "body flush" }), upBox = h("div", { class: "body" }), faultBox = h("div", { class: "body" }), trend = chart("chart tall");
    let family = "all";
    root.append(h("div", { class: "grid g2" },
      panel("Data source and operating mode", "all modes are advisory", modeBox),
      panel("Data-quality score", "weighted, critical tags count double", h("div", { class: "body flush" }, dqChart)),
      h("div", { class: "spanall" }, panel("Tag quality", "live state with reasons", dqBox)),
      panel("Observer and reconciliation", "parameter EKF and WLS N/C/O balance", obsBox),
      panel("Demo fault injection", "synthetic sensor layer only", faultBox),
      panel("Upload historian data", "CSV, CSV.GZ or XLSX", upBox),
      panel("Tag trend", "as received, with quality", h("div", { class: "body flush" }, trend)),
      h("div", { class: "spanall" }, panel("Tag catalogue and site mapping", "data dictionary", catBox))));

    const [modes, cat] = await Promise.all([api.get("/api/v1/system/modes"), api.get("/api/v1/tags")]);
    // ---- mode
    const st = state.status || await refreshStatus();
    const modeSel = h("select", {}, Object.keys(modes.modes).map((m) => h("option", { value: m, selected: m === modes.current || null }, m.replace(/_/g, " ").toLowerCase())));
    const reason = h("input", { placeholder: "Reason (audit trail)" });
    const speed = h("input", { type: "number", min: 0.1, max: 240, step: 1, value: st && st.speed ? st.speed : 30 });
    clear(modeBox).append(table([{ label: "Mode", get: (r) => (r.k === modes.current ? h("b", {}, r.k) : r.k) }, { label: "Data origin", get: (r) => r.v.data_origin },
      { label: "Writes", get: (r) => badge(r.v.writes.toLowerCase().replace(/_/g, " "), "") }, { label: "Description", get: (r) => r.v.description }],
    Object.entries(modes.modes).map(([k, v]) => ({ k, v }))), h("ul", { class: "note" }, modes.rules.map((r) => h("li", {}, r))),
    hasRole("PROCESS_ENGINEER") ? h("div", { class: "form" }, field("Change mode to", modeSel), field("Reason", reason),
      h("button", { class: "btn primary", onclick: async () => {
        try { await api.post("/api/v1/system/mode", { mode: modeSel.value, reason: reason.value }); toast(`Mode: ${modeSel.value}`, "ok"); refreshStatus(); }
        catch (e) { toast(errorMsg(e), "err", 9000); }
      } }, "Apply mode"), field("Demo speed (sim s per s)", speed),
      h("button", { class: "btn", onclick: async () => { try { const r = await api.post("/api/v1/system/speed", { speed: Number(speed.value) }); toast(`Speed ${r.speed}×`, "ok"); } catch (e) { toast(errorMsg(e), "err"); } } }, "Set speed"))
      : h("p", { class: "note" }, "Mode and speed changes need the process-engineer role."));

    // ---- catalogue + mapping
    const tagSel = h("select", { onchange: () => drawTrend(tagSel.value) }, cat.tags.filter((t) => t.installed).map((t) => h("option", { value: t.tag }, `${t.tag} - ${t.description}`)));
    const famSeg = seg([["all", "All"], ...cat.families.map((f) => [f, labelize(f)])], "all", (v) => { family = v; loadDQ(); });
    const mapForm = () => {
      const site = h("input", { placeholder: "e.g. BF2.FI-1001.PV" }), ct = h("select", {}, cat.tags.map((t) => h("option", { value: t.tag }, t.tag)));
      const unit = h("input", { placeholder: "site unit, e.g. Nm3/h" }), sc = h("input", { type: "number", step: "any", value: 1 }), off = h("input", { type: "number", step: "any", value: 0 });
      ct.onchange = () => { unit.value = cat.tags.find((t) => t.tag === ct.value).unit; };
      ct.onchange();
      return h("div", { class: "body" }, h("div", { class: "form" }, field("Site tag", site), field("Catalogue tag", ct), field("Site unit", unit), field("Scale", sc), field("Offset", off),
        h("button", { class: "btn primary", onclick: async () => {
          try { const r = await api.post("/api/v1/tags/map", { mappings: [{ site_tag: site.value, catalogue_tag: ct.value, site_unit: unit.value, scale: Number(sc.value), offset: Number(off.value) }] });
            toast(`Mapped ${r.mapped[0].site_tag} -> ${r.mapped[0].catalogue_tag} (scale ${fmt(r.mapped[0].scale, 4)}, offset ${fmt(r.mapped[0].offset, 3)})`, "ok"); }
          catch (e) { toast(errorMsg(e), "err", 9000); }
        } }, "Save mapping")),
      h("p", { class: "note" }, "Units are converted automatically where a conversion exists (for example kPa(g) to bar(g)); otherwise give scale and offset. Mappings are audited."));
    };
    const template = () => ["site_tag,catalogue_tag,site_unit,scale,offset,description,catalogue_unit",
      ...cat.tags.map((t) => `,${t.tag},${t.unit},1,0,"${t.description.replace(/"/g, "'")}",${t.unit}`)].join("\n");
    clear(catBox).append(h("div", { class: "body" }, h("div", { style: { display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center" } },
      h("button", { class: "btn", onclick: () => downloadText(template(), "bf_tag_mapping_template.csv") }, "Download mapping template (CSV)"), h("span", { class: "note" }, cat.note))),
    table([{ label: "Tag", key: "tag" }, { label: "Description", key: "description" }, { label: "Family", key: "family" }, { label: "Unit", get: (t) => pu(t.unit) },
      { label: "Type", key: "signal_type" }, { label: "Range", get: (t) => (t.lo != null ? `${t.lo} - ${t.hi}` : "-") }, { label: "Period s", key: "expected_period_s", num: true, d: 0 },
      { label: "Lab delay min", key: "lab_delay_min", num: true, d: 0 }, { label: "Installed", get: (t) => badge(t.installed ? "yes" : "not installed", t.installed ? "ok" : "") },
      { label: "Site tag", get: (t) => (t.mapping ? t.mapping.site_tag : "-") }, { label: "Source", key: "source_id" }], cat.tags, { maxHeight: "460px" }),
    hasRole("PROCESS_ENGINEER") ? mapForm() : null);

    // ---- upload
    const file = h("input", { type: "file", accept: ".csv,.gz,.xlsx" });
    let useFor = "validate";
    const upRes = h("div", {});
    clear(upBox).append(h("p", { class: "note" }, "First row: timestamp column (ISO 8601, UTC or with offset) then one column per tag (catalogue names or mapped site tags). Formula-like cells are rejected; non-monotonic timestamps are reported."),
      h("div", { class: "form" }, field("File", file), field("Use", seg([["validate", "Validate only"], ["replay", "Load for replay"]], "validate", (v) => { useFor = v; })),
        h("button", { class: "btn primary", disabled: !hasRole("METALLURGIST") || null, onclick: async () => {
          if (!file.files[0]) { toast("Choose a file first", "err"); return; }
          try { const r = await api.upload("/api/v1/data/upload", file.files[0], { use_for: useFor }); clear(upRes).append(h("p", {}, badge(r.data_origin, "info")), kv(r.summary)); toast("File parsed", "ok"); }
          catch (e) { clear(upRes).append(h("div", { class: "banner crit" }, errorMsg(e))); }
        } }, "Upload")), upRes);

    // ---- faults (demo)
    const fk = h("select", {}, ["DRIFT", "BIAS", "STUCK", "DROPOUT", "DISORDER"].map((k) => h("option", { value: k }, k.toLowerCase())));
    const ft = h("select", {}, cat.tags.filter((t) => t.installed && t.signal_type !== "LAB").map((t) => h("option", { value: t.tag }, t.tag)));
    const fm = h("input", { type: "number", step: "any", value: 0.5 }), fd = h("input", { type: "number", min: 0.1, max: 48, step: 0.5, value: 2 });
    clear(faultBox).append(h("p", { class: "note" }, "Inject an instrument fault into the SYNTHETIC sensor layer to watch the quality engine flag it, the observer reject it and the trust gate suppress advice. Drift magnitude is per hour in tag units; bias is an offset."),
      h("div", { class: "form" }, field("Fault", fk), field("Tag", ft), field("Magnitude", fm), field("Duration h", fd),
        h("button", { class: "btn primary", disabled: !hasRole("OPERATOR") || null, onclick: async () => {
          try { await api.post("/api/v1/twin/faults", { kind: fk.value, tag: ft.value, magnitude: Number(fm.value), duration_h: Number(fd.value) }); toast(`${fk.value} on ${ft.value} injected`, "ok"); loadDQ(); }
          catch (e) { toast(errorMsg(e), "err", 9000); }
        } }, "Inject"), h("button", { class: "btn", disabled: !hasRole("OPERATOR") || null, onclick: async () => { try { await api.del("/api/v1/twin/faults"); toast("Faults cleared", "ok"); loadDQ(); } catch (e) { toast(errorMsg(e), "err"); } } }, "Clear faults")));

    async function loadDQ() {
      try {
        const q = await api.get("/api/v1/data/quality");
        const rows = q.tags.filter((t) => family === "all" || t.family === family);
        clear(dqBox).append(h("div", { style: { display: "flex", gap: "10px", alignItems: "center", flexWrap: "wrap", marginBottom: "8px" } }, famSeg,
          h("span", {}, `Score ${fmt(q.score.score, 1)} / 100`), q.score.critical_ok ? badge("critical tags good", "ok") : badge(`critical not good: ${(q.score.critical_not_good || []).join(", ")}`, "crit"),
          q.active_faults_demo.length ? badge(`${q.active_faults_demo.length} demo fault(s) active`, "warn") : null),
        table([{ label: "Tag", key: "tag" }, { label: "Family", key: "family" }, { label: "Value", get: (t) => (t.value == null ? "-" : fmt(t.value, 3)) }, { label: "Unit", get: (t) => pu(t.unit) },
          { label: "Quality", get: (t) => badge(t.quality.toLowerCase(), Q_KIND[t.quality]) }, { label: "Age", get: (t) => (t.age_s != null ? `${fmt(t.age_s / 60, 0)} min` : "-") },
          { label: "Reasons", get: (t) => (t.reasons || []).join("; ") || "-" }], rows, { maxHeight: "420px", onRow: (t) => { tagSel.value = t.tag; drawTrend(t.tag); } }));
        const c = q.score.counts || {};
        plot(dqChart, [bars(Object.keys(c), Object.values(c), "tags", { color: C.model() })], { showlegend: false, yaxis: { title: { text: "Tags" } },
          title: { text: `Score ${fmt(q.score.score, 1)}`, x: 0.02, font: { size: 13 } } });
      } catch (e) { clear(dqBox).append(errorMsg(e)); }
    }
    async function loadObs() {
      try {
        const o = await api.get("/api/v1/twin/observer");
        const e = o.ekf, r = o.reconciliation || {};
        clear(obsBox).append(h("p", { class: "note" }, `${e.method}; sensitivities from ${e.sensitivity_source}; ${e.updates} updates, ${e.rejected} rejected; mean NIS ${fmt(e.mean_normalised_innovation, 2)}; covariance ${e.covariance_pd ? "positive definite" : "NOT positive definite"}.`),
          table([{ label: "Parameter", get: (p) => labelize(p.name) }, { label: "Estimate", key: "estimate", num: true, d: 3 }, { label: "Applied to twin", key: "applied", num: true, d: 3 },
            { label: "95 % interval", get: (p) => `${fmt(p.lower95, 3)} - ${fmt(p.upper95, 3)}` }, { label: "Bounds", get: (p) => p.bounds.join(" - ") }], e.parameters),
          r.streams ? h("div", { style: { marginTop: "10px" } }, h("p", { class: "note" }, `Reconciliation (${r.method}): chi² ${fmt(r.chi2, 2)} vs critical ${fmt(r.chi2_critical, 2)} - ${r.gross_error_suspected ? `gross error suspected in ${r.suspect_streams.join(", ") || "?"}` : "no gross error detected"}. ${r.inputs_note || ""}`),
            table([{ label: "Stream", get: (s) => labelize(s.stream) }, { label: "Measured", key: "measured", num: true, d: 1 }, { label: "Reconciled", key: "reconciled", num: true, d: 1 },
              { label: "Adjustment %", key: "adjustment_pct", num: true, d: 2 }, { label: "Normalised residual", key: "normalised_residual", num: true, d: 2 }], r.streams))
            : h("p", { class: "note" }, r.error ? `Reconciliation unavailable: ${r.error}` : "Reconciliation runs when the required tags are GOOD."));
      } catch (err) { clear(obsBox).append(errorMsg(err)); }
    }
    async function drawTrend(tag) {
      try {
        const r = await api.get("/api/v1/telemetry/history", { tags: tag, max_points: 900 });
        const x = r.rows.map((p) => p.t_utc), y = r.rows.map((p) => p[tag]), q = r.rows.map((p) => p[`${tag}__q`]);
        const bad = r.rows.map((p, i) => (q[i] && q[i] !== "GOOD" ? y[i] : null));
        plot(trend, [line(x, y, `${tag} (measured)`, { color: C.measured(), width: 1.4 }), { type: "scatter", mode: "markers", x, y: bad, name: "not GOOD", marker: { color: C.crit(), size: 6, symbol: "x" } }],
          { xaxis: { type: "date" }, yaxis: { title: { text: r.units[tag] || "" } }, legend: { orientation: "h", y: -0.2 } });
      } catch (e) { toast(errorMsg(e), "err"); }
    }
    loadDQ(); loadObs(); drawTrend(tagSel.value);
    trend.before(h("div", { class: "body" }, field("Tag", tagSel)));
    this._t = setInterval(() => { loadDQ(); loadObs(); }, 20000);
  },
  unmount() { clearInterval(this._t); unmountCharts(); },
};

// ========================================================================================= energy
export const energy = {
  title: "Energy, carbon and cost",
  purpose: "Specific energy, CO2 and variable cost per tonne of hot metal from the twin's 4-hour stream windows. Prices and emission factors are illustrative configuration values - replace them with site figures before using the numbers.",
  async mount(root, ctx) {
    ctx.actions(exportBtn("balance", "xlsx", "Balance workbook"), exportBtn("streams", "csv", "Streams CSV"));
    const [en, ec] = await Promise.all([api.get("/api/v1/reports/energy"), api.get("/api/v1/reports/economics")]);
    const supply = chart("chart tall"), intens = chart(), walls = chart(), carb = chart(), cost = chart("chart tall");
    const carbBox = h("div", {});
    const ei = en.energy_intensity;
    const tg = en.top_gas;
    root.append(h("div", { class: "banner warn" }, "Illustrative prices and emission factors (configuration). Carbon figures are ESTIMATED from the model's element balance, not measured emissions, and are not a verified inventory."),
      h("div", { class: "kpis", style: { marginBottom: "12px" } },
        kpi("Gross fuel + power energy", { value: ei.gross_GJ_tHM, unit: "GJ/tHM", provenance: "MODEL" }, { d: 2 }),
        kpi("Wall + cooling heat loss", { value: en.heat_loss_total_MW && en.heat_loss_total_MW.value, unit: "MW", provenance: "MODEL" }, { d: 1 }),
        kpi("Top gas chemical energy", { value: en.top_gas_GJ_tHM, unit: "GJ/tHM", provenance: "MODEL" }, { d: 2 }),
        kpi("Hot stove fuel", { value: en.stove_GJ_tHM, unit: "GJ/tHM", provenance: "MODEL" }, { d: 2 }),
        kpi("Top gas LHV", { value: tg.LHV_MJ_Nm3_dry, unit: "MJ/Nm³ dry", provenance: "MODEL" }, { d: 2 }),
        kpi("Net variable cost", { value: ec.net_variable_INR_tHM, unit: `${ec.currency}/tHM`, provenance: "DERIVED" }, { d: 0 }),
        kpi("Total cost incl. fixed", { value: ec.total_INR_tHM, unit: `${ec.currency}/tHM`, provenance: "DERIVED" }, { d: 0 })),
      h("div", { class: "grid g2" },
        panel("Heat supply and demand", `${en.heat_balance.method || "conventional heat balance"}`, h("div", { class: "body flush" }, supply)),
        panel("Energy intensity by carrier", "GJ per tHM", h("div", { class: "body flush" }, intens)),
        panel("Heat loss by wall zone", "cooling water + shell", h("div", { class: "body flush" }, walls)),
        panel("Top gas", `${fmt(tg.dry_flow_Nm3_h, 0)} Nm³/h dry at ${fmt(tg.T_C, 0)} °C`, h("div", { class: "body" },
          table([{ label: "Component", key: "k" }, { label: "vol % dry", key: "v", num: true, d: 2 }], Object.entries(tg.dry_vol_pct).map(([k, v]) => ({ k, v }))))),
        panel("CO2 by boundary", "model estimate", h("div", { class: "body" }, carbBox, carb)),
        panel("Variable cost breakdown", `${ec.currency} per tHM`, h("div", { class: "body flush" }, cost)),
        h("div", { class: "spanall" }, panel("Cost table", ec.note, h("div", { class: "body flush" },
          table([{ label: "Item", key: "item" }, { label: "Specific", key: "specific", num: true, d: 2 }, { label: "Unit", get: (r) => pu(r.unit) }, { label: `Price ${ec.currency}`, key: "price", num: true, d: 1 },
            { label: `${ec.currency}/tHM`, key: "cost_per_tHM", num: true, d: 1 }], [...ec.rows, ...ec.credits]),
          kv({ variable: ec.variable_INR_tHM, credits: ec.credits_INR_tHM, net_variable: ec.net_variable_INR_tHM, fixed: ec.fixed_INR_tHM, total: ec.total_INR_tHM }, (k, v) => `${fmt(v, 0)} ${ec.currency}/tHM`))))));
    const rows = (en.heat_balance.rows || []).filter((r) => r.GJ_per_tHM > 0);
    const sup = rows.filter((r) => r.side === "supply"), dem = rows.filter((r) => r.side === "demand");
    plot(supply, [...sup.map((r, i) => ({ type: "bar", x: ["Supply"], y: [r.GJ_per_tHM], name: r.item, marker: { color: [C.molten(), "#d68a3c", "#e7b06b", "#b05c22", "#f0c890"][i % 5] } })),
      ...dem.map((r, i) => ({ type: "bar", x: ["Demand"], y: [r.GJ_per_tHM], name: r.item, marker: { color: SERIES[i % 8] } }))],
    { barmode: "stack", yaxis: { title: { text: "GJ per tHM" } }, legend: { font: { size: 11 } } });
    const eiK = ["coke_GJ_tHM", "pci_GJ_tHM", "ng_GJ_tHM", "electricity_GJ_tHM"];
    plot(intens, [bars(eiK.map((k) => labelize(k.replace("_GJ_tHM", ""))), eiK.map((k) => ei[k]), "GJ/tHM", { color: C.model() })], { showlegend: false, yaxis: { title: { text: "GJ per tHM" } } });
    const wl = en.wall_losses_MW || {};
    plot(walls, [bars(Object.keys(wl).map(labelize), Object.values(wl), "MW", { color: C.water() })], { showlegend: false, yaxis: { title: { text: "MW" } }, margin: { b: 100 } });
    const pcost = [...ec.rows, ...ec.credits].filter((r) => Math.abs(r.cost_per_tHM) > 1).sort((a, b) => b.cost_per_tHM - a.cost_per_tHM);
    plot(cost, [{ type: "waterfall", orientation: "v", x: [...pcost.map((r) => r.item.replace(/\(.*\)/, "").trim()), "Net variable"], y: [...pcost.map((r) => r.cost_per_tHM), 0],
      measure: [...pcost.map(() => "relative"), "total"], connector: { line: { color: C.ink3() } },
      increasing: { marker: { color: C.molten() } }, decreasing: { marker: { color: C.ok() } }, totals: { marker: { color: C.model() } } }],
    { showlegend: false, margin: { b: 130 }, yaxis: { title: { text: `${ec.currency} per tHM` } } });
    const loadC = async (b) => {
      try {
        const r = await api.get("/api/v1/reports/carbon", { boundary: b });
        clear(carbBox).append(h("p", {}, `${fmt(r.kgCO2_tHM, 0)} kgCO2/tHM, ${fmt(r.tCO2_day, 0)} tCO2/day (${r.measured_or_estimated}). ${r.method}.`));
        plot(carb, r.items.map((it, i) => ({ type: "bar", x: ["CO2"], y: [it.kgCO2_tHM], name: `${it.item} (scope ${it.scope})`, marker: { color: SERIES[i % 8] } })),
          { barmode: "stack", yaxis: { title: { text: "kgCO2 per tHM" } }, legend: { font: { size: 11 } } });
      } catch (e) { clear(carbBox).append(errorMsg(e)); }
    };
    carbBox.before(seg([["BF_GATE_TO_GATE", "BF gate-to-gate"], ["BF_PLUS_UTILITIES", "+ utilities"], ["BF_PLUS_UPSTREAM", "+ upstream"]], "BF_GATE_TO_GATE", loadC));
    loadC("BF_GATE_TO_GATE");
  },
  unmount: unmountCharts,
};

// ========================================================================================= config
const GEO_FIELDS = [["hearth_diameter_m", "Hearth diameter", "m"], ["sump_depth_m", "Sump depth below taphole", "m"], ["taphole_to_tuyere_m", "Taphole to tuyere axis", "m"],
  ["bosh_height_m", "Bosh height", "m"], ["belly_diameter_m", "Belly diameter", "m"], ["belly_height_m", "Belly height", "m"], ["stack_height_m", "Stack (shaft) height", "m"],
  ["throat_diameter_m", "Throat diameter", "m"], ["throat_height_m", "Throat height", "m"], ["stockline_m", "Stockline depth", "m"], ["n_tuyeres", "Tuyeres", ""],
  ["tuyere_diameter_m", "Tuyere nose diameter", "m"], ["n_tapholes", "Tapholes", ""], ["taphole_diameter_m", "Taphole diameter", "m"], ["deadman_porosity", "Deadman porosity", "-"]];
const OP_FIELDS = [["blast_volume_Nm3_min", "Blast volume", "Nm³/min"], ["blast_temp_C", "Hot blast temperature", "°C"], ["blast_moisture_g_Nm3", "Blast moisture", "g/Nm³"],
  ["o2_enrichment_pct", "Oxygen enrichment", "%"], ["pci_t_h", "PCI rate", "t/h"], ["top_pressure_kPa_g", "Top pressure", "kPa(g)"], ["coke_batch_t", "Coke batch", "t"], ["ore_batch_t", "Ore batch", "t"],
  ["ng_Nm3_h", "Natural gas", "Nm³/h"], ["h2_Nm3_h", "Hydrogen", "Nm³/h"]];

export const config = {
  title: "Furnace design and configuration",
  purpose: "Choose a furnace size, adjust its dimensions, operating point and refractory lining, and save the result as a new validated configuration version. Every save rebuilds the twin from the new design; the previous versions stay available.",
  async mount(root) {
    const can = hasRole("PROCESS_ENGINEER");
    const [cf, pr, vers, refr] = await Promise.all([getConfig(true), api.get("/api/v1/config/presets"), api.get("/api/v1/config/plant/versions"), api.get("/api/v1/thermo/refractories")]);
    const cfg = cf.config;
    const basePreset = String(cfg.plant.preset || "large_4000").replace(/-custom$/, "");
    const R = Object.fromEntries(refr.materials.map((m) => [m.key, m]));
    const after = (r) => { toast(`Configuration v${r.version} accepted - twin re-initialising`, "ok", 9000); invalidate(); setTimeout(() => { refreshStatus(); location.hash = "#/overview"; }, 2500); };
    let editorTa = null;            // the JSON editor (set by jsonEditor below; used by the version Load buttons)
    root.append(h("div", { class: "banner" }, `Active: ${cfg.plant.name} - configuration v${cf.version} (sha ${cf.sha256.slice(0, 10)}). All presets are illustrative designs, not a specific plant.`),
      h("div", { class: "grid g2" },
        h("div", { class: "spanall" }, panel("Furnace size presets", "switching rebuilds the twin (about a minute)", h("div", { class: "body flush" },
          table([{ label: "Preset", key: "label" }, { label: "Working volume m³", key: "working_volume_m3", num: true, d: 0 }, { label: "Inner volume m³", key: "inner_volume_m3", num: true, d: 0 },
            { label: "Hearth Ø m", key: "hearth_diameter_m", num: true, d: 1 }, { label: "Tuyeres", key: "n_tuyeres", num: true, d: 0 }, { label: "Tapholes", key: "n_tapholes", num: true, d: 0 },
            { label: "Blast Nm³/min", key: "nominal_blast_Nm3_min", num: true, d: 0 },
            { label: "", get: (p) => (p.id === basePreset ? badge("active base", "model") : can ? h("button", { class: "btn small", onclick: async () => {
              if (!(await confirmDialog("Switch furnace preset", `Rebuild the twin as ${p.label}? Running jobs keep their own clones; live trends restart.`, "Switch"))) return;
              try { after(await api.post("/api/v1/config/preset", { preset: p.id, expected_version: cf.version })); } catch (e) { toast(errorMsg(e), "err", 9000); }
            } }, "Switch") : "") }], pr.presets)))),
        panel("Dimensions", `base preset ${basePreset}`, designForm("geometry", GEO_FIELDS)),
        panel("Operating point", "initial setpoints of the twin", designForm("operation", OP_FIELDS)),
        h("div", { class: "spanall" }, panel("Refractory lining and cooling", "layer materials and thicknesses per zone", refractoryEditor())),
        panel("Configuration versions", "audit of design changes; load an earlier version to roll back", h("div", { class: "body flush" }, table([{ label: "Version", key: "version", num: true, d: 0 }, { label: "Created", get: (v) => dateTimeUTC(v.created_at) },
          { label: "Author", key: "author" }, { label: "Comment", key: "comment" }, { label: "Active", get: (v) => (v.active ? badge("active", "ok") : "") },
          { label: "", get: (v) => (can && !v.active ? h("button", { class: "btn small", title: "Put this version into the JSON editor below", onclick: async () => {
            try {
              const old = await api.get(`/api/v1/config/plant/versions/${v.version}`);
              editorTa.value = JSON.stringify(old.config, null, 2);
              editorTa.scrollIntoView({ block: "center" });
              toast(`Version ${v.version} is in the JSON editor. Review it, then Validate and save to roll back (saved as a new version).`, "info", 12000);
            } catch (e) { toast(errorMsg(e), "err", 9000); }
          } }, "Load") : "") }], vers.versions, { maxHeight: "360px" }))),
        panel("Refractory property library", refr.note, h("div", { class: "body flush" }, table([{ label: "Material", get: (m) => labelize(m.key) }, { label: "k W/m·K", key: "k_W_mK", num: true, d: 1 },
          { label: "ρ kg/m³", key: "rho_kg_m3", num: true, d: 0 }, { label: "cp J/kg·K", key: "cp_J_kgK", num: true, d: 0 }, { label: "α ×10⁻⁶ m²/s", get: (m) => fmt(m.diffusivity_m2_s * 1e6, 2) }], refr.materials))),
        h("div", { class: "spanall" }, panel("Full configuration (JSON)", "validated against the schema and engineering checks on save", jsonEditor()))));

    function designForm(section, fields) {
      const inputs = {};
      const grid = h("div", { class: "form" }, fields.map(([k, label, u]) => {
        inputs[k] = h("input", { type: "number", step: "any", value: cfg[section][k], disabled: !can || null });
        return field(`${label}${u ? ` (${u})` : ""}`, inputs[k]);
      }));
      const comment = h("input", { placeholder: "Why this change (audit)" });
      return h("div", { class: "body" }, grid, can ? h("div", { class: "form", style: { marginTop: "8px" } }, field("Comment", comment), h("button", { class: "btn primary", onclick: async () => {
        const ov = {};
        fields.forEach(([k]) => { const v = Number(inputs[k].value); if (Number.isFinite(v) && v !== cfg[section][k]) ov[k] = ["n_tuyeres", "n_tapholes"].includes(k) ? Math.round(v) : v; });
        if (!Object.keys(ov).length) { toast("Nothing changed", "info"); return; }
        if (!(await confirmDialog("Save design change", `Apply ${Object.keys(ov).length} change(s) to ${section} and rebuild the twin?`, "Save and rebuild"))) return;
        // full-config PUT keeps every other section (lining, materials, calibration) exactly as it is
        const next = { ...cfg, [section]: { ...cfg[section], ...ov }, plant: { ...cfg.plant, preset: `${basePreset}-custom` } };
        try { after(await api.put("/api/v1/config/plant", { config: next, expected_version: cf.version, comment: comment.value || `${section} edit: ${Object.keys(ov).join(", ")}` }, { timeoutMs: 120000 })); }
        catch (e) { toast(errorMsg(e), "err", 12000); }
      } }, "Save as new version")) : h("p", { class: "note" }, "Sign in as process engineer to edit."),
      h("p", { class: "note" }, "The backend checks geometric consistency (diameters, heights, volumes), the equipment envelope and a trial model step before it accepts a design."));
    }

    function refractoryEditor() {
      const work = JSON.parse(JSON.stringify(cfg.walls));
      const zones = [...work.shaft.map((w, i) => ({ id: `shaft.${i}`, name: w.name, w, Tin: 1300 })), ...Object.entries(work).filter(([k]) => k !== "shaft").map(([k, w]) => ({ id: k, name: k, w, Tin: 1450 }))];
      const out = h("div", { class: "grid g2" });
      const sum = h("div", { class: "body flush" });
      const fluxChart = chart();
      const recompute = () => {
        const rows = zones.map((z) => {
          const Rl = z.w.layers.reduce((a, l) => a + l.thickness_m / ((R[l.material] || {}).k_W_mK || 1), 0);
          const hin = z.w.h_in_W_m2K || 200, hw = 1500;   // water-side film ~1500 W/m²K (illustrative)
          const Tw = (z.w.cooling && z.w.cooling.water_inlet_C) || 38;
          const q = (z.Tin - Tw) / (1 / hin + Rl + 1 / hw);
          return { zone: labelize(z.name), thick: z.w.layers.reduce((a, l) => a + l.thickness_m, 0), Rl, q: q / 1000 };
        });
        clear(sum).append(table([{ label: "Zone", key: "zone" }, { label: "Total lining m", key: "thick", num: true, d: 3 }, { label: "Σ t/k m²K/W", key: "Rl", num: true, d: 4 },
          { label: "Steady flux kW/m²", key: "q", num: true, d: 1 }], rows));
        plot(fluxChart, [bars(rows.map((r) => r.zone), rows.map((r) => r.q), "kW/m²", { color: C.water() })], { showlegend: false, margin: { b: 100 }, yaxis: { title: { text: "kW per m² (planar estimate)" } } });
      };
      zones.forEach((z) => {
        const tb = h("tbody", {});
        const draw = () => {
          clear(tb);
          z.w.layers.forEach((l, i) => {
            const mat = h("select", { disabled: !can || null, onchange: () => { l.material = mat.value; recompute(); } }, refr.materials.map((m) => h("option", { value: m.key, selected: m.key === l.material || null }, labelize(m.key))));
            const th = h("input", { type: "number", min: 0.005, max: 3, step: 0.005, value: l.thickness_m, style: { width: "84px" }, disabled: !can || null, onchange: () => { l.thickness_m = Number(th.value); recompute(); } });
            tb.append(h("tr", {}, h("td", {}, i === 0 ? "hot face" : i === z.w.layers.length - 1 ? "cold side" : ""), h("td", {}, mat), h("td", {}, th), h("td", { class: "n" }, fmt((R[l.material] || {}).k_W_mK, 1))));
          });
        };
        draw();
        out.append(h("div", { class: "panel" }, h("header", {}, h("h2", {}, labelize(z.name)), h("span", { class: "sub" }, `${z.w.cooling ? z.w.cooling.type.replace(/_/g, " ") : ""}, hot-side h ${z.w.h_in_W_m2K} W/m²K`)),
          h("div", { class: "body flush" }, h("table", { class: "t" }, h("thead", {}, h("tr", {}, h("th", {}, ""), h("th", {}, "Material"), h("th", {}, "Thickness m"), h("th", { class: "n" }, "k W/m·K"))), tb))));
      });
      recompute();
      const comment = h("input", { placeholder: "Why this lining change (audit)" });
      return h("div", { class: "body" }, h("p", { class: "note" }, "The live twin solves transient multi-layer conduction with temperature-dependent hot-face skull, water-side forced convection (Dittus-Boelter) and shell radiation plus natural convection. The table below is a quick planar steady-state check while you edit."),
        h("div", { class: "grid g2" }, panel("Lining summary", "planar, steady", sum), panel("Estimated heat flux", "per zone", h("div", { class: "body flush" }, fluxChart))),
        h("div", { style: { marginTop: "12px" } }, out),
        can ? h("div", { class: "form", style: { marginTop: "10px" } }, field("Comment", comment), h("button", { class: "btn primary", onclick: async () => {
          if (!(await confirmDialog("Save lining design", "Save the edited lining as a new configuration version and rebuild the twin?", "Save and rebuild"))) return;
          try { after(await api.put("/api/v1/config/plant", { config: { ...cfg, walls: work }, expected_version: cf.version, comment: comment.value || "refractory lining edit" }, { timeoutMs: 120000 })); }
          catch (e) { toast(errorMsg(e), "err", 12000); }
        } }, "Save lining as new version")) : null);
    }

    function jsonEditor() {
      const ta = h("textarea", { class: "code", spellcheck: "false", disabled: !can || null });
      editorTa = ta;
      ta.value = JSON.stringify(cfg, null, 2);
      const msg = h("div", {});
      const comment = h("input", { placeholder: "Comment (audit)" });
      return h("div", { class: "body" }, h("p", { class: "note" }, "Advanced: every section of the plant configuration - materials and chemistry, coke and PCI quality, kinetics calibration, tapping practice, constraints, economics. Saving uses optimistic concurrency: if someone else saved meanwhile, you are asked to reload."),
        ta, msg, can ? h("div", { class: "form", style: { marginTop: "8px" } }, field("Comment", comment), h("button", { class: "btn", onclick: () => {
          try { JSON.parse(ta.value); clear(msg).append(badge("valid JSON", "ok")); } catch (e) { clear(msg).append(badge(`JSON error: ${e.message}`, "crit")); }
        } }, "Check JSON"), h("button", { class: "btn primary", onclick: async () => {
          let obj;
          try { obj = JSON.parse(ta.value); } catch (e) { clear(msg).append(badge(`JSON error: ${e.message}`, "crit")); return; }
          try { after(await api.put("/api/v1/config/plant", { config: obj, expected_version: cf.version, comment: comment.value }, { timeoutMs: 120000 })); }
          catch (e) { clear(msg).append(h("div", { class: "banner crit" }, errorMsg(e))); }
        } }, "Validate and save")) : null,
        h("div", { style: { marginTop: "8px", display: "flex", gap: "8px" } }, h("button", { class: "btn", onclick: () => downloadText(JSON.stringify(cfg, null, 2), `bf_config_v${cf.version}.json`, "application/json") }, "Download configuration"),
          h("a", { class: "btn", href: `${API_BASE}/api/v1/config/schema`, target: "_blank", rel: "noopener" }, "Open JSON schema")));
    }
  },
  unmount: unmountCharts,
};

// ========================================================================================== admin
export const admin = {
  title: "Administration",
  purpose: "System status, accounts, jobs, the audit trail and the safety case of this deployment.",
  async mount(root) {
    const st = await refreshStatus();
    const [demo, safety, jobs] = await Promise.all([api.get("/api/v1/auth/demo-accounts"), api.get("/api/v1/mpc/safety-case"), api.get("/api/v1/system/jobs")]);
    const me = auth.token ? await api.get("/api/v1/auth/me").catch(() => null) : null;
    const auditBox = h("div", { class: "body" });
    root.append(h("div", { class: "grid g2" },
      panel("System status", st ? st.label : "", h("div", { class: "body" }, st ? kv(st, (k, v) => (Array.isArray(v) ? v.join("; ") || "-" : typeof v === "number" ? fmt(v, 2) : String(v ?? "-"))) : "Backend not reachable")),
      panel("Session", me ? `signed in as ${me.sub}` : "not signed in (viewer)", h("div", { class: "body" }, me ? kv({ user: me.sub, role: me.role, roles_hierarchy: (me.roles_hierarchy || []).join(" < ") }) : h("p", {}, "Use Sign in in the top bar."),
        h("h3", {}, "Demo accounts"), demo.demo_accounts.length ? table([{ label: "Username", key: "username" }, { label: "Role", key: "role" }], demo.demo_accounts) : h("p", {}, "None."),
        h("p", { class: "note" }, `Password: ${demo.password_source}. Anonymous viewer access: ${demo.anonymous_viewer ? "on" : "off"}.`))),
      panel("Safety case", "why this release cannot move the furnace", h("div", { class: "body" }, kv({ advisory_only: safety.advisory_only, plant_write_path: safety.plant_write_path, allow_plant_writes_setting: safety.allow_plant_writes_setting,
        acknowledge_effect: safety.acknowledge_effect }), h("ul", {}, safety.release_checks.map((c) => h("li", {}, c))), h("p", { class: "note" }, safety.future_gateway))),
      panel("Service endpoints", "for monitoring", h("div", { class: "body" }, h("ul", {}, [["/health", "liveness"], ["/ready", "readiness (twin initialised)"], ["/metrics", "Prometheus-style metrics"], ["/docs", "OpenAPI (Swagger UI)"], ["/redoc", "API reference (ReDoc)"]]
        .map(([p, d]) => h("li", {}, h("a", { href: `${API_BASE}${p}`, target: "_blank", rel: "noopener" }, p), ` - ${d}`))))),
      h("div", { class: "spanall" }, panel("Background jobs", "simulations, studies, identification, training", h("div", { class: "body flush" }, table([{ label: "Created", get: (j) => dateTimeUTC(j.created_utc) },
        { label: "Kind", key: "kind" }, { label: "Status", get: (j) => badge(j.status.toLowerCase(), j.status === "SUCCEEDED" ? "ok" : j.status === "FAILED" ? "crit" : "") }, { label: "Progress", get: (j) => `${Math.round((j.progress || 0) * 100)} %` },
        { label: "Message", key: "message" }, { label: "By", key: "created_by" }], jobs.jobs, { maxHeight: "320px" })))),
      h("div", { class: "spanall" }, panel("Audit trail", "administrator only", auditBox))));
    if (!hasRole("ADMIN")) { auditBox.append(h("p", {}, "Sign in as admin to read the audit trail.")); return; }
    try {
      const a = await api.get("/api/v1/system/audit", { limit: 500 });
      const actions = ["all", ...new Set(a.events.map((e) => e.action))];
      const tbl = h("div", {});
      const draw = (act) => clear(tbl).append(table([{ label: "Time (UTC)", get: (e) => dateTimeUTC(e.ts) }, { label: "Actor", key: "actor" }, { label: "Role", key: "role" }, { label: "Action", key: "action" },
        { label: "Target", key: "target" }, { label: "Detail", get: (e) => h("span", { class: "mono wrap-anywhere" }, JSON.stringify(e.detail || {}).slice(0, 240)) }], a.events.filter((e) => act === "all" || e.action === act), { maxHeight: "460px" }));
      auditBox.append(field("Action", h("select", { onchange: (e) => draw(e.target.value) }, actions.map((x) => h("option", { value: x }, x)))), tbl,
        h("button", { class: "btn", style: { marginTop: "8px" }, onclick: () => downloadText(["ts,actor,role,action,target,detail", ...a.events.map((e) => [e.ts, e.actor, e.role, e.action, e.target, JSON.stringify(e.detail || {}).replace(/"/g, "'")].map((x) => `"${x}"`).join(","))].join("\n"), "bf_audit.csv") }, "Download audit CSV"));
      draw("all");
    } catch (e) { auditBox.append(errorMsg(e)); }
  },
  unmount: unmountCharts,
};

// =========================================================================================== help
export const help = {
  title: "Help",
  purpose: "How to read the displays, what the colours mean and where the limits of the model are.",
  async mount(root) {
    root.append(h("div", { class: "grid g2 help" },
      panel("Reading the displays", "", h("div", { class: "body" },
        h("p", {}, "Screens follow the ISA-101 hierarchy: plant overview (L1), process units (L2), engineering detail (L3) and decision support (L4). Grey is normal; colour is reserved for abnormal states, provenance and molten material."),
        h("h3", {}, "Value provenance"), table([{ label: "Mark", get: (r) => h("span", { class: `prov ${r.c}`, style: { position: "static" } }, r.t) }, { label: "Meaning", key: "m" }], [
          { c: "measured", t: "Measured", m: "A sensor or laboratory value from the active data source. In demo mode the source is the synthetic plant, and the strip says so." },
          { c: "model", t: "Model", m: "Computed by the physics twin (a virtual sensor). Never a measurement." },
          { c: "hybrid", t: "Hybrid", m: "Physics combined with plant data: the observer's bias-corrected estimate, or a forecast with a bounded ML residual correction (only inside the training domain, and only for a model that beat its baselines)." },
          { c: "derived", t: "Derived", m: "Calculated from other values (for example cost per tonne)." }]),
        h("h3", {}, "Alarm colours"), h("p", {}, "Amber outline: alarm limit crossed. Red outline: hard limit crossed. Alarms list evidence and possible causes; they do not prove a root cause."))),
      panel("Workflow", "", h("div", { class: "body" }, h("ol", {},
        h("li", {}, "Check the strip: data source, freshness, model health, balance and data quality. Advice is suppressed when any of these fail."),
        h("li", {}, "Read the thermal state on the overview, then the hearth and the profiles for the reason."),
        h("li", {}, "Look at forecasts (with intervals) before acting on a trend."),
        h("li", {}, "Compute an advisory recommendation. Read its checks and the physics verification, then acknowledge or reject it. Any setpoint change is made by the operator on the DCS."),
        h("li", {}, "Use what-if scenarios to test an idea on a clone of the twin before discussing it.")))),
      panel("Model scope and limits", "", h("div", { class: "body" }, h("ul", {},
        h("li", {}, "1-D axial (fast) or 2-D axial-radial (hi-fi) finite-volume model with lumped hearth and refractory walls. It is calibrated to an illustrative furnace, not to your plant."),
        h("li", {}, "Short-horizon response of hot metal temperature to the coke rate is weak in the fast model; the coke lever is therefore opt-in for the optimiser."),
        h("li", {}, "Forecast models are trained on simulator data and labelled NOT APPROVED FOR PLANT USE."),
        h("li", {}, "No plant-write path exists. Supervised control would need a separately engineered, safety-assessed on-premises gateway.")))),
      panel("Glossary", "", h("div", { class: "body" }, kv({ HMT: "hot metal temperature at tapping", RAFT: "raceway adiabatic flame temperature", "ηCO": "top gas CO utilisation CO2/(CO+CO2)",
        "Cohesive zone": "softening-melting layer between ~1150 and ~1450 °C", Deadman: "stagnant coke bed in the hearth centre", "Solution loss": "C + CO2 -> 2 CO (coke gasification)",
        "Rist diagram": "operating line of O/C versus O/Fe exchange", ROM: "reduced-order step-response model used by the linear MPC", EKF: "extended Kalman filter used to estimate slow model parameters",
        "Trust gate": "set of checks that must pass before any advice is shown" }, (k, v) => v))),
      panel("Keyboard", "", h("div", { class: "body" }, h("p", {}, "Tab moves through controls; Enter activates buttons; in the 3-D view drag to orbit, scroll to zoom, right-drag to pan."))),
      panel("About", "", h("div", { class: "body" }, h("p", {}, "Blast Furnace Digital Twin, Process Simulator and Advisory Control - Extractmet Private Limited. Demonstration build on synthetic data; not connected to any physical furnace."),
        h("p", {}, `Frontend build ${import.meta.env.MODE}; backend ${(state.status || {}).app_version || "?"}, model ${(state.status || {}).model_version || "?"}.`)))));
  },
};
