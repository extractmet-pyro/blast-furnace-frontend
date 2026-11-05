import { api } from "../lib/api.js";
import { C, band, limitShapes, line, plot, points, purge, stack, targetBand } from "../lib/charts.js";
import { config, geometry, state } from "../lib/store.js";
import { badge, clear, errorMsg, fmt, h, kpi, panel, seg, timeUTC } from "../lib/ui.js";
import { FIELD_LABEL, fieldRange, schematicSVG } from "../viz/schematic.js";
import { colorbar } from "./common.js";

let timers = [];
let field = "T_gas_C";

export default {
  title: "Plant overview",
  purpose: "Furnace state at a glance: the model's thermal field inside the furnace profile, key performance values, trends against targets and active alarms.",
  async mount(root, ctx) {
    const [geom, cfgv] = await Promise.all([geometry(), config()]);
    const limits = Object.fromEntries(cfgv.config.constraints.map((c) => [c.name, c]));
    const schem = h("div", {});
    const legend = h("div", { class: "note" });
    const fieldSel = seg([["T_gas_C", "Gas T"], ["T_solid_C", "Solid T"], ["reduction_degree_pct", "Reduction"], ["y_CO_pct", "CO"], ["ore_volume_fraction", "Ore fraction"]],
      field, (v) => { field = v; refresh(); });
    const tiles = h("div", { class: "kpis" });
    const tr = { hmt: h("div", { class: "chart short" }), si: h("div", { class: "chart short" }), prod: h("div", { class: "chart short" }), dp: h("div", { class: "chart short" }) };
    const alarmBox = h("div", { class: "body flush" });
    const evBox = h("ul", { class: "events" });
    const advice = h("div", { class: "body" });
    root.append(h("div", { class: "grid g-hero" },
      panel("Furnace cross-section", "model field, to scale", h("div", { class: "body" }, h("div", { style: { display: "flex", gap: "10px", alignItems: "center", flexWrap: "wrap", marginBottom: "6px" } }, fieldSel, legend), schem)),
      h("div", { class: "grid" },
        panel("Key values", "4-h window unless noted", h("div", { class: "body" }, tiles)),
        h("div", { class: "grid g2" },
          panel("Hot metal temperature", "model, observer-corrected, dips", h("div", { class: "body flush" }, tr.hmt)),
          panel("Hot metal silicon", "model vs lab", h("div", { class: "body flush" }, tr.si)),
          panel("Production and fuel rate", "", h("div", { class: "body flush" }, tr.prod)),
          panel("Bed pressure drop", "with alarm limits", h("div", { class: "body flush" }, tr.dp))),
        h("div", { class: "grid g2" },
          panel("Active alarms", "evidence, not proven cause", alarmBox, h("a", { href: "#/alarms", class: "btn" }, "All alarms")),
          panel("Advisory and forecast", "recommendations only", advice))),
      h("div", { class: "spanall" }, panel("Event log", "casts, mode changes, alarms, advice", h("div", { class: "body flush" }, evBox)))));

    async function refresh() {
      try {
        const [st, fl] = await Promise.all([api.get("/api/v1/twin/state"), api.get("/api/v1/twin/fields")]);
        let meas = {};
        try { const tl = await api.get("/api/v1/telemetry/latest"); meas = Object.fromEntries(tl.tags.filter((t) => t.quality === "GOOD").map((t) => [t.tag, t])); } catch { /* optional */ }
        schem.innerHTML = schematicSVG({ geom, fields: fl, st, meas, field, width: 760 });
        clear(legend).append(colorbar(field, fieldRange(field)), h("span", {}, FIELD_LABEL[field], " - model-computed (physics twin)"));
        renderTiles(st.kpis);
        renderAdvice(st);
      } catch (e) { clear(schem).append(h("div", { class: "banner crit" }, errorMsg(e))); }
    }
    function renderTiles(k) {
      clear(tiles).append(
        kpi("Production", k.production_t_d, { d: 0 }), kpi("Productivity", k.productivity_t_m3_d, { d: 2 }),
        kpi("Fuel rate", k.fuel_rate_kg_tHM, { d: 0 }), kpi("Coke rate", k.coke_rate_kg_tHM, { d: 0 }), kpi("PCI rate", k.pci_rate_kg_tHM, { d: 0 }),
        kpi("Hot metal temperature", k.hmt_C, { d: 0, limits: limits.hmt_C }),
        k.hmt_corrected_C ? kpi("HMT, observer-corrected", k.hmt_corrected_C, { d: 0, limits: limits.hmt_C }) : null,
        kpi("Hot metal Si", k.hm_si_pct, { d: 2, limits: limits.si_pct }), kpi("Hot metal S", k.hm_s_pct, { d: 3 }),
        kpi("CO utilisation", k.eta_CO_pct, { d: 1 }), kpi("Top gas temperature (uptake)", k.top_gas_T_uptake_C || k.top_gas_T_C, { d: 0, limits: limits.top_gas_temp_C }),
        kpi("Bed pressure drop", k.pressure_drop_kPa, { d: 0, limits: limits.pressure_drop_kPa }), kpi("Blast pressure", k.blast_pressure_kPa_g, { d: 0 }),
        kpi("RAFT", k.raft_C, { d: 0, limits: limits.raft_C }), kpi("Slag basicity B2", k.slag_B2, { d: 2 }), kpi("Heat losses", k.heat_loss_total_MW, { d: 1 }));
    }
    async function renderAdvice(st) {
      clear(advice);
      const fc = st.forecast_cache && st.forecast_cache.items ? Object.values(st.forecast_cache.items) : [];
      if (fc.length) {
        advice.append(h("p", { class: "note" }, "Cyclic forecasts (every 8 twin steps):"));
        for (const it of fc) advice.append(h("div", {}, `${it.target === "hmt" ? "HMT" : "Si"} in ${it.horizon_h} h: `,
          h("b", {}, fmt(it.prediction ?? it.physics_plus_observer, it.target === "hmt" ? 0 : 2)), " ", badge(it.status.toLowerCase().replace(/_/g, " "), it.status === "HYBRID" ? "hybrid" : "model"), " ",
          it.scope ? badge(it.scope, "") : null));
      } else advice.append(h("p", { class: "note" }, "No trained forecaster loaded - forecasts fall back to the physics twin plus observer."));
      try {
        const r = await api.get("/api/v1/mpc/recommendations", { limit: 1 });
        const last = r.recommendations[0];
        advice.append(h("p", { class: "note", style: { marginTop: "8px" } }, last ? [`Latest advisory ${last.id.slice(0, 8)}: `, badge(last.status.toLowerCase().replace(/_/g, " "), last.status === "PROPOSED" ? "info" : ""), ` at ${timeUTC(last.created_utc)}`] : "No advisory computed yet."),
          h("a", { class: "btn", href: "#/mpc" }, "Open advisory MPC"));
      } catch { /* role-limited */ }
    }
    async function trends() {
      try {
        const [th, tl] = await Promise.all([api.get("/api/v1/twin/history", { hours: 24, max_points: 500 }),
          api.get("/api/v1/telemetry/history", { tags: "HMT_DIP,HM_SI", max_points: 2000 })]);
        const t = th.rows.map((r) => r.t_utc);
        const dips = tl.rows.filter((r) => r.HMT_DIP !== undefined && r.HMT_DIP !== null);
        const si = tl.rows.filter((r) => r.HM_SI !== undefined && r.HM_SI !== null);
        const L = limits;
        plot(tr.hmt, [line(t, th.rows.map((r) => r.hmt_C), "Model", { color: C.model() }),
          line(t, th.rows.map((r) => r.hmt_corrected_C), "Observer-corrected", { color: C.hybrid(), dash: "dot" }),
          points(dips.map((r) => r.t_utc), dips.map((r) => r.HMT_DIP), "Dip (measured)", { color: C.measured(), size: 6 })],
        { shapes: [targetBand(...cfgv.config.targets.hmt_C), ...limitShapes(L.hmt_C)], yaxis: { title: { text: "°C" } }, showlegend: false, margin: { l: 46, r: 8, t: 6, b: 28 } });
        plot(tr.si, [line(t, th.rows.map((r) => r.hm_si_pct), "Model", { color: C.model() }),
          points(si.map((r) => r.t_utc), si.map((r) => r.HM_SI), "Lab", { color: C.measured(), size: 6, symbol: "diamond" })],
        { shapes: [targetBand(...cfgv.config.targets.si_pct)], yaxis: { title: { text: "wt%" } }, showlegend: false, margin: { l: 46, r: 8, t: 6, b: 28 } });
        stack(tr.prod, [{ title: "Production t/d", traces: [line(t, th.rows.map((r) => r.production_t_d), "Production t/d", { color: C.model() })] },
          { title: "Fuel kg/tHM", traces: [line(t, th.rows.map((r) => r.fuel_rate_kg_tHM), "Fuel kg/tHM", { color: C.model() })] }],
        { showlegend: false, margin: { l: 56, r: 8, t: 6, b: 28 } });
        plot(tr.dp, [line(t, th.rows.map((r) => r.pressure_drop_kPa), "ΔP", { color: C.model() })],
          { shapes: limitShapes(L.pressure_drop_kPa), yaxis: { title: { text: "kPa" } }, showlegend: false, margin: { l: 46, r: 8, t: 6, b: 28 } });
      } catch (e) { tr.hmt.textContent = errorMsg(e); }
    }
    async function alarmsAndEvents() {
      try {
        const a = await api.get("/api/v1/alarms");
        clear(alarmBox);
        if (!a.active.length) alarmBox.append(h("div", { class: "empty" }, "No active alarms."));
        for (const x of a.active.slice(0, 6)) alarmBox.append(h("div", { style: { padding: "6px 12px", borderBottom: "1px solid var(--line-soft)" } },
          badge(x.severity.toLowerCase(), x.severity === "CRITICAL" ? "crit" : "warn"), " ", x.message, h("div", { class: "note" }, `since ${timeUTC(x.first_seen)}`)));
        const ev = await api.get("/api/v1/system/events", { limit: 60 });
        clear(evBox).append(...ev.events.slice().reverse().map((e) => h("li", {}, h("time", {}, timeUTC(e.t_utc)), h("span", {}, e.type.toLowerCase()), h("span", {}, e.message))));
      } catch { /* ignore */ }
    }
    await refresh();
    trends(); alarmsAndEvents();
    timers.push(setInterval(refresh, 20000), setInterval(trends, 60000), setInterval(alarmsAndEvents, 15000));
    this._tr = tr;
  },
  onTick(ev) { /* tiles refresh with REST snapshots; the strip shows the live tick */ },
  unmount() { timers.forEach(clearInterval); timers = []; if (this._tr) Object.values(this._tr).forEach(purge); },
};
