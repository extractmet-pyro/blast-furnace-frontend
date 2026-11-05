import { api, hasRole } from "../lib/api.js";
import { C, bars, line, plot, points, purge, SERIES, stack } from "../lib/charts.js";
import { state } from "../lib/store.js";
import { badge, clear, dateTimeUTC, downloadJSON, downloadText, errorMsg, field, fmt, h, labelize, panel, progressBar, seg, table, toast, unitOf } from "../lib/ui.js";

const charts = new Set();
const chart = (cls = "chart") => { const el = h("div", { class: cls }); charts.add(el); return el; };
const SETPOINTS = [["blast_temp_C", "Hot blast temperature", "add", 25], ["o2_enrichment_pct", "Oxygen enrichment", "add", 0.5], ["blast_moisture_g_Nm3", "Blast moisture", "add", 5],
  ["pci_t_h", "PCI rate", "mul", 1.05], ["blast_volume_Nm3_min", "Blast volume", "mul", 0.97], ["coke_batch_t", "Coke batch", "mul", 1.02], ["ore_batch_t", "Ore batch", "mul", 1.0],
  ["top_pressure_kPa_g", "Top pressure", "add", 10], ["n_tuyeres_closed", "Tuyeres closed", "set", 2], ["ng_Nm3_h", "Natural gas injection", "set", 0], ["h2_Nm3_h", "Hydrogen injection", "set", 0]];
const DEFAULT_KPIS = ["hmt_C", "hm_si_pct", "production_t_d", "fuel_rate_kg_tHM", "raft_C", "eta_CO_pct", "pressure_drop_kPa", "top_gas_T_C"];
const ANALYTE = (k) => k.replace(/^(in|out)\./, "");

export default {
  title: "What-if scenarios",
  purpose: "Run library or custom what-if cases on clones of the live twin. Every case runs against a baseline from the same state with identical numerics, so the difference is the effect of the change. Results are simulator output, never plant data.",
  async mount(root, ctx) {
    const lib = await api.get("/api/v1/scenarios/library");
    const can = hasRole("METALLURGIST");
    const jobsBox = h("div", { class: "body" }), result = h("div", {}), cmpBox = h("div", {}), sensBox = h("div", {});
    let pollTimer = null;
    ctx.actions(h("button", { class: "btn", onclick: loadJobs }, "Refresh jobs"));
    const libTable = table([{ label: "ID", key: "id" }, { label: "Scenario", key: "name" }, { label: "Type", get: (s) => badge(s.type.replace(/_/g, " "), s.type === "simulation" ? "model" : "") },
      { label: "Hours", key: "duration_h", num: true, d: 0 }, { label: "Expected lag h", key: "expected_lag_h" },
      { label: "", get: (s) => (can ? h("button", { class: "btn small", onclick: (e) => { e.stopPropagation(); submit({ scenario_id: s.id }); } }, "Run") : "") }],
    lib.scenarios, { maxHeight: "420px", onRow: (s) => toast(s.description, "info", 9000) });
    root.append(h("div", { class: "banner warn" }, "All scenario output is SYNTHETIC: a physics-twin clone with illustrative calibration. Use it to compare directions and orders of magnitude, not to predict plant values."),
      h("div", { class: "grid g2" },
        panel("Scenario library", can ? "click a row for the description" : "sign in as metallurgist or higher to run", h("div", { class: "body flush" }, libTable)),
        panel("Custom scenario", "timed setpoint changes", builder()),
        panel("Jobs", "this session's backend", jobsBox),
        panel("Compare scenarios", "one shared baseline", compareForm()),
        h("div", { class: "spanall" }, result),
        h("div", { class: "spanall" }, cmpBox),
        h("div", { class: "spanall" }, panel("Sensitivity", "tornado of +/- one engineering step per lever", h("div", { class: "body" }, sensForm(), sensBox)))));
    loadJobs();

    function builder() {
      const rows = [];
      const list = h("div", { style: { display: "grid", gap: "6px" } });
      const name = h("input", { value: "Custom case", maxlength: 120 });
      const dur = h("input", { type: "number", min: 1, max: 72, step: 1, value: 12 });
      const dt = h("input", { type: "number", min: 60, max: 600, step: 60, value: 240 });
      let fidelity = "fast";
      const add = () => {
        const at = h("input", { type: "number", min: 0, max: 72, step: 0.25, value: 1, style: { width: "70px" } });
        const key = h("select", {}, SETPOINTS.map(([k, l]) => h("option", { value: k }, l)));
        const op = h("select", {}, ["add", "mul", "set", "restore"].map((o) => h("option", { value: o }, o)));
        const val = h("input", { type: "number", step: "any", value: 25, style: { width: "90px" } });
        key.onchange = () => { const d = SETPOINTS.find((s) => s[0] === key.value); op.value = d[2]; val.value = d[3]; };
        const row = h("div", { style: { display: "flex", gap: "6px", alignItems: "center", flexWrap: "wrap" } }, "at", at, "h", key, op, val,
          h("button", { class: "btn small", onclick: () => { row.remove(); rows.splice(rows.indexOf(r), 1); } }, "Remove"));
        const r = { at, key, op, val };
        rows.push(r); list.append(row);
      };
      add();
      const go = h("button", { class: "btn primary", disabled: !can || null, onclick: () => {
        const changes = rows.map((r) => ({ at_h: Number(r.at.value), op: { [r.key.value]: r.op.value === "restore" ? ["restore"] : [r.op.value, Number(r.val.value)] } }));
        submit({ name: name.value, changes, duration_h: Number(dur.value), dt_s: Number(dt.value), fidelity });
      } }, "Run custom scenario");
      return h("div", { class: "body" }, h("div", { class: "form" }, field("Name", name), field("Duration h", dur), field("Time step s", dt),
        field("Model fidelity", seg([["fast", "Fast (1-D)"], ["hifi", "Hi-fi (2-D)"]], "fast", (v) => { fidelity = v; }))),
      h("p", { class: "note" }, "add: plus a value; mul: times a factor; set: absolute value; restore: back to the starting value. The backend dry-runs every change against the equipment envelope before it accepts the job. Hi-fi runs warm-start a 28 × 3 cell model inside the job and take several CPU minutes."),
      list, h("div", { style: { display: "flex", gap: "8px", marginTop: "8px" } }, h("button", { class: "btn", onclick: add }, "Add change"), go));
    }

    async function submit(body) {
      try {
        const j = await api.post("/api/v1/simulations", body, { headers: { "Idempotency-Key": `${body.scenario_id || "custom"}-${Date.now()}` } });
        toast(`Job ${j.id.slice(0, 8)} accepted`, "info");
        loadJobs();
        follow(j.id);
      } catch (e) { toast(errorMsg(e), "err", 9000); }
    }
    async function follow(id) {
      clear(result).append(panel("Result", `job ${id.slice(0, 8)}`, h("div", { class: "body" }, h("p", {}, "Running..."), progressBar(0))));
      try {
        const j = await api.waitJob(id, (jj) => {
          const b = result.querySelector(".body");
          if (b) clear(b).append(h("p", {}, `${jj.status.toLowerCase()} - ${jj.message || ""}`), progressBar(jj.progress || 0));
        }, { intervalMs: 1200 });
        loadJobs();
        if (j.status !== "SUCCEEDED") { clear(result).append(h("div", { class: "banner crit" }, `Job ${j.status.toLowerCase()}: ${j.message || ""}`)); return; }
        renderResult(await api.get(`/api/v1/simulations/${id}/results`), id);
      } catch (e) { clear(result).append(h("div", { class: "banner crit" }, errorMsg(e))); }
    }
    async function loadJobs() {
      try {
        const r = await api.get("/api/v1/simulations");
        clear(jobsBox).append(r.jobs.length ? table([{ label: "Created", get: (j) => dateTimeUTC(j.created_utc) }, { label: "Kind", get: (j) => j.kind.replace(/^(simulation|study):/, "") },
          { label: "Scenario", get: (j) => { const q = j.request || {}; return q.scenario ? q.scenario.id === "CUSTOM" ? q.scenario.name : q.scenario.id : (q.scenario_ids || []).join(", ") || q.method || "-"; } },
          { label: "Status", get: (j) => (["PENDING", "RUNNING"].includes(j.status) ? progressBar(j.progress || 0) : badge(j.status.toLowerCase(), j.status === "SUCCEEDED" ? "ok" : "warn")) },
          { label: "By", key: "created_by" }], r.jobs.slice(0, 25), { maxHeight: "300px", onRow: (j) => (j.kind === "study:compare" ? showCompare(j.id) : j.kind === "study:sensitivity" ? showSens(j.id) : follow(j.id)) })
          : h("div", { class: "empty" }, "No jobs yet. Run a library scenario or build a custom one."));
        if (r.jobs.some((j) => ["PENDING", "RUNNING"].includes(j.status))) { clearTimeout(pollTimer); pollTimer = setTimeout(loadJobs, 3000); }
      } catch (e) { clear(jobsBox).append(errorMsg(e)); }
    }

    function renderResult(r, id) {
      clear(result);
      const sc = r.scenario || {};
      if (sc.type === "sensor" || r.timeline) return renderSensor(r);
      if (r.points) return renderPareto(r);
      if (r.recommendation_status) {
        result.append(panel("Infeasible-constraint test", sc.name || "", h("div", { class: "body" }, h("div", { class: `banner ${r.recommendation_status === "NO_FEASIBLE_SOLUTION" ? "advisory" : "crit"}` },
          `Current bed dP ${fmt(r.current_dP_kPa, 1)} kPa; imposed hard maximum ${fmt(r.imposed_hard_max_kPa, 1)} kPa. Optimiser status: ${r.recommendation_status}. Expected: ${r.expected}.`),
        h("ul", {}, (r.reasons || []).map((x) => h("li", {}, x))))));
        return;
      }
      const B = r.runs.baseline, K = r.runs.case;
      const changeLines = (sc.changes || []).map((c) => ({ type: "line", x0: c.at_h, x1: c.at_h, yref: "paper", y0: 0, y1: 1, line: { color: C.ink3(), width: 1, dash: "dot" } }));
      const sel = new Set(DEFAULT_KPIS.slice(0, 4));
      const grid = h("div", { class: "grid g2" });
      const picker = h("div", { style: { display: "flex", flexWrap: "wrap", gap: "6px" } }, Object.keys(B.trajectory).filter((k) => k !== "t_h").map((k) => {
        const cb = h("input", { type: "checkbox", checked: sel.has(k) || null, onchange: () => { cb.checked ? sel.add(k) : sel.delete(k); draw(); } });
        return h("label", { class: "chip" }, cb, " ", labelize(k));
      }));
      const draw = () => {
        grid.querySelectorAll(".chart").forEach(purge);
        clear(grid);
        [...sel].forEach((k) => {
          const el = chart();
          grid.append(panel(labelize(k), unitOf(k), h("div", { class: "body flush" }, el)));
          plot(el, [line(B.trajectory.t_h, B.trajectory[k], "Baseline", { color: C.ink3(), dash: "dash" }), line(K.trajectory.t_h, K.trajectory[k], "Case", { color: C.model() })],
            { xaxis: { title: { text: "Hours from start" } }, yaxis: { title: { text: unitOf(k) } }, shapes: changeLines, legend: { orientation: "h", y: -0.25 } });
        });
      };
      const keys = Object.keys(r.delta_final || {});
      const deltas = table([{ label: "KPI", get: (x) => labelize(x.k) }, { label: "Unit", get: (x) => unitOf(x.k) }, { label: "Baseline", get: (x) => fmt(B.final && B.final[x.k], 3) },
        { label: "Case", get: (x) => fmt(K.final && K.final[x.k], 3) }, { label: "Delta", get: (x) => { const v = r.delta_final[x.k]; return h("b", { style: { color: v > 0 ? C.molten() : v < 0 ? C.model() : "" } }, v == null ? "-" : (v > 0 ? "+" : "") + fmt(v, 3)); } }],
      keys.map((k) => ({ k })), { maxHeight: "420px" });
      const cumKeys = Object.keys(K.cumulative_t || {});
      const last = (s) => (s && s.length ? s[s.length - 1] : null);
      const cum = table([{ label: "Stream", get: (x) => `${x.k.startsWith("in.") ? "In" : "Out"}: ${labelize(ANALYTE(x.k))}` }, { label: "Baseline t (gas kNm³)", get: (x) => fmt(last((B.cumulative_t || {})[x.k]), 1) },
        { label: "Case", get: (x) => fmt(last(K.cumulative_t[x.k]), 1) }, { label: "Delta", get: (x) => fmt((last(K.cumulative_t[x.k]) || 0) - (last((B.cumulative_t || {})[x.k]) || 0), 1) }],
      cumKeys.map((k) => ({ k })), { maxHeight: "420px" });
      const cumChart = chart();
      const comp = compositionTables(B.streams, K.streams);
      result.append(panel(`Result: ${sc.name || sc.id}`, `${r.status.toLowerCase()} in ${fmt(r.seconds, 0)} s, ${r.data_origin}`, h("div", { class: "body" },
        h("p", { class: "note" }, `${sc.description || ""} Max element residual: baseline ${B.max_rel_element_residual.toExponential(1)}, case ${K.max_rel_element_residual.toExponential(1)}; energy residual ${K.max_rel_energy_residual.toExponential(1)}. Input hash ${r.input_hash.slice(0, 12)}.`),
        K.status !== "COMPLETED" ? h("div", { class: "banner crit" }, K.status) : null,
        h("div", { style: { display: "flex", gap: "8px", flexWrap: "wrap", margin: "6px 0" } },
          h("button", { class: "btn", onclick: () => downloadText(trajCSV(r), `scenario_${sc.id || "custom"}_${id.slice(0, 8)}.csv`) }, "Download trajectories (CSV)"),
          h("button", { class: "btn", onclick: () => downloadJSON(r, `scenario_${sc.id || "custom"}_${id.slice(0, 8)}.json`) }, "Download full result (JSON)")),
        picker)), grid,
      h("div", { class: "grid g2" }, panel("Final-state comparison", "case minus baseline", h("div", { class: "body flush" }, deltas)),
        panel("Cumulative inputs and outputs", "since run start", h("div", { class: "body flush" }, cum, cumChart)),
        panel("Hot metal, slag and top gas composition", "end of run", h("div", { class: "body" }, comp))));
      draw();
      const ks = cumKeys.filter((k) => !/gas|blast|top/.test(k));
      plot(cumChart, [bars(ks.map((k) => `${k.startsWith("in.") ? "in" : "out"} ${ANALYTE(k)}`), ks.map((k) => last((B.cumulative_t || {})[k])), "Baseline", { color: C.ink3() }),
        bars(ks.map((k) => `${k.startsWith("in.") ? "in" : "out"} ${ANALYTE(k)}`), ks.map((k) => last(K.cumulative_t[k])), "Case", { color: C.model() })],
      { barmode: "group", yaxis: { title: { text: "t since start" } }, margin: { b: 90 } });
    }

    function compositionTables(sb, sk) {
      if (!sb || !sk) return h("p", {}, "Not available (run did not complete).");
      const pick = (s, name) => s.outputs.find((o) => o.stream === name) || {};
      const rows = [];
      [["hot_metal", "wt_pct", "Hot metal wt%"], ["slag", "wt_pct", "Slag wt%"], ["top_gas", "vol_pct_dry", "Top gas vol% dry"]].forEach(([s, f, title]) => {
        const b = pick(sb, s)[f] || {}, k = pick(sk, s)[f] || {};
        Object.keys(k).forEach((el) => rows.push({ g: title, el, b: b[el], k: k[el] }));
        rows.push({ g: title, el: "temperature °C", b: pick(sb, s).T_C, k: pick(sk, s).T_C });
      });
      return table([{ label: "Stream", key: "g" }, { label: "Component", key: "el" }, { label: "Baseline", key: "b", num: true, d: 3 }, { label: "Case", key: "k", num: true, d: 3 },
        { label: "Delta", get: (x) => (x.b != null && x.k != null ? fmt(x.k - x.b, 3) : "-") }], rows, { maxHeight: "420px" });
    }

    function trajCSV(r) {
      const B = r.runs.baseline.trajectory, K = r.runs.case.trajectory;
      const keys = Object.keys(K).filter((k) => k !== "t_h");
      const head = [`# Extractmet BF digital twin - scenario export`, `# data_origin=${r.data_origin}; ${r.provenance}`, `# scenario=${(r.scenario || {}).id || "custom"}; input_hash=${r.input_hash}`,
        `# exported_utc=${new Date().toISOString()}; config_version=${(state.status || {}).config_version ?? "?"}; model_version=${(state.status || {}).model_version || "?"}`,
        `# units: column suffix (_C degC, _pct %, _t_d t/d, _kg_tHM kg/tHM, _kPa kPa, _m m, _MW MW)`];
      const cols = ["t_h", ...keys.map((k) => `baseline.${k}`), ...keys.map((k) => `case.${k}`)];
      const lines = B.t_h.map((t, i) => [t, ...keys.map((k) => B[k][i] ?? ""), ...keys.map((k) => (K[k] ? K[k][i] ?? "" : ""))].join(","));
      return [...head, cols.join(","), ...lines].join("\n");
    }

    function renderSensor(r) {
      const T = r.timeline, el = chart("chart tall");
      const tags = r.faults.map((f) => f.tag);
      result.append(panel("Instrument-fault scenario", "data-quality engine and trust gate", h("div", { class: "body" },
        table([{ label: "Tag", key: "tag" }, { label: "Fault", key: "kind" }, { label: "Starts h", key: "start_h", num: true, d: 1 }, { label: "First flagged h", get: (f) => fmt(r.flagged[f.tag] && r.flagged[f.tag].first_flag_h, 2) },
          { label: "Flagged as", get: (f) => (r.flagged[f.tag] ? badge(r.flagged[f.tag].quality.toLowerCase(), "warn") : badge("not flagged", "crit")) }], r.faults),
        h("p", { class: "note" }, `Advice suppressed for ${fmt(100 * r.suppressed_fraction, 0)} % of the run. ${r.note}`), el)));
      const x = T.map((t) => t.t_h);
      el.style.height = `${360 + 120 * tags.length}px`;
      stack(el, [{ title: "DQ score", weight: 1.3, yaxis: { range: [0, 105] }, traces: [line(x, T.map((t) => t.dq_score), "Data-quality score", { color: C.model() }),
        { type: "bar", x, y: T.map((t) => (t.advice === "SUPPRESSED" ? 100 : null)), name: "Advice suppressed", marker: { color: "rgba(196,120,20,.22)" }, hoverinfo: "skip" }] },
      ...tags.map((g) => ({ title: `${g} raw`, traces: [line(x, T.map((t) => t[`v_${g}`]), `${g} raw value`, { color: C.measured(), width: 1.4 })] }))],
      { bargap: 0, xaxis: { title: { text: "Hours" } }, legend: { orientation: "h", y: 1.05 } });
    }

    function renderPareto(r) {
      const el = chart("chart tall");
      const P = r.points.filter((p) => p.hmt_end_C != null);
      result.append(panel("Economic trade-off (Pareto)", `coke price ×${r.coke_price_mult}`, h("div", { class: "body" }, el,
        table([{ label: "Economic weight", key: "econ_weight", num: true, d: 1 }, { label: "Status", key: "status" }, { label: "HMT end °C", key: "hmt_end_C", num: true, d: 1 },
          { label: "Δ variable cost INR/tHM", key: "delta_variable_cost_INR_tHM", num: true, d: 1 }, { label: "Tracking cost", key: "tracking_cost", num: true, d: 3 }], r.points),
        h("p", { class: "note" }, r.note))));
      plot(el, [{ ...points(P.map((p) => p.delta_variable_cost_INR_tHM), P.map((p) => p.hmt_end_C), "Solutions", { color: C.model(), size: 10 }), mode: "lines+markers+text",
        text: P.map((p) => `w=${p.econ_weight}`), textposition: "top center" }],
      { xaxis: { title: { text: "Δ variable cost (INR per tHM)" } }, yaxis: { title: { text: "Predicted HMT at horizon end (°C)" } }, showlegend: false });
    }

    function compareForm() {
      const sims = lib.scenarios.filter((s) => s.type === "simulation");
      const boxes = sims.map((s) => ({ s, cb: h("input", { type: "checkbox", checked: ["S03", "S03b", "S02"].includes(s.id) || null }) }));
      const dur = h("input", { type: "number", min: 2, max: 48, value: 12 });
      return h("div", { class: "body" }, h("div", { style: { display: "flex", flexWrap: "wrap", gap: "6px" } }, boxes.map(({ s, cb }) => h("label", { class: "chip", title: s.name }, cb, " ", s.id))),
        h("div", { class: "form", style: { marginTop: "8px" } }, field("Duration h", dur)),
        h("button", { class: "btn primary", disabled: !can || null, onclick: async () => {
          const ids = boxes.filter((b) => b.cb.checked).map((b) => b.s.id).slice(0, 6);
          if (!ids.length) { toast("Pick at least one scenario", "err"); return; }
          try { const j = await api.post("/api/v1/scenarios/compare", { scenario_ids: ids, duration_h: Number(dur.value), dt_s: 300 }); toast("Comparison running", "info"); loadJobs(); showCompare(j.id); }
          catch (e) { toast(errorMsg(e), "err"); }
        } }, "Compare (up to 6)"), h("p", { class: "note" }, "Runs one baseline and one case per scenario from the same live-twin state (about 10-20 s per scenario-12 h)."));
    }
    async function showCompare(id) {
      clear(cmpBox).append(panel("Scenario comparison", "running", h("div", { class: "body" }, progressBar(0))));
      try {
        const j = await api.waitJob(id, (jj) => { const b = cmpBox.querySelector(".body"); if (b) clear(b).append(progressBar(jj.progress || 0), h("p", { class: "note" }, jj.message || "")); });
        if (j.status !== "SUCCEEDED") throw new Error(j.message);
        const r = await api.get(`/api/v1/simulations/${id}/results`);
        let kpiSel = "hmt_C";
        const el = chart("chart tall");
        const draw = () => plot(el, [line(r.baseline.trajectory.t_h, r.baseline.trajectory[kpiSel], "Baseline", { color: C.ink3(), dash: "dash" }),
          ...Object.entries(r.cases).map(([cid, c], i) => line(c.trajectory.t_h, c.trajectory[kpiSel], cid, { color: SERIES[i % 8] }))],
        { xaxis: { title: { text: "Hours" } }, yaxis: { title: { text: `${labelize(kpiSel)} ${unitOf(kpiSel)}` } } });
        const sel = h("select", { onchange: (e) => { kpiSel = e.target.value; draw(); } }, Object.keys(r.baseline.trajectory).filter((k) => k !== "t_h").map((k) => h("option", { value: k, selected: k === kpiSel || null }, labelize(k))));
        const cols = ["hmt_C", "hm_si_pct", "production_t_d", "fuel_rate_kg_tHM", "raft_C", "eta_CO_pct", "pressure_drop_kPa"];
        clear(cmpBox).append(panel("Scenario comparison", `${r.duration_h} h, ${fmt(r.seconds, 0)} s, ${r.data_origin}`, h("div", { class: "body" }, field("KPI", sel), el,
          table([{ label: "Scenario", get: (x) => `${x.id} ${x.name}` }, ...cols.map((c) => ({ label: `Δ ${labelize(c)}`, get: (x) => fmt(x.delta_final[c], c.includes("si") ? 3 : 1) }))], r.table))));
        draw();
      } catch (e) { clear(cmpBox).append(h("div", { class: "banner crit" }, errorMsg(e))); }
    }

    function sensForm() {
      let method = "rom";
      const hz = h("input", { type: "number", min: 1, max: 24, value: 8 });
      return h("div", { class: "form" }, field("Method", seg([["rom", "Identified ROM (instant)"], ["physics", "Physics re-simulation (job)"]], "rom", (v) => { method = v; })),
        field("Horizon h (physics)", hz), h("button", { class: "btn primary", disabled: !can || null, onclick: async () => {
          try {
            const r = await api.post("/api/v1/scenarios/sensitivity", { method, horizon_h: Number(hz.value) });
            if (r.links) { toast("Physics sensitivity running (~1-2 min)", "info"); showSens(r.id); } else renderSens(r);
          } catch (e) { toast(errorMsg(e), "err"); }
        } }, "Compute"));
    }
    async function showSens(id) {
      clear(sensBox).append(progressBar(0));
      try {
        const j = await api.waitJob(id, (jj) => { clear(sensBox).append(progressBar(jj.progress || 0), h("p", { class: "note" }, jj.message || "")); });
        if (j.status !== "SUCCEEDED") throw new Error(j.message);
        renderSens(await api.get(`/api/v1/simulations/${id}/results`));
      } catch (e) { clear(sensBox).append(h("div", { class: "banner crit" }, errorMsg(e))); }
    }
    function renderSens(r) {
      clear(sensBox);
      const kp = ["hmt_C", "hm_si_pct", "raft_C", "production_t_d", "fuel_rate_kg_tHM", "pressure_drop_kPa"];
      const g = h("div", { class: "grid g3" });
      sensBox.append(h("p", { class: "note" }, r.method), g);
      kp.forEach((k) => {
        const el = chart();
        g.append(panel(labelize(k), unitOf(k), h("div", { class: "body flush" }, el)));
        let names, plus, minus;
        if (r.rows[0] && r.rows[0].gains_per_unit) {
          names = r.rows.map((x) => x.label);
          names = r.rows.map((x) => `${x.label} ±${fmt(x.ident_step, 2)}`);
          plus = r.rows.map((x) => (x.gains_per_unit[k] ?? 0) * (x.ident_step ?? 1));
          minus = plus.map((v) => -v);
        } else {
          names = r.rows.map((x) => `${x.label} ±${fmt(x.step, 2)}`);
          plus = r.rows.map((x) => (x.plus && x.plus[k]) ?? null);
          minus = r.rows.map((x) => (x.minus && x.minus[k]) ?? null);
        }
        plot(el, [bars(names, plus, "+ step", { color: C.molten(), orientation: "h" }), bars(names, minus, "- step", { color: C.model(), orientation: "h" })],
          { barmode: "overlay", margin: { l: 170, r: 10, t: 6, b: 30 }, xaxis: { title: { text: `Δ ${unitOf(k)}` }, zeroline: true }, legend: { orientation: "h", y: -0.2 } });
      });
    }
  },
  unmount() { charts.forEach(purge); charts.clear(); },
};
