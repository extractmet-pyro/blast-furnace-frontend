import { api, hasRole } from "../lib/api.js";
import { C, bars, plot, purge } from "../lib/charts.js";
import { badge, clear, dateTimeUTC, errorMsg, h, kv, panel, table, toast } from "../lib/ui.js";

const charts = new Set();
const chart = (cls = "chart") => { const el = h("div", { class: cls }); charts.add(el); return el; };
const SEV = { CRITICAL: "crit", WARNING: "warn", INFO: "info" };
const RULES = [
  ["THERMAL_LOW", "Hot metal temperature below the alarm or hard limit", "HMT vs configured limits"],
  ["THERMAL_HIGH", "Hot metal temperature above the alarm limit", "HMT vs configured limits"],
  ["THERMAL_TREND", "Hot metal temperature changing faster than the trend limit", "slope of the last 90 samples"],
  ["SI_DEVIATION", "Hot metal Si outside the target window", "Si vs targets"],
  ["PERMEABILITY", "Bed pressure drop above the alarm or hard limit", "dP vs configured limits"],
  ["HANGING_RISK", "Pressure-drop surge (hanging / slip proxy)", "dP rise rate"],
  ["TOP_GAS_EXCURSION", "Top gas temperature out of band", "top gas T (sensor-lagged)"],
  ["STAVE_HEAT_FLUX", "Bosh stave heat-load increase", "stave heat-load trend"],
  ["HEARTH_LEVEL_HIGH", "Liquid level approaching the tuyeres", "margin to tuyere level"],
  ["DATA_QUALITY", "Data-quality score low or a critical tag bad", "quality engine"],
  ["BALANCE_FAIL", "Model conservation check failed", "element and energy residuals"],
  ["MODEL_ENVELOPE", "Physics model outside its validated envelope", "integrator checks"],
  ["SENSOR_DRIFT_SUSPECT", "Observer innovations persistently large", "EKF innovation statistics"],
];

export default {
  title: "Alarms and events",
  purpose: "Process-event detection with the evidence behind every alarm. An alarm says what was detected and lists possible causes; it does not prove a root cause. Safety alarms and interlocks stay in the plant's DCS/SIS - this list is advisory.",
  async mount(root, ctx) {
    const act = h("div", { class: "body" }), log = h("div", { class: "body" }), ev = h("div", { class: "body" });
    const cnt = chart(), tl = chart("chart tall");
    ctx.actions(h("button", { class: "btn", onclick: load }, "Refresh"));
    root.append(h("div", { class: "banner" }, "Advisory alarm list. It is not part of any safety function and does not replace DCS alarms, the SIS or interlocks."),
      h("div", { class: "grid g2" },
        h("div", { class: "spanall" }, panel("Active alarms", "highest severity first", act)),
        panel("Alarm counts", "log in this session", h("div", { class: "body flush" }, cnt)),
        panel("Detection rules", "what each code means", h("div", { class: "body flush" }, table([{ label: "Code", key: 0 }, { label: "Detects", key: 1 }, { label: "Evidence used", key: 2 }],
          RULES.map((r) => ({ 0: r[0], 1: r[1], 2: r[2] })), { maxHeight: "300px" }))),
        h("div", { class: "spanall" }, panel("Alarm timeline", "raise and clear events (data time)", h("div", { class: "body flush" }, tl))),
        panel("Alarm log", "most recent first", log),
        panel("System events", "mode changes, faults, jobs, configuration", ev)));
    async function load() {
      try {
        const [a, e] = await Promise.all([api.get("/api/v1/alarms"), api.get("/api/v1/system/events", { limit: 300 })]);
        const active = Object.values(a.active).sort((x, y) => (y.severity === "CRITICAL") - (x.severity === "CRITICAL"));
        clear(act).append(active.length ? h("div", { style: { display: "grid", gap: "8px" } }, active.map(card)) : h("div", { class: "empty" }, "No active alarms."),
          h("p", { class: "note" }, a.classification));
        const L = a.log.slice().reverse();
        clear(log).append(table([{ label: "Data time", get: (x) => dateTimeUTC(x.cleared || x.last_seen) }, { label: "Code", key: "code" },
          { label: "Severity", get: (x) => badge(x.severity.toLowerCase(), SEV[x.severity]) }, { label: "State", get: (x) => x.state.toLowerCase() }, { label: "Message", key: "message" }],
        L, { maxHeight: "380px" }));
        const counts = {};
        a.log.forEach((x) => { if (x.state === "ACTIVE") counts[x.code] = (counts[x.code] || 0) + 1; });
        const codes = Object.keys(counts).sort((p, q) => counts[q] - counts[p]);
        plot(cnt, [bars(codes, codes.map((c) => counts[c]), "raised", { color: C.warn() })], { margin: { b: 110 }, showlegend: false, yaxis: { title: { text: "Raise / update events" } } });
        const ys = [...new Set(a.log.map((x) => x.code))];
        plot(tl, ["ACTIVE", "CLEARED"].map((st) => ({ type: "scatter", mode: "markers", name: st === "ACTIVE" ? "raised / updated" : "cleared",
          x: a.log.filter((x) => x.state === st).map((x) => x.cleared || x.last_seen), y: a.log.filter((x) => x.state === st).map((x) => x.code),
          marker: { symbol: st === "ACTIVE" ? "circle" : "x", size: 8, color: st === "ACTIVE" ? C.warn() : C.ok() } })),
        { margin: { l: 170 }, yaxis: { categoryorder: "array", categoryarray: ys }, xaxis: { type: "date", title: { text: "Data time (UTC)" } } });
        const E = e.events.slice().reverse();
        clear(ev).append(table([{ label: "Data time", get: (x) => dateTimeUTC(x.t_utc) }, { label: "Type", key: "type" }, { label: "Message", key: "message" }], E, { maxHeight: "380px" }));
      } catch (err) { clear(act).append(h("div", { class: "banner crit" }, errorMsg(err))); }
    }
    function card(a) {
      const comment = h("input", { placeholder: "Comment (audit)" });
      return h("div", { class: `alarmcard ${SEV[a.severity]}` },
        h("div", { style: { display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" } }, badge(a.severity.toLowerCase(), SEV[a.severity]), h("b", {}, a.code), h("span", {}, a.message),
          a.acknowledged_by ? badge(`acknowledged by ${a.acknowledged_by}`, "ok") : null),
        h("div", { class: "grid g2", style: { marginTop: "6px" } },
          h("div", {}, h("div", { class: "muted" }, "Evidence"), kv(a.evidence || {})),
          h("div", {}, h("div", { class: "muted" }, "Possible causes (not proven)"), h("ul", {}, (a.possible_causes || []).map((c) => h("li", {}, c))),
            h("div", { class: "muted" }, `First seen ${dateTimeUTC(a.first_seen)} - last ${dateTimeUTC(a.last_seen)}`))),
        !a.acknowledged_by && hasRole("OPERATOR") ? h("div", { style: { display: "flex", gap: "6px", marginTop: "6px" } }, comment,
          h("button", { class: "btn small", onclick: async () => {
            try { await api.post(`/api/v1/alarms/${a.id}/acknowledge`, { comment: comment.value }); toast(`${a.code} acknowledged`, "ok"); load(); }
            catch (e) { toast(errorMsg(e), "err"); }
          } }, "Acknowledge")) : null);
    }
    load();
    this._t = setInterval(load, 15000);
  },
  onEvent() { /* the 15 s refresh picks up new alarms; stream events also show in the strip */ },
  unmount() { clearInterval(this._t); charts.forEach(purge); charts.clear(); },
};
