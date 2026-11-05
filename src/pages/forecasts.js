import { api, hasRole } from "../lib/api.js";
import { C, SERIES, bars, line, plot, points, purge } from "../lib/charts.js";
import { badge, clear, errorMsg, fmt, h, kv, panel, table, toast } from "../lib/ui.js";

const charts = new Set();
const chart = (cls = "chart") => { const el = h("div", { class: cls }); charts.add(el); return el; };

export default {
  title: "Forecasts and AI/ML",
  purpose: "Hot metal temperature and silicon forecasts: the physics twin run forward plus the observer, and a bounded ML residual correction where a model exists. Every model states its training data, test metrics against baselines and approval status.",
  async mount(root, ctx) {
    const fc = chart("chart tall"), fcSi = chart("chart"), met = chart("chart tall"), imp = chart("chart tall");
    const box = h("div", { class: "body" }), reg = h("div", { class: "body" }), diag = h("div", { class: "body" });
    ctx.actions(h("button", { class: "btn primary", onclick: run }, "Run forecast"),
      hasRole("PROCESS_ENGINEER") ? h("button", { class: "btn", onclick: train }, "Retrain on shipped history") : null);
    root.append(h("div", { class: "banner warn" }, "Forecast models in this demo are trained on SIMULATOR data (DEMO-SYNTHETIC) and are not approved for plant use. Plant use requires retraining and validation on site data."),
      h("div", { class: "grid g2" },
        panel("Forecast", "with 95 % intervals", h("div", { class: "body flush" }, fc, fcSi, box)),
        panel("Test-block metrics vs baselines", "RMSE, chronological split", h("div", { class: "body flush" }, met)),
        panel("Model registry", "provenance", reg),
        panel("Feature importance", "permutation, test block", h("div", { class: "body flush" }, imp)),
        h("div", { class: "spanall" }, panel("Diagnostics", "coverage, OOD, drift", diag))));
    async function run() {
      clear(box).append(h("p", { class: "note" }, "Running the twin forward on a clone (a few seconds)..."));
      try {
        const r = await api.post("/api/v1/forecast", { horizons_min: [60, 120, 240, 480], targets: ["hmt", "si"] }, { timeoutMs: 90000 });
        const hz = r.horizons.map((x) => x.horizon_minutes / 60);
        const P = (name) => r.horizons.map((x) => x.predictions[name]);
        const hm = P("hot_metal_temperature"), si = P("hot_metal_silicon");
        plot(fc, [
          { type: "scatter", mode: "lines", x: hz, y: hm.map((p) => p.upper95), line: { width: 0 }, showlegend: false, hoverinfo: "skip" },
          { type: "scatter", mode: "lines", x: hz, y: hm.map((p) => p.lower95), fill: "tonexty", fillcolor: "rgba(106,76,147,.15)", line: { width: 0 }, name: "HMT 95 % interval" },
          line(hz, hm.map((p) => p.value), "HMT forecast", { color: C.hybrid(), mode: "lines+markers" }),
          line(hz, hm.map((p) => p.physics_forecast), "Physics only (no observer)", { color: C.model(), dash: "dash" }),
          line(hz, hm.map((p) => (p.hybrid && p.hybrid.value !== undefined && !p.hybrid.promoted ? p.hybrid.value : null)), "ML shadow (not promoted)", { color: C.hybrid(), dash: "dot", width: 1.4 }),
          ], { xaxis: { title: { text: "Horizon (h)" } }, yaxis: { title: { text: "HMT °C" } } });
        plot(fcSi, [line(hz, si.map((p) => p.upper95), "Si upper 95 %", { color: "rgba(0,0,0,0)", width: 0 }),
          { ...line(hz, si.map((p) => p.lower95), "Si 95 % interval", { color: "rgba(0,0,0,0)", width: 0 }), fill: "tonexty", fillcolor: "rgba(106,76,147,.15)" },
          line(hz, si.map((p) => p.value), "Si forecast", { color: C.hybrid(), mode: "lines+markers" })],
        { xaxis: { title: { text: "Horizon (h)" } }, yaxis: { title: { text: "Si wt%" }, tickformat: ".2f" }, showlegend: false });
        clear(box).append(table([{ label: "Horizon", get: (x) => `${x.horizon_minutes / 60} h` },
          { label: "HMT °C", get: (x) => fmt(x.predictions.hot_metal_temperature.value, 0) }, { label: "95 % band", get: (x) => `${fmt(x.predictions.hot_metal_temperature.lower95, 0)}-${fmt(x.predictions.hot_metal_temperature.upper95, 0)}` },
          { label: "Method", get: (x) => badge(x.predictions.hot_metal_temperature.status.toLowerCase().replace(/_/g, " "), x.predictions.hot_metal_temperature.status === "HYBRID" ? "hybrid" : "model") },
          { label: "ML shadow °C", get: (x) => { const hy = x.predictions.hot_metal_temperature.hybrid; return hy && hy.value !== undefined ? `${fmt(hy.value, 0)}${hy.ood ? " (OOD)" : ""}` : "-"; } },
          { label: "Si %", get: (x) => fmt(x.predictions.hot_metal_silicon.value, 2) }, { label: "Si method", get: (x) => x.predictions.hot_metal_silicon.status.toLowerCase().replace(/_/g, " ") }], r.horizons),
        h("p", { class: "note" }, `Run ${r.run_id.slice(0, 8)} at data time ${r.timestamp_utc}. Balance ${r.balance_quality.status}. Advisory eligibility: ${r.recommendation_eligible ? "yes" : "no"}.`),
        ...r.warnings.map((w) => h("p", { class: "note" }, w)));
      } catch (e) { clear(box).append(h("div", { class: "banner crit" }, errorMsg(e))); }
    }
    async function registry() {
      const [r, d] = await Promise.all([api.get("/api/v1/models/registry"), api.get("/api/v1/models/diagnostics")]);
      clear(reg);
      if (!r.models.length) { reg.append(h("div", { class: "empty" }, "No trained model - forecasts use the physics twin plus observer only.")); return; }
      reg.append(table([{ label: "Model", key: "model_id" }, { label: "Target", key: "target" }, { label: "Horizon h", key: "horizon_h", num: true, d: 1 }, { label: "Rows", key: "dataset_rows", num: true, d: 0 },
        { label: "Beats baselines", get: (m) => badge(m.beats_baselines_on_test ? "yes - promoted" : "no - shadow", m.beats_baselines_on_test ? "ok" : "") },
        { label: "Shrinkage α", key: "correction_shrinkage_alpha", num: true, d: 1 }, { label: "Scope", get: (m) => badge(m.scope || "-", "hybrid") },
        { label: "Approval", get: (m) => badge((m.approval_status || "").toLowerCase().replace(/_/g, " "), "warn") }], r.models), h("p", { class: "note" }, r.policy));
      const ms = d.models;
      const names = ms.map((m) => `${m.target} ${m.horizon_h} h`);
      const get = (b) => ms.map((m) => (m.metrics && m.metrics.test && m.metrics.test[b] ? m.metrics.test[b].RMSE : null));
      plot(met, [bars(names, get("hybrid"), "Hybrid", { color: C.hybrid() }), bars(names, get("physics_only"), "Physics + observer", { color: C.model() }),
        bars(names, get("persistence"), "Persistence", { color: C.ink3() }), bars(names, get("arx_ridge"), "ARX ridge", { color: SERIES[6] })],
      { barmode: "group", yaxis: { title: { text: "RMSE (target units)" }, type: "log" } });
      const m0 = ms.find((m) => m.feature_importance) || {};
      const fi = (m0.feature_importance || []).slice().reverse();
      plot(imp, [bars(fi.map((f) => f.feature), fi.map((f) => f.importance), "importance", { color: C.hybrid(), orientation: "h" })],
        { margin: { l: 150, r: 10, t: 6, b: 30 }, showlegend: false, xaxis: { title: { text: `Permutation importance (${m0.model_id || ""})` } } });
      clear(diag).append(table([{ label: "Model", key: "model_id" }, { label: "Test n", get: (m) => fmt(m.metrics && m.metrics.test.hybrid.n, 0) },
        { label: "Coverage 95 %", get: (m) => fmt(m.metrics && m.metrics.test.interval95_coverage, 2) }, { label: "OOD fraction", get: (m) => fmt(m.metrics && m.metrics.test.ood_fraction, 3) },
        { label: "± 95 %", key: "interval_half_width_95", num: true, d: 3 }, { label: "Drifted features", get: (m) => ((m.drift && m.drift.drifted) || []).slice(0, 5).join(", ") || "none" },
        { label: "Train / validation / test rows", get: (m) => (m.split ? ["train", "validation", "test"].map((b) => (m.split[b] ? `${m.split[b][0]}-${m.split[b][1]}` : "?")).join("  |  ") : "-") }], ms),
      h("p", { class: "note" }, "Chronological train / validation / test blocks with an embargo gap; intervals are split-conformal from the validation block; features outside the training domain (Mahalanobis in the principal subspace) disable the ML correction. The ML correction is shrunk by a factor chosen on the validation block, and a model is promoted to the primary forecast only if it beats both the physics + observer and the persistence baselines on the held-out test block; otherwise it runs in shadow."));
    }
    async function train() {
      try { const j = await api.post("/api/v1/models/train", { targets: ["hmt", "si"], source: "shipped_history" }); toast("Training started", "info");
        await api.waitJob(j.id); toast("Training finished - registry updated", "ok"); registry(); }
      catch (e) { toast(errorMsg(e), "err"); }
    }
    run(); registry().catch((e) => clear(reg).append(errorMsg(e)));
  },
  unmount() { charts.forEach(purge); charts.clear(); },
};
