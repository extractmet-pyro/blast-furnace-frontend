// Labelled 2-D furnace cross-section drawn to scale from the backend geometry, with the model
// field painted inside (per axial cell / radial sector), burden layers, cohesive zone, raceways,
// deadman, hearth liquids and value tags at their physical locations. Every number on the drawing
// is a backend value; model values are steel blue, measured values are ink.
import { heatColor, seqColor } from "../lib/charts.js";

const FIELD_RANGE = {
  T_gas_C: [100, 2100, "heat"], T_solid_C: [25, 2000, "heat"], reduction_degree_pct: [0, 100, "seq"],
  y_CO_pct: [15, 45, "seq"], y_CO2_pct: [0, 25, "seq"], y_H2_pct: [0, 12, "seq"], gas_velocity_m_s: [0, 4, "seq"],
  ore_volume_fraction: [0, 0.7, "seq"], softening_index: [0, 1, "heat"],
};
export const FIELD_LABEL = {
  T_gas_C: "Gas temperature (°C)", T_solid_C: "Solid temperature (°C)", reduction_degree_pct: "Reduction degree (%)",
  y_CO_pct: "CO (vol%)", y_CO2_pct: "CO₂ (vol%)", y_H2_pct: "H₂ (vol%)", gas_velocity_m_s: "Gas velocity (m/s)",
  ore_volume_fraction: "Ore volume fraction (-)", softening_index: "Softening index (0-1)",
};

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const f = (v, d = 0) => (v === null || v === undefined || !Number.isFinite(v) ? "-" : v.toFixed(d));

export function fieldColor(field, v) {
  const [lo, hi, scale] = FIELD_RANGE[field] || [0, 1, "seq"];
  const t = (v - lo) / (hi - lo);
  return scale === "heat" ? heatColor(t) : seqColor(t);
}
export function fieldRange(field) { return FIELD_RANGE[field] || [0, 1, "seq"]; }

export function schematicSVG({ geom, fields, st, meas = {}, field = "T_gas_C", width = 760, showDims = true }) {
  const p = geom.profile;
  const zBot = p.z_m[0], zTop = p.z_m[p.z_m.length - 1] + 3.2;     // + top equipment
  const zt = p.z_m[p.z_m.length - 1], rt = p.r_m[p.r_m.length - 1];
  const Rmax = Math.max(...p.r_m);
  const H = zTop - zBot;
  const marginL = showDims ? 150 : 40, marginR = 230;
  const scale = (width - marginL - marginR) / (2 * Rmax * 1.25);
  const height = Math.round(H * scale + 70);
  const cx = marginL + Rmax * 1.25 * scale;
  const Y = (z) => 30 + (zTop - z) * scale;
  const X = (r) => cx + r * scale;
  const rAt = (z) => {   // inner radius at height z from the piecewise-linear profile
    for (let i = 1; i < p.z_m.length; i++) {
      if (z <= p.z_m[i] + 1e-9) {
        const t = (z - p.z_m[i - 1]) / Math.max(p.z_m[i] - p.z_m[i - 1], 1e-9);
        return p.r_m[i - 1] + t * (p.r_m[i] - p.r_m[i - 1]);
      }
    }
    return p.r_m[p.r_m.length - 1];
  };
  const out = [];
  out.push(`<svg class="schematic" viewBox="0 0 ${width} ${height}" role="img" aria-label="Blast furnace cross-section with model values">`);
  out.push(`<defs><linearGradient id="hm" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffd28a"/><stop offset="1" stop-color="#f2891d"/></linearGradient>
    <pattern id="coke" width="6" height="6" patternUnits="userSpaceOnUse"><rect width="6" height="6" fill="#4a4a4a"/><circle cx="3" cy="3" r="1.2" fill="#6a6a6a"/></pattern></defs>`);
  // ---------------------------------------------------------------- interior field (cells)
  const zf = fields.z_faces_m;               // shaft cells: z from tuyere level upward
  const F = fields.fields[field];
  const edges = fields.r_edges_norm || [0, 1];
  const nr = F ? F.length : 0;
  if (F) {
    for (let r = 0; r < nr; r++) {
      for (let j = 0; j < zf.length - 1; j++) {
        const v = F[r][j];
        if (v === null || v === undefined) continue;
        const z0 = zf[j], z1 = zf[j + 1];
        const ra0 = rAt(z0), ra1 = rAt(z1);
        const e0 = edges[r], e1 = edges[r + 1];
        const col = fieldColor(field, v);
        // mirror: left half and right half of the section
        for (const sgn of [-1, 1]) {
          const pts = [[sgn * e0 * ra0, z0], [sgn * e1 * ra0, z0], [sgn * e1 * ra1, z1], [sgn * e0 * ra1, z1]];
          out.push(`<polygon points="${pts.map(([x, z]) => `${X(x).toFixed(1)},${Y(z).toFixed(1)}`).join(" ")}" fill="${col}" stroke="${col}" stroke-width="0.6"><title>${esc(FIELD_LABEL[field] || field)}: ${f(v, field.includes("fraction") ? 2 : 0)} at z = ${f((z0 + z1) / 2, 1)} m (model)</title></polygon>`);
        }
      }
    }
  }
  // ---------------------------------------------------------------- burden layers (right half, thin strips)
  const layers = (fields.layers || []).slice(0, 80);
  for (const L of layers) {
    if (L.z_bot < 0.5) continue;
    const r0 = rAt(L.z_bot), r1 = rAt(Math.min(L.z_top, zf[zf.length - 1]));
    if (L.z_bot > zf[zf.length - 1]) continue;
    const col = L.kind === "ore" ? "rgba(155,74,47,.30)" : "rgba(40,40,40,.22)";
    out.push(`<polygon points="${X(0.92 * r0)},${Y(L.z_bot)} ${X(r0)},${Y(L.z_bot)} ${X(r1)},${Y(L.z_top)} ${X(0.92 * r1)},${Y(L.z_top)}" fill="${col}"/>`);
  }
  // ---------------------------------------------------------------- cohesive zone (inverted V per sector)
  const cz = fields.cohesive_zone || st.cohesive_zone;
  if (cz && cz.sectors && cz.sectors.length) {
    const s = cz.sectors;
    const top = Math.max(...s.map((x) => x.z_top_m)), bot = Math.min(...s.map((x) => x.z_bottom_m));
    const rt = rAt(top), rb = rAt(bot);
    const apexZ = top, wingZ = bot;
    const path = `M ${X(-0.95 * rb)} ${Y(wingZ)} L ${X(-0.18 * rt)} ${Y(apexZ)} L ${X(0.18 * rt)} ${Y(apexZ)} L ${X(0.95 * rb)} ${Y(wingZ)}`;
    out.push(`<path d="${path}" fill="none" stroke="#6b3d22" stroke-width="7" stroke-opacity=".55" stroke-linejoin="round"/>`);
    out.push(`<path d="${path}" fill="none" stroke="#e7b48a" stroke-width="1.4" stroke-dasharray="5 4"/>`);
    out.push(tagR(X, Y, rAt, top - 0.2, `Cohesive zone ${f(bot, 1)}-${f(top, 1)} m`, "model", "Model estimate (low confidence, temperature window)"));
  }
  // ---------------------------------------------------------------- deadman + raceways + tuyeres
  const rh = p.r_m[0];
  const k = st.kpis || {};
  const hs = st.hearth || {};
  const zTh = zBot + (hs.taphole_level_m ?? 2.0);
  const zMetal = zBot + (hs.metal_level_m ?? 1.5);
  const zSlag = zBot + (hs.slag_top_m ?? 2.5);
  out.push(`<path d="M ${X(-0.78 * rh)} ${Y(0)} Q ${X(0)} ${Y(0) - 0.32 * rh * scale} ${X(0.78 * rh)} ${Y(0)} L ${X(0.45 * rh)} ${Y(zBot + 0.6)} L ${X(-0.45 * rh)} ${Y(zBot + 0.6)} Z" fill="url(#coke)" opacity=".55"><title>Deadman (coke bed, schematic shape)</title></path>`);
  // liquids in the hearth (in the deadman pores) - metal then slag
  out.push(`<rect x="${X(-rh)}" y="${Y(zMetal)}" width="${2 * rh * scale}" height="${Math.max(Y(zBot) - Y(zMetal), 1)}" fill="url(#hm)" opacity=".85"><title>Hot metal pool ${f(hs.metal_t, 0)} t (model)</title></rect>`);
  out.push(`<rect x="${X(-rh)}" y="${Y(zSlag)}" width="${2 * rh * scale}" height="${Math.max(Y(zMetal) - Y(zSlag), 0)}" fill="#b9ad8c" opacity=".85"><title>Slag layer ${f(hs.slag_t, 0)} t (model)</title></rect>`);
  const rwDepth = (k.raceway_depth_m && k.raceway_depth_m.value) || 1.2;
  for (const sgn of [-1, 1]) {
    const xw = X(sgn * rh);
    out.push(`<ellipse cx="${xw - sgn * rwDepth * scale * 0.55}" cy="${Y(0)}" rx="${rwDepth * scale * 0.6}" ry="${0.55 * scale}" fill="#ffcf7a" stroke="#f2891d" stroke-width="1.2" opacity=".9"><title>Raceway (depth ${f(rwDepth, 2)} m, model)</title></ellipse>`);
    out.push(`<rect x="${sgn > 0 ? xw : xw - 1.4 * scale}" y="${Y(0) - 3}" width="${1.4 * scale}" height="6" fill="#59626b"/>`);
  }
  // taphole and casting stream
  out.push(`<rect x="${X(rh)}" y="${Y(zTh) - 2}" width="${1.6 * scale}" height="4" fill="#59626b"/>`);
  if (hs.casting) out.push(`<path d="M ${X(rh) + 1.6 * scale} ${Y(zTh)} q ${0.9 * scale} 2 ${1.1 * scale} ${2.6 * scale}" stroke="#f2891d" stroke-width="4" fill="none"><title>Cast in progress (taphole ${hs.taphole})</title></path>`);
  // ---------------------------------------------------------------- lining (shell) outline
  const prof = (sgn, lining = 0) => p.z_m.map((z, i) => `${X(sgn * (p.r_m[i] + lining)).toFixed(1)},${Y(z).toFixed(1)}`).join(" ");
  for (const sgn of [-1, 1]) {
    out.push(`<polyline points="${prof(sgn, 0)}" fill="none" stroke="#3d454c" stroke-width="2"/>`);
    out.push(`<polyline points="${prof(sgn, 0.85)}" fill="none" stroke="#7d868e" stroke-width="1"/>`);
  }
  // hearth bottom
  out.push(`<line x1="${X(-rh - 0.85)}" y1="${Y(zBot)}" x2="${X(rh + 0.85)}" y2="${Y(zBot)}" stroke="#3d454c" stroke-width="3"/>`);
  // top equipment: throat top, receiving hopper/chute, uptakes
  out.push(`<path d="M ${X(-rt)} ${Y(zt)} L ${X(-0.35 * rt)} ${Y(zt + 1.6)} L ${X(0.35 * rt)} ${Y(zt + 1.6)} L ${X(rt)} ${Y(zt)}" fill="none" stroke="#3d454c" stroke-width="2"/>`);
  out.push(`<rect x="${X(-0.12 * rt)}" y="${Y(zt + 3.0)}" width="${0.24 * rt * scale}" height="${1.4 * scale}" fill="none" stroke="#3d454c"/>`);
  out.push(`<line x1="${X(0)}" y1="${Y(zt + 1.6)}" x2="${X(0.45 * rt)}" y2="${Y(geom.stockline_z_m + 0.6)}" stroke="#59626b" stroke-width="3"><title>Rotating chute (bell-less top)</title></line>`);
  for (const sgn of [-1, 1]) out.push(`<line x1="${X(sgn * 0.6 * rt)}" y1="${Y(zt + 1.0)}" x2="${X(sgn * 0.95 * rt)}" y2="${Y(zt + 3.0)}" stroke="#3d454c" stroke-width="5" stroke-linecap="round"><title>Gas uptake</title></line>`);
  // stockline
  out.push(`<line x1="${X(-rAt(geom.stockline_z_m))}" y1="${Y(geom.stockline_z_m)}" x2="${X(rAt(geom.stockline_z_m))}" y2="${Y(geom.stockline_z_m)}" stroke="#ffffff" stroke-dasharray="4 3" stroke-width="1"/>`);
  // ---------------------------------------------------------------- region labels (left) and dimensions
  if (showDims) {
    const left = [];   // left-hand labels, de-overlapped below (taphole level often falls at mid-hearth)
    for (const reg of p.regions) {
      const zm = (reg.z_from + reg.z_to) / 2;
      left.push({ y: Y(zm) + 4, text: esc(reg.name[0].toUpperCase() + reg.name.slice(1)) });
      out.push(`<line x1="${X(-Rmax) - 28}" x2="${X(-Rmax) - 28}" y1="${Y(reg.z_from)}" y2="${Y(reg.z_to)}" stroke="#7d868e"/>`);
      out.push(`<line x1="${X(-Rmax) - 32}" x2="${X(-Rmax) - 24}" y1="${Y(reg.z_to)}" y2="${Y(reg.z_to)}" stroke="#7d868e"/>`);
    }
    left.push({ y: Y(0) + 4, text: `Tuyeres (${geom.n_tuyeres})` });
    left.push({ y: Y(zTh) + 4, text: `Tapholes (${geom.n_tapholes ?? ""})` });
    left.sort((a, b) => a.y - b.y);
    for (let i = 1; i < left.length; i++) if (left[i].y - left[i - 1].y < 14) left[i].y = left[i - 1].y + 14;
    for (const l of left) out.push(`<text class="lbl" x="${X(-Rmax) - 34}" y="${l.y}" text-anchor="end">${l.text}</text>`);
    const dim = (z, r, label) => out.push(`<text class="lbl" x="${X(-r) + 4}" y="${Y(z) - 5}">${esc(label)}</text>`);
    dim(zt, rt, `throat Ø ${f(2 * rt, 1)} m`);
    const ib = p.r_m.indexOf(Math.max(...p.r_m));
    dim(p.z_m[ib], p.r_m[ib], `belly Ø ${f(2 * p.r_m[ib], 1)} m`);
    dim(zBot + 0.4, rh, `hearth Ø ${f(2 * rh, 1)} m`);
  }
  // ---------------------------------------------------------------- value tags (right side)
  const tg = st.top_gas || {};
  const vtag = (z, label, value, kind = "model", tip = "") => out.push(tagR(X, Y, rAt, z, `${label} ${value}`, kind, tip));
  const mv = (tag, d = 0) => (meas[tag] && meas[tag].value !== null && meas[tag].value !== undefined ? f(meas[tag].value, d) : null);
  vtag(zt + 2.2, "Top gas", `${mv("TG_TEMP") ?? f((k.top_gas_T_uptake_C || k.top_gas_T_C) && (k.top_gas_T_uptake_C || k.top_gas_T_C).value)} °C, η CO ${f(k.eta_CO_pct && k.eta_CO_pct.value, 1)} %`, mv("TG_TEMP") ? "measured" : "model");
  vtag(zt + 0.8, "CO / CO₂ / H₂", `${f(tg.dry_vol_pct && tg.dry_vol_pct.CO, 1)} / ${f(tg.dry_vol_pct && tg.dry_vol_pct.CO2, 1)} / ${f(tg.dry_vol_pct && tg.dry_vol_pct.H2, 1)} %`, "model");
  vtag(geom.stockline_z_m - 1.2, "Charges", `${f(k.charges_per_h && k.charges_per_h.value, 1)} /h, descent ${f(k.burden_descent_time_h && k.burden_descent_time_h.value, 1)} h`, "model");
  vtag(geom.stockline_z_m * 0.55, "Thermal reserve", `${f(k.thermal_reserve_T_C && k.thermal_reserve_T_C.value)} °C`, "model");
  vtag(0.9, "RAFT", `${f(k.raft_C && k.raft_C.value)} °C, blast ${mv("BL_TEMP") ?? f(k.blast_temp_C && k.blast_temp_C.value)} °C`, mv("BL_TEMP") ? "measured" : "model");
  vtag(-0.6, "Blast", `${mv("BL_FLOW") ?? f(k.blast_volume_Nm3_min && k.blast_volume_Nm3_min.value)} Nm³/min, O₂ +${f(k.o2_enrichment_pct && k.o2_enrichment_pct.value, 1)} %, PCI ${f(k.pci_t_h && k.pci_t_h.value, 1)} t/h`, mv("BL_FLOW") ? "measured" : "model");
  vtag(zTh + 0.9, "Hot metal", `${f(k.hmt_C && k.hmt_C.value)} °C, Si ${f(k.hm_si_pct && k.hm_si_pct.value, 2)} %, S ${f(k.hm_s_pct && k.hm_s_pct.value, 3)} %`, "model");
  vtag(zTh - 0.4, "Slag", `B2 ${f(k.slag_B2 && k.slag_B2.value, 2)}, ${f(k.slag_rate_kg_tHM && k.slag_rate_kg_tHM.value)} kg/tHM`, "model");
  vtag(zBot + 0.5, "Liquids", `metal ${f(hs.metal_t)} t, slag ${f(hs.slag_t)} t`, "model");
  // stave heat loads by wall zone
  const walls = st.walls_MW || {};
  for (const wz of geom.walls || []) {
    const z0 = wz.frac_from * geom.stockline_z_m, z1 = wz.frac_to * geom.stockline_z_m;
    const q = walls[wz.name];
    if (q === undefined) continue;
    const zm = (z0 + z1) / 2;
    const xr = X(rAt(zm) + 0.9);
    out.push(`<line x1="${xr}" x2="${xr}" y1="${Y(z0) - 2}" y2="${Y(z1) + 2}" stroke="#2f7fb0" stroke-width="${2 + Math.min(q, 12) * 0.6}" stroke-opacity=".75"><title>${esc(wz.name)} cooling ${f(q, 2)} MW (model)</title></line>`);
  }
  out.push(`</svg>`);
  return out.join("");

  function tagR(Xf, Yf, rAtf, z, text, kind, tip) {
    const x0 = Xf(rAtf(Math.max(Math.min(z, zt), zBot)) + 1.1);
    const xl = Xf(Rmax * 1.25) + 8;
    const y = Yf(z);
    return `<g><line x1="${x0}" y1="${y}" x2="${xl - 4}" y2="${y}" stroke="#9aa3ab" stroke-width=".8"/>` +
      `<text class="val ${kind}" x="${xl}" y="${y + 4}">${esc(text)}</text>${tip ? `<title>${esc(tip)}</title>` : ""}</g>`;
  }
}
