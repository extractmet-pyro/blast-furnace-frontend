import { api } from "../lib/api.js";
import { geometry } from "../lib/store.js";
import { clear, errorMsg, fmt, h, kv, panel, seg, table } from "../lib/ui.js";
import { FIELD_LABEL, fieldRange, schematicSVG } from "../viz/schematic.js";
import { colorbar } from "./common.js";

let timer = null, field = "T_gas_C";

export default {
  title: "Furnace schematic",
  purpose: "Full-size labelled cross-section with dimensions, regions, refractory and cooling zones, and every model value placed where it physically belongs.",
  async mount(root) {
    const geom = await geometry();
    const svg = h("div", {});
    const legend = h("div", { class: "note" });
    const dims = h("div", {});
    const regions = h("div", {});
    root.append(h("div", { class: "grid g-hero" },
      panel("Cross-section", "to scale", h("div", { class: "body" },
        seg([["T_gas_C", "Gas T"], ["T_solid_C", "Solid T"], ["reduction_degree_pct", "Reduction"], ["y_CO_pct", "CO"], ["y_CO2_pct", "CO₂"], ["y_H2_pct", "H₂"], ["gas_velocity_m_s", "Velocity"], ["ore_volume_fraction", "Ore fraction"], ["softening_index", "Softening"]], field, (v) => { field = v; load(); }),
        h("div", { style: { height: "6px" } }), legend, svg)),
      h("div", { class: "grid" }, panel("Dimensions and volumes", "configured geometry", h("div", { class: "body" }, dims)),
        panel("Regions and lining", "wall zones, layers, cooling", h("div", { class: "body" }, regions)))));
    clear(dims).append(kv({
      hearth_diameter_m: geom.hearth_diameter_m, belly_diameter_m: geom.belly_diameter_m, throat_diameter_m: geom.throat_diameter_m,
      bosh_height_m: geom.bosh_height_m, belly_height_m: geom.belly_height_m, stack_height_m: geom.stack_height_m, throat_height_m: geom.throat_height_m,
      sump_depth_m: geom.sump_depth_m, taphole_to_tuyere_m: geom.taphole_to_tuyere_m, stockline_m: geom.stockline_m,
      tuyeres: geom.n_tuyeres, tuyere_diameter_m: geom.tuyere_diameter_m, tapholes: geom.n_tapholes,
      inner_volume_m3: geom.inner_volume_m3, working_volume_m3: geom.working_volume_m3, hearth_volume_m3: geom.hearth_volume_m3,
      working_height_m: geom.working_height_m, model_grid: `${geom.grid.n_z} axial x ${geom.grid.n_r} radial cells`,
    }, (k, v) => (typeof v === "number" ? (Number.isInteger(v) ? String(v) : k.endsWith("_m3") ? fmt(v, 0) : fmt(v, 2)) : String(v))));
    const rows = (geom.walls || []).map((w) => ({ zone: w.name.replace(/_/g, " "), from: w.frac_from, to: w.frac_to, cooling: w.cooling,
      lining: w.layers.map((l) => `${l.material.replace(/_/g, " ")} ${Math.round(l.thickness_m * 1000)} mm`).join(", ") }));
    Object.entries(geom.hearth_walls || {}).forEach(([k, w]) => rows.push({ zone: k.replace(/_/g, " "), from: "", to: "", cooling: w.cooling,
      lining: w.layers.map((l) => `${l.material.replace(/_/g, " ")} ${Math.round(l.thickness_m * 1000)} mm`).join(", ") }));
    clear(regions).append(table([{ label: "Zone", key: "zone" }, { label: "From", key: "from", num: true }, { label: "To", key: "to", num: true },
      { label: "Cooling", key: "cooling" }, { label: "Lining (hot face to shell)", key: "lining" }], rows));
    async function load() {
      try {
        const [st, fl, tl] = await Promise.all([api.get("/api/v1/twin/state"), api.get("/api/v1/twin/fields"), api.get("/api/v1/telemetry/latest").catch(() => ({ tags: [] }))]);
        const meas = Object.fromEntries(tl.tags.filter((t) => t.quality === "GOOD").map((t) => [t.tag, t]));
        svg.innerHTML = schematicSVG({ geom, fields: fl, st, meas, field, width: 900 });
        clear(legend).append(colorbar(field, fieldRange(field)), " ", FIELD_LABEL[field], ". Blue values: model. Black values: measured (synthetic sensors in demo).");
      } catch (e) { clear(svg).append(h("div", { class: "banner crit" }, errorMsg(e))); }
    }
    await load();
    timer = setInterval(load, 30000);
  },
  unmount() { clearInterval(timer); },
};
