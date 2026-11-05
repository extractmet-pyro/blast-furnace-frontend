import { api, hasRole } from "../lib/api.js";
import { C, SERIES, limitShapes, line, plot, purge, Plotly } from "../lib/charts.js";
import { config } from "../lib/store.js";
import { badge, clear, errorMsg, field, fmt, h, kv, labelize, panel, pu, table, timeUTC, toast } from "../lib/ui.js";
import { limitsOf } from "./common.js";

const charts = new Set();
const chart = (cls = "chart") => { const el = h("div", { class: cls }); charts.add(el); return el; };
const STATUS_KIND = { PROPOSED: "info", ACKNOWLEDGED: "ok", REJECTED: "", ADVICE_SUPPRESSED: "warn", NO_FEASIBLE_SOLUTION: "crit", NO_ACTIVE_MV: "warn", TIMEOUT: "warn", EXPIRED: "", STUDY_ONLY: "" };

export default {
  title: "Advisory MPC",
  purpose: "Constrained model-predictive recommendations for thermal control. Each proposal passes a trust gate, a QP with hard limits and an independent physics re-simulation. Acknowledging only records the decision - nothing is written to plant systems.",
  async mount(root) {
    const cfg = (await config()).config;
    const lim = limitsOf(cfg);
    const model = await api.get("/api/v1/mpc/model");
    const out = h("div", {}), hist = h("div", { class: "body" }), modelBox = h("div", { class: "body" });
    const gains = chart("chart tall");
    const tHMT = h("input", { type: "number", step: "1", value: (cfg.targets.hmt_C[0] + cfg.targets.hmt_C[1]) / 2 });
    // Si is zone-controlled by default (held inside its window); a number here makes it a setpoint
    const tSi = h("input", { type: "number", step: "0.01", placeholder: `zone ${cfg.targets.si_pct[0]}-${cfg.targets.si_pct[1]}` });
    const method = h("select", {}, h("option", { value: "linear" }, "Linear MPC (ROM, OSQP)"), h("option", { value: "nmpc_physics" }, "Nonlinear (physics shooting, slow)"));
    const econ = h("input", { type: "number", step: "0.5", min: 0, max: 50, value: 0 });
    const avail = {};
    const mvs = model.available ? model.mvs : ["blast_temp_C", "blast_moisture_g_Nm3", "o2_enrichment_pct", "pci_t_h", "blast_volume_Nm3_min", "coke_batch_t"];
    const avBox = h("div", { style: { display: "flex", flexWrap: "wrap", gap: "8px" } }, mvs.map((mv) => {
      avail[mv] = h("input", { type: "checkbox", checked: mv !== "coke_batch_t" ? true : null });
      return h("label", { class: "chip" }, avail[mv], " ", (model.mv_defs && model.mv_defs[mv] ? model.mv_defs[mv].label : mv));
    }));
    const btn = h("button", { class: "btn primary", disabled: !hasRole("OPERATOR") || null, onclick: compute }, "Compute advisory");
    root.append(h("div", { class: "banner advisory" }, "Advisory only. This release contains no plant-write path; a recommendation is a proposal for the operator, valid for 30 minutes."),
      h("div", { class: "grid g2" },
        panel("Request", hasRole("OPERATOR") ? "" : "sign in as operator or higher", h("div", { class: "body" },
          h("div", { class: "form" }, field("HMT target °C", tHMT), field("Si setpoint wt% (blank = zone)", tSi), field("Method", method), field("Economic weight", econ)),
          h("p", { class: "note" }, "Manipulated variables available to the optimiser (coke batch is opt-in: its identified gain on HMT is weak in this model):"), avBox,
          h("div", { style: { marginTop: "10px" } }, btn))),
        panel("Prediction model", model.available ? `identified ${timeUTC(model.identified_utc)}` : "not identified", modelBox),
        h("div", { class: "spanall" }, out),
        panel("Model gains", "steady-state CV change for one identification step (ROM)", h("div", { class: "body flush" }, gains)),
        panel("Recommendation history", "audit trail", hist)));
    function stepOf(mv) {
      const d = (model.mv_defs || {})[mv] || {}, op = model.op_point || {};
      if (d.step !== null && d.step !== undefined) return d.step;
      if (mv === "pci_t_h") return Math.max(0.06 * op[mv], 0.5);
      if (mv === "blast_volume_Nm3_min") return 0.03 * op[mv];
      if (mv === "coke_batch_t") return 0.02 * op[mv];
      return 1;
    }
    renderModel();
    loadHistory();
    function renderModel() {
      clear(modelBox);
      if (!model.available) {
        modelBox.append(h("p", {}, "No step-response model yet."), hasRole("PROCESS_ENGINEER") ? h("button", { class: "btn", onclick: identify }, "Identify on the twin") : null);
        return;
      }
      modelBox.append(kv({ sample_time_min: model.Ts_min, prediction_horizon_h: (model.N * model.Ts_min) / 60, source: model.source,
        identification_wall_s: model.ident_seconds }, (k, v) => (typeof v === "number" ? fmt(v, 1) : String(v))),
      h("p", { class: "note" }, "Identified by symmetric step tests on clones of the physics twin at the operating point below. The model is linear: it is trusted only near that point, which the trust gate checks."),
      table([{ label: "MV", get: (r) => model.mv_defs[r.mv].label }, { label: "Operating point", get: (r) => `${fmt(r.v, 2)} ${pu(model.mv_defs[r.mv].unit)}` },
        { label: "Test step", get: (r) => `±${fmt(stepOf(r.mv), 2)}` }, { label: "HMT t63 h", get: (r) => fmt(model.t63_h.hmt_C && model.t63_h.hmt_C[r.mv], 2) }],
      model.mvs.map((mv) => ({ mv, v: model.op_point[mv] }))),
      hasRole("PROCESS_ENGINEER") ? h("button", { class: "btn", style: { marginTop: "8px" }, onclick: identify }, "Re-identify on the current state") : null);
      const G = model.gain || [];
      if (G.length) {
        const z = G.map((row, i) => row.map((v, j) => (v * stepOf(model.mvs[j])) / model.cv_defs[model.cvs[i]].scale));
        Plotly.react(gains, [{ type: "heatmap", z, zmin: -2, zmax: 2, x: model.mvs.map((m) => `${model.mv_defs[m].label} +${fmt(stepOf(m), 2)}`),
          y: model.cvs.map((c) => model.cv_defs[c].label), colorscale: [[0, "#1f5f86"], [0.5, "#f3f1ec"], [1, "#b5481f"]],
          text: G.map((row, i) => row.map((v, j) => `${(v * stepOf(model.mvs[j])).toPrecision(3)} ${pu(model.cv_defs[model.cvs[i]].unit)}`)), texttemplate: "%{text}",
          hovertemplate: "%{y} after a step of %{x}: %{text}<extra></extra>", colorbar: { title: { text: "× CV scale" } } }],
        { margin: { l: 170, r: 10, t: 10, b: 120 }, paper_bgcolor: "rgba(0,0,0,0)", plot_bgcolor: "rgba(0,0,0,0)", font: { size: 11, color: C.ink2() } }, { displaylogo: false, responsive: true });
      }
    }
    async function identify() {
      try { const j = await api.post("/api/v1/mpc/identify", { Ts_min: 15, horizon_h: 12 }); toast("Identification running on twin clones (about a minute)", "info");
        await api.waitJob(j.id); Object.assign(model, await api.get("/api/v1/mpc/model")); renderModel(); toast("Prediction model updated", "ok"); }
      catch (e) { toast(errorMsg(e), "err"); }
    }
    async function compute() {
      btn.disabled = true;
      clear(out).append(h("div", { class: "banner" }, "Computing: trust gate, optimisation, physics verification..."));
      try {
        const targets = { hmt_C: Number(tHMT.value) };
        if (tSi.value !== "") targets.hm_si_pct = Number(tSi.value);
        const body = { method: method.value, targets,
          availability: Object.fromEntries(Object.entries(avail).map(([k, el]) => [k, el.checked])), econ_weight: Number(econ.value) };
        let rec = await api.post("/api/v1/mpc/recommend", body, { timeoutMs: 180000 });
        if (rec.links) { const j = await api.waitJob(rec.id, null, { intervalMs: 2000 }); rec = await api.get(`/api/v1/simulations/${j.id}/results`); }
        render(rec);
        loadHistory();
      } catch (e) { clear(out).append(h("div", { class: "banner crit" }, errorMsg(e))); }
      btn.disabled = !hasRole("OPERATOR");
    }
    function render(rec) {
      clear(out);
      const kind = STATUS_KIND[rec.status] || "";
      const head = h("div", { class: `banner ${rec.status === "PROPOSED" ? "advisory" : kind === "crit" ? "crit" : "warn"}` },
        badge(rec.status.toLowerCase().replace(/_/g, " "), kind), ` Recommendation ${rec.id.slice(0, 8)} created ${timeUTC(rec.created_utc)}, valid until ${timeUTC(rec.expires_utc)}. `,
        rec.recommended_action || "", ...(rec.reasons || []).map((r) => h("div", { class: "note" }, r)));
      const gate = rec.trust_gate ? table([{ label: "Trust check", key: "k" }, { label: "Result", get: (r) => badge(r.v ? "pass" : "fail", r.v ? "ok" : "crit") }],
        Object.entries(rec.trust_gate.checks).map(([k, v]) => ({ k: k.replace(/_/g, " "), v }))) : null;
      const moves = rec.moves ? table([{ label: "Variable", get: (r) => (model.mv_defs && model.mv_defs[r.mv] ? `${model.mv_defs[r.mv].label} (${pu(model.mv_defs[r.mv].unit)})` : r.mv) }, { label: "Now", key: "now", num: true, d: 2 }, { label: "Moves per block", key: "blocks" },
        { label: "Final", key: "final", num: true, d: 2 }, { label: "Limits", key: "lim" }],
      Object.entries(rec.moves).map(([mv, d]) => {
        const L = rec.constraints && rec.constraints.mvs[mv];
        return { mv, now: rec.u_now[mv], blocks: d.map((x) => (x >= 0 ? "+" : "") + x.toFixed(2)).join("  "), final: rec.u_now[mv] + d.reduce((a, b) => a + b, 0),
          lim: L ? `${fmt(L.lo, 1)}-${fmt(L.hi, 1)}, rate ${fmt(L.rate_per_15min, 2)}/15 min` : "" };
      })) : null;
      const expl = rec.explanation ? h("ul", {}, rec.explanation.map((x) => h("li", {}, pu(x)))) : null;
      const trj = h("div", { style: { width: "100%", height: "520px" } }); charts.add(trj);
      const ack = rec.status === "PROPOSED" && hasRole("OPERATOR") ? ackForm(rec) : null;
      out.append(head, h("div", { class: "grid g2" },
        panel("Proposed moves", rec.blocks ? `move blocks at samples ${rec.blocks.join(", ")} (${rec.Ts_min} min each)` : "", h("div", { class: "body" }, targetsNote(rec), moves || h("p", {}, "No moves."), expl, ack)),
        panel("Checks", "trust gate and verification", h("div", { class: "body" }, gate,
          rec.verification ? h("div", { style: { marginTop: "8px" } }, badge(rec.verification.passed ? "physics verification passed" : rec.verification.skipped ? "verification skipped (study)" : "physics verification failed", rec.verification.passed ? "ok" : "warn"),
            ...(rec.verification.issues || []).map((i) => h("div", { class: "note" }, i))) : null,
          rec.solver ? kv({ solver: rec.solver.name, status: rec.solver.status, seconds: rec.solver.seconds, objective_before: rec.objective && rec.objective.before ? rec.objective.before.tracking : null,
            objective_after: rec.objective && rec.objective.after ? rec.objective.after.tracking : null }, (k, v) => (typeof v === "number" ? fmt(v, 4) : String(v))) : null)),
        h("div", { class: "spanall" }, panel("Predicted trajectories", "free response vs optimised (ROM) and physics re-simulation", h("div", { class: "body flush" }, trj)))));
      if (rec.predicted_free) {
        // three stacked panels sharing the time axis: HMT (with limits and target), Si, RAFT
        const pf = rec.predicted_free, po = rec.predicted_optimized || {};
        const ver = (rec.verification && rec.verification.trajectory) || [];
        const traces = [];
        const cvs = [["hmt_C", "HMT", "y", "°C"], ["hm_si_pct", "Si", "y2", "wt%"], ["raft_C", "RAFT", "y3", "°C"]];
        cvs.forEach(([c, name, ax], i) => {
          const show = i === 0;
          traces.push({ ...line(pf.t_h, pf[c], "Free response (no move)", { color: C.ink3(), dash: "dot" }), yaxis: ax, showlegend: show, legendgroup: "free" });
          if (po[c]) traces.push({ ...line(po.t_h, po[c], "With proposed moves (ROM)", { color: C.model() }), yaxis: ax, showlegend: show, legendgroup: "opt" });
          if (ver.length && ver[0][c] !== undefined) traces.push({ ...line(ver.map((v) => v.t_h), ver.map((v) => v[c]), "Physics re-simulation", { color: C.molten(), dash: "dash", width: 1.4 }), yaxis: ax, showlegend: show, legendgroup: "ver" });
        });
        const tg = rec.targets || {};
        const shapes = [...limitShapes(lim.hmt_C).map((s) => ({ ...s, yref: "y" }))];
        if (tg.hmt_C !== undefined) shapes.push({ type: "line", xref: "paper", x0: 0, x1: 1, yref: "y", y0: tg.hmt_C, y1: tg.hmt_C, line: { color: C.ok(), width: 1.5 } });
        if (tg.hm_si_pct !== undefined) shapes.push({ type: "line", xref: "paper", x0: 0, x1: 1, yref: "y2", y0: tg.hm_si_pct, y1: tg.hm_si_pct, line: { color: C.ok(), width: 1.5 } });
        plot(trj, traces, { height: 520, xaxis: { title: { text: "Hours ahead" }, anchor: "y3" },
          yaxis: { domain: [0.69, 1], title: { text: "HMT °C" } }, yaxis2: { domain: [0.36, 0.64], title: { text: "Si wt%" }, tickformat: ".2f" },
          yaxis3: { domain: [0, 0.31], title: { text: "RAFT °C" }, tickformat: ",.0f" }, shapes, legend: { orientation: "h", y: 1.08 } });
      }
    }
    function targetsNote(rec) {
      if (!rec.targets) return null;
      const tb = rec.target_basis || {};
      const yn = rec.y_now || {};
      const parts = Object.entries(rec.targets).map(([k, v]) => `${k === "hmt_C" ? "HMT" : k === "hm_si_pct" ? "Si" : labelize(k)} ${fmt(yn[k], k === "hm_si_pct" ? 2 : 0)} → ${fmt(v, k === "hm_si_pct" ? 2 : 0)}${tb[k] ? ` (${tb[k]})` : ""}`);
      return h("p", { class: "note" }, `Now → target: ${parts.join("; ")}.`);
    }
    function ackForm(rec) {
      const comment = h("input", { placeholder: "Comment for the audit trail" });
      const act = async (decision) => {
        try { const r = await api.post(`/api/v1/mpc/recommendations/${rec.id}/acknowledge`, { decision, comment: comment.value }); toast(`${decision === "ACKNOWLEDGED" ? "Acknowledged" : "Rejected"} - recorded in the audit trail. ${r.plant_write}`, "ok"); loadHistory(); }
        catch (e) { toast(errorMsg(e), "err"); }
      };
      return h("div", { style: { marginTop: "10px", display: "grid", gap: "6px" } }, comment,
        h("div", { style: { display: "flex", gap: "8px" } }, h("button", { class: "btn primary", onclick: () => act("ACKNOWLEDGED") }, "Acknowledge"),
          h("button", { class: "btn danger", onclick: () => act("REJECTED") }, "Reject")),
        h("p", { class: "note" }, "Acknowledging records your decision only. Any setpoint change is made by the operator on the DCS, following site procedure."));
    }
    async function loadHistory() {
      try {
        const r = await api.get("/api/v1/mpc/recommendations", { limit: 30 });
        clear(hist).append(r.recommendations.length ? table([{ label: "Created", get: (x) => timeUTC(x.created_utc) }, { label: "Status", get: (x) => badge(x.status.toLowerCase().replace(/_/g, " "), STATUS_KIND[x.status] || "") },
          { label: "By", key: "requested_by" }, { label: "Summary", get: (x) => (x.explanation || x.reasons || []).slice(0, 1).join("") }],
        r.recommendations, { maxHeight: "340px", onRow: async (x) => render(await api.get(`/api/v1/mpc/recommendations/${x.id}`)) }) : h("div", { class: "empty" }, "No recommendations yet."));
      } catch (e) { clear(hist).append(errorMsg(e)); }
    }
  },
  unmount() { charts.forEach(purge); charts.clear(); },
};
