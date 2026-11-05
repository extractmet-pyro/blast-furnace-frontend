import { api } from "../lib/api.js";
import { C, line, plot, points, purge, SERIES, stack } from "../lib/charts.js";
import { clear, errorMsg, field, h, labelize, panel, select, toast, unitOf } from "../lib/ui.js";

const PRESETS = {
  thermal: ["HMT_DIP", "HM_SI", "BL_TEMP", "BL_MOIST", "PCI_RATE"],
  gas: ["TG_CO", "TG_CO2", "TG_H2", "TG_TEMP", "TG_PRESS"],
  pressure: ["BL_PRESS", "DP_TOTAL", "SH_P_LOWER", "SH_P_MID", "SH_P_UPPER"],
  cooling: ["ST_Q_BOSH", "ST_Q_BELLY", "ST_Q_MID", "ST_Q_UPPER", "HTC_SUMP"],
};
const TWIN = ["hmt_C", "hmt_corrected_C", "hm_si_pct", "production_t_d", "fuel_rate_kg_tHM", "eta_CO_pct", "pressure_drop_kPa", "raft_C", "top_gas_T_uptake_C", "top_gas_T_C", "dripping_zone_height_m", "heat_loss_total_MW"];
let charts = [];

export default {
  title: "Trends and replay",
  purpose: "Measured tags with their quality flags next to the twin's virtual sensors. Switch to historical replay to drive the twin with a recorded period.",
  async mount(root) {
    const tags = (await api.get("/api/v1/tags")).tags;
    const avail = tags.filter((t) => t.installed !== false);
    let preset = "thermal";
    let hours = 24;
    const box = h("div", { class: "grid" });
    const tw = h("div", { class: "chart tall" });
    const twinSel = h("select", { multiple: true, size: 6, style: { minWidth: "220px" } }, TWIN.map((k) => h("option", { value: k, selected: ["hmt_C", "hmt_corrected_C"].includes(k) ? true : null }, k)));
    const replay = h("div", { class: "body" });
    root.append(h("div", { class: "grid g2" },
      panel("Measured tags", "with quality flags", h("div", { class: "body" }, h("div", { class: "form" },
        field("Tag group", select(Object.keys(PRESETS).map((k) => [k, k]), preset, (v) => { preset = v; draw(); })),
        field("Window", select([["6", "6 h"], ["12", "12 h"], ["24", "24 h"], ["48", "48 h"]], String(hours), (v) => { hours = +v; draw(); })))),
        ),
      panel("Twin virtual sensors", "model trajectories", h("div", { class: "body" }, h("div", { class: "form" }, field("Series (ctrl-click)", twinSel), h("button", { class: "btn", onclick: drawTwin }, "Plot"))))),
    box, panel("Twin trajectories", "", h("div", { class: "body flush" }, tw)), panel("Historical replay", "drive the twin with recorded data", replay));
    async function draw() {
      clear(box);
      charts.forEach(purge);
      charts = [];
      const list = PRESETS[preset].filter((t) => avail.find((a) => a.tag === t));
      try {
        const end = new Date().toISOString();
        const r = await api.get("/api/v1/telemetry/history", { tags: list.join(","), max_points: 1500 });
        const rows = r.rows;
        for (const tag of list) {
          const el = h("div", { class: "chart short" });
          box.append(panel(tag, (avail.find((a) => a.tag === tag) || {}).description || "", h("div", { class: "body flush" }, el)));
          const good = rows.filter((x) => x[tag] !== undefined && x[tag] !== null && x[tag + "__q"] === "GOOD");
          const bad = rows.filter((x) => x[tag] !== undefined && x[tag] !== null && x[tag + "__q"] && x[tag + "__q"] !== "GOOD");
          const isLab = (avail.find((a) => a.tag === tag) || {}).signal_type === "LAB";
          plot(el, [isLab ? points(good.map((x) => x.t_utc), good.map((x) => x[tag]), "GOOD", { color: C.measured(), size: 6 }) : line(good.map((x) => x.t_utc), good.map((x) => x[tag]), "GOOD", { color: C.measured(), width: 1.5 }),
            points(bad.map((x) => x.t_utc), bad.map((x) => x[tag]), "SUSPECT / BAD", { color: C.crit(), size: 6, symbol: "x" })],
          { yaxis: { title: { text: r.units[tag] || "" } }, margin: { l: 52, r: 8, t: 6, b: 28 } });
          charts.push(el);
        }
        if (!list.length) box.append(h("div", { class: "empty" }, "None of these tags are installed at this site."));
      } catch (e) { box.append(h("div", { class: "banner crit" }, errorMsg(e))); }
    }
    async function drawTwin() {
      const keys = [...twinSel.selectedOptions].map((o) => o.value);
      try {
        const r = await api.get("/api/v1/twin/history", { hours: 48, keys: keys.join(","), max_points: 1500 });
        // small multiples: one panel and one scale per selected variable (no dual axes)
        tw.style.height = `${Math.max(320, 130 * keys.length + 60)}px`;
        stack(tw, keys.map((k) => ({ title: `${labelize(k)}${unitOf(k) ? ` (${unitOf(k)})` : ""}`,
          traces: [line(r.rows.map((x) => x.t_utc), r.rows.map((x) => x[k]), labelize(k), { color: C.model() })] })),
        { showlegend: false, xaxis: { type: "date" }, margin: { l: 64, r: 10, t: 8, b: 30 } });
        charts.push(tw);
      } catch (e) { toast(errorMsg(e), "err"); }
    }
    async function replayPanel() {
      clear(replay);
      const st = await api.get("/api/v1/system/status");
      replay.append(h("p", {}, `Current mode: ${st.mode.replace(/_/g, " ").toLowerCase()}.`),
        st.replay ? h("p", {}, `Replaying ${st.replay.source}: ${st.replay.rows_done} of ${st.replay.rows} rows (${st.replay.start_utc} to ${st.replay.end_utc}).`) : null,
        h("p", { class: "note" }, "Replay feeds recorded tags (with their quality flags) through the same data-quality, twin and observer pipeline. Requires the process-engineer role. Upload a different file on the Data and quality display."),
        h("div", { style: { display: "flex", gap: "8px" } },
          h("button", { class: "btn primary", onclick: () => setMode("HISTORICAL_REPLAY") }, "Start replay"),
          h("button", { class: "btn", onclick: () => setMode("DEMO_SIMULATION") }, "Return to demo simulation")));
    }
    async function setMode(mode) {
      try { await api.post("/api/v1/system/mode", { mode, reason: "from trends display" }); toast(`Mode set to ${mode.toLowerCase().replace(/_/g, " ")}`, "ok"); replayPanel(); }
      catch (e) { toast(errorMsg(e), "err"); }
    }
    draw(); drawTwin(); replayPanel();
  },
  unmount() { charts.forEach(purge); charts = []; },
};
