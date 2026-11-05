import { api } from "../lib/api.js";
import { geometry } from "../lib/store.js";
import { clear, errorMsg, h, panel, seg } from "../lib/ui.js";
import { Furnace3D } from "../viz/furnace3d.js";
import { FIELD_LABEL, fieldRange } from "../viz/schematic.js";
import { colorbar } from "./common.js";

let scene = null, timer = null, field = "T_gas_C";

export default {
  title: "Furnace 3D",
  purpose: "Cut-away furnace built from the configured geometry. The section plane shows the model field cell by cell; burden layers, cohesive zone, raceways and hearth liquids come from the live twin state.",
  async mount(root) {
    const geom = await geometry();
    const wrap = h("div", { class: "scene" });
    const legend = h("div", { class: "legend" });
    const stamp = h("div", { class: "stamp" }, "Model-computed (physics twin) - synthetic demonstration, not a measurement");
    wrap.append(legend, stamp);
    const toggles = h("div", { style: { display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center" } },
      seg([["T_gas_C", "Gas T"], ["T_solid_C", "Solid T"], ["reduction_degree_pct", "Reduction"], ["y_CO_pct", "CO"], ["y_H2_pct", "H₂"], ["gas_velocity_m_s", "Gas velocity"], ["softening_index", "Softening"]],
        field, (v) => { field = v; load(); }),
      ...["layers", "shell", "labels"].map((k) => h("label", { class: "chip" }, h("input", { type: "checkbox", checked: true, onchange: (e) => { if (scene) { scene.setOption(k, e.target.checked); if (k === "labels") load(); } } }), ` ${k}`)));
    root.append(panel("Furnace", "drag to orbit, scroll to zoom", h("div", { class: "body" }, toggles, h("div", { style: { height: "8px" } }), wrap)));
    scene = new Furnace3D(wrap);
    async function load() {
      try {
        const [st, fl] = await Promise.all([api.get("/api/v1/twin/state"), api.get("/api/v1/twin/fields")]);
        scene.build(geom, fl, st, field);
        clear(legend).append(h("div", {}, h("b", {}, FIELD_LABEL[field])), colorbar(field, fieldRange(field)),
          h("div", { class: "note" }, `Data time ${st.provenance.data_time_utc}`), h("div", { class: "note" }, `${fl.fields[field][0].length} axial cells x ${fl.fields[field].length} radial sector(s)`));
      } catch (e) { clear(legend).append(h("span", { style: { color: "var(--crit)" } }, errorMsg(e))); }
    }
    await load();
    timer = setInterval(load, 30000);
  },
  unmount() { clearInterval(timer); if (scene) scene.dispose(); scene = null; },
};
