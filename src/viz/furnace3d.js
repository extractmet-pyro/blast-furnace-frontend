// Three.js furnace: cut-away shell built from the backend profile, a vertical section plane painted
// with the model field (per axial cell and radial sector), burden layers, cohesive zone, deadman,
// hearth liquids, raceways at every tuyere, bustle main, uptakes and labels. All geometry and colours
// derive from backend payloads - nothing is randomly animated.
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { CSS2DObject, CSS2DRenderer } from "three/addons/renderers/CSS2DRenderer.js";
import { fieldColor } from "./schematic.js";

// initial camera direction (x, z per unit height) and screen-aligned label anchors for that view:
// SIDE_R/SIDE_L put a label r metres to the right/left of the furnace axis as seen from the camera.
const VIEW = [1.2, 1.45];
const TH = Math.atan2(VIEW[0], VIEW[1]);
const SIDE_R = (r, z) => new THREE.Vector3(r * Math.cos(TH), z, -r * Math.sin(TH));
const SIDE_L = (r, z) => new THREE.Vector3(-r * Math.cos(TH), z, r * Math.sin(TH));

const CUT = Math.PI * 1.5;          // shell covers 270 deg; the front quarter is cut away

export class Furnace3D {
  constructor(container) {
    this.el = container;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(38, 1, 0.1, 500);
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.el.appendChild(this.renderer.domElement);
    this.labels = new CSS2DRenderer();
    this.labels.domElement.style.position = "absolute";
    this.labels.domElement.style.top = "0";
    this.labels.domElement.style.pointerEvents = "none";
    this.el.appendChild(this.labels.domElement);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.scene.add(new THREE.HemisphereLight(0xf2f4f6, 0x3a3f44, 1.1));
    const d = new THREE.DirectionalLight(0xffffff, 1.4);
    d.position.set(30, 50, 40);
    this.scene.add(d);
    this.groups = {};
    this.opts = { layers: true, labels: true, shell: true };
    this._resize = () => this.resize();
    window.addEventListener("resize", this._resize);
    this.resize();
    const loop = () => { this.raf = requestAnimationFrame(loop); this.controls.update(); this.renderer.render(this.scene, this.camera); this.labels.render(this.scene, this.camera); };
    loop();
  }
  dispose() {
    cancelAnimationFrame(this.raf);
    window.removeEventListener("resize", this._resize);
    this.scene.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) [].concat(o.material).forEach((m) => m.dispose()); });
    this.renderer.dispose();
    this.el.innerHTML = "";
  }
  resize() {
    const w = this.el.clientWidth || 800, hgt = this.el.clientHeight || 600;
    this.camera.aspect = w / hgt;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, hgt);
    this.labels.setSize(w, hgt);
  }
  _group(name) {
    if (this.groups[name]) { this.scene.remove(this.groups[name]); this.groups[name].traverse((o) => { if (o.geometry) o.geometry.dispose(); }); }
    const g = new THREE.Group();
    this.groups[name] = g;
    this.scene.add(g);
    return g;
  }
  label(group, text, pos, cls = "") {
    const div = document.createElement("div");
    div.className = "tag3d " + cls;
    div.textContent = text;
    const o = new CSS2DObject(div);
    o.position.copy(pos);
    group.add(o);
    return o;
  }

  build(geom, fields, st, field) {
    this.geom = geom;
    const p = geom.profile;
    const zBot = p.z_m[0], zTop = p.z_m[p.z_m.length - 1];
    const rAt = (z) => {
      for (let i = 1; i < p.z_m.length; i++) if (z <= p.z_m[i] + 1e-9) {
        const t = (z - p.z_m[i - 1]) / Math.max(p.z_m[i] - p.z_m[i - 1], 1e-9);
        return p.r_m[i - 1] + t * (p.r_m[i] - p.r_m[i - 1]);
      }
      return p.r_m[p.r_m.length - 1];
    };
    this.rAt = rAt;
    // ----------------------------------------------------------- shell (lining + staves)
    const shell = this._group("shell");
    const pts = p.z_m.map((z, i) => new THREE.Vector2(p.r_m[i] + 0.9, z));
    const shellGeo = new THREE.LatheGeometry(pts, 96, Math.PI * 0.25, CUT);
    shell.add(new THREE.Mesh(shellGeo, new THREE.MeshStandardMaterial({ color: 0x8c949b, metalness: 0.35, roughness: 0.6, side: THREE.DoubleSide, transparent: true, opacity: 0.38 })));
    const inner = new THREE.LatheGeometry(p.z_m.map((z, i) => new THREE.Vector2(p.r_m[i], z)), 96, Math.PI * 0.25, CUT);
    shell.add(new THREE.Mesh(inner, new THREE.MeshStandardMaterial({ color: 0x9a6b4f, roughness: 0.9, side: THREE.BackSide })));
    shell.add(new THREE.Mesh(new THREE.CylinderGeometry(p.r_m[0] + 0.9, p.r_m[0] + 0.9, 0.6, 64), new THREE.MeshStandardMaterial({ color: 0x5b636a })).translateY(zBot - 0.3));
    // stave bands coloured by zone heat load (model)
    const walls = st.walls_MW || {};
    const maxQ = Math.max(1, ...Object.values(walls).filter((v) => typeof v === "number"));
    for (const wz of geom.walls || []) {
      const z0 = wz.frac_from * geom.stockline_z_m, z1 = wz.frac_to * geom.stockline_z_m;
      const q = walls[wz.name] || 0;
      const band = new THREE.LatheGeometry([new THREE.Vector2(rAt(z0) + 0.95, z0), new THREE.Vector2(rAt(z1) + 0.95, z1)], 96, Math.PI * 0.25, CUT);
      const c = new THREE.Color().setHSL(0.56, 0.55, 0.62 - 0.32 * (q / maxQ));
      shell.add(new THREE.Mesh(band, new THREE.MeshStandardMaterial({ color: c, transparent: true, opacity: 0.55, side: THREE.DoubleSide })));
      if (this.opts.labels) this.label(shell, `${wz.name.replace(/_/g, " ")} ${q.toFixed(1)} MW`, SIDE_L(rAt((z0 + z1) / 2) + 1.6, (z0 + z1) / 2), "model");
    }
    shell.visible = this.opts.shell;
    // ----------------------------------------------------------- section plane with the field
    this.paintSection(fields, field);
    // ----------------------------------------------------------- burden layers (cut-away rings)
    const lay = this._group("layers");
    for (const L of (fields.layers || []).slice(0, 90)) {
      if (L.z_top > geom.stockline_z_m + 0.05 || L.z_bot < 0.2) continue;
      const g = new THREE.LatheGeometry([new THREE.Vector2(0.02, L.z_bot), new THREE.Vector2(rAt(L.z_bot) - 0.05, L.z_bot),
        new THREE.Vector2(rAt(L.z_top) - 0.05, L.z_top), new THREE.Vector2(0.02, L.z_top)], 64, Math.PI * 0.25 + 0.02, CUT * 0.32);
      lay.add(new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: L.kind === "ore" ? 0x9b4a2f : 0x2f2f2f, roughness: 0.95 })));
    }
    lay.visible = this.opts.layers;
    // ----------------------------------------------------------- cohesive zone (inverted V surface)
    const czg = this._group("cz");
    const cz = fields.cohesive_zone || {};
    if (cz.sectors && cz.sectors.length) {
      const top = Math.max(...cz.sectors.map((s) => s.z_top_m)), bot = Math.min(...cz.sectors.map((s) => s.z_bottom_m));
      const prof = [new THREE.Vector2(0.15 * rAt(top), top), new THREE.Vector2(0.9 * rAt(bot), bot)];
      const g = new THREE.LatheGeometry(prof, 64, Math.PI * 0.25, CUT);
      czg.add(new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0xc8743a, transparent: true, opacity: 0.55, side: THREE.DoubleSide, emissive: 0x3a1a05 })));
      if (this.opts.labels) this.label(czg, `Cohesive zone ${bot.toFixed(1)}-${top.toFixed(1)} m (model, low confidence)`, SIDE_R(rAt(top) + 2.6, top + 0.6), "model");
    }
    // ----------------------------------------------------------- hearth: deadman, liquids, raceways, tuyeres
    const hg = this._group("hearth");
    const hs = st.hearth || {};
    const rh = p.r_m[0];
    const zMetal = zBot + (hs.metal_level_m ?? 1.5), zSlag = zBot + (hs.slag_top_m ?? 2.5), zTh = zBot + (hs.taphole_level_m ?? 2);
    const dm = new THREE.ConeGeometry(0.8 * rh, 0.32 * rh + Math.abs(zBot), 48, 1, true, Math.PI * 0.25, CUT);
    hg.add(new THREE.Mesh(dm, new THREE.MeshStandardMaterial({ color: 0x353535, roughness: 1, side: THREE.DoubleSide })).translateY((zBot + 0.32 * rh) / 2 + 0.2));
    const metal = new THREE.CylinderGeometry(rh - 0.03, rh - 0.03, Math.max(zMetal - zBot, 0.05), 64, 1, false, Math.PI * 0.25, CUT);
    hg.add(new THREE.Mesh(metal, new THREE.MeshStandardMaterial({ color: 0xf2891d, emissive: 0xb84a00, emissiveIntensity: 0.8, roughness: 0.4 })).translateY((zMetal + zBot) / 2));
    if (zSlag > zMetal + 0.02) {
      const slag = new THREE.CylinderGeometry(rh - 0.03, rh - 0.03, zSlag - zMetal, 64, 1, false, Math.PI * 0.25, CUT);
      hg.add(new THREE.Mesh(slag, new THREE.MeshStandardMaterial({ color: 0xb9ad8c, roughness: 0.7, transparent: true, opacity: 0.9 })).translateY((zSlag + zMetal) / 2));
    }
    const k = st.kpis || {};
    const raft = (k.raft_C && k.raft_C.value) || 2050;
    const rwDepth = (k.raceway_depth_m && k.raceway_depth_m.value) || 1.2;
    const nT = geom.n_tuyeres || 24;
    const rwMat = new THREE.MeshStandardMaterial({ color: 0xffd28a, emissive: new THREE.Color(fieldColor("T_gas_C", raft)), emissiveIntensity: 1.0, transparent: true, opacity: 0.85 });
    const tuyMat = new THREE.MeshStandardMaterial({ color: 0x59626b, metalness: 0.6, roughness: 0.4 });
    for (let i = 0; i < nT; i++) {
      const a = (i / nT) * Math.PI * 2;
      const dir = new THREE.Vector3(Math.sin(a), 0, Math.cos(a));
      const rw = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), rwMat);
      rw.scale.set(rwDepth * 0.5, 0.45, 0.35);
      rw.position.copy(dir.clone().multiplyScalar(rh - rwDepth * 0.5));
      rw.lookAt(new THREE.Vector3(0, 0, 0));
      hg.add(rw);
      const t = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 1.4, 8), tuyMat);
      t.position.copy(dir.clone().multiplyScalar(rh + 0.6));
      t.rotation.set(0, 0, 0);
      t.lookAt(new THREE.Vector3(0, 0, 0));
      t.rotateX(Math.PI / 2);
      hg.add(t);
    }
    const bustle = new THREE.TorusGeometry(rh + 2.2, 0.45, 12, 96);
    hg.add(new THREE.Mesh(bustle, tuyMat).rotateX(Math.PI / 2).translateZ(-1.6));
    // ----------------------------------------------------------- top: throat cone, uptakes
    const top = this._group("top");
    const rt = p.r_m[p.r_m.length - 1];
    const cone = new THREE.LatheGeometry([new THREE.Vector2(rt + 0.9, zTop), new THREE.Vector2(0.38 * rt, zTop + 1.8), new THREE.Vector2(0.25 * rt, zTop + 3.2)], 64, Math.PI * 0.25, CUT);
    top.add(new THREE.Mesh(cone, new THREE.MeshStandardMaterial({ color: 0x7d868e, metalness: 0.4, side: THREE.DoubleSide, transparent: true, opacity: 0.55 })));
    for (let i = 0; i < 4; i++) {
      const a = Math.PI / 4 + (i * Math.PI) / 2;
      const up = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 5, 16), tuyMat);
      up.position.set(Math.sin(a) * 0.7 * rt, zTop + 3.5, Math.cos(a) * 0.7 * rt);
      up.rotation.set(Math.cos(a) * 0.35, 0, -Math.sin(a) * 0.35);
      top.add(up);
    }
    // ----------------------------------------------------------- labels with backend values
    const lab = this._group("labels");
    if (this.opts.labels) {
      const tg = st.top_gas || {};
      this.label(lab, `Top gas ${fmt(k.top_gas_T_uptake_C || k.top_gas_T_C)} °C (uptake), η CO ${fmt(k.eta_CO_pct, 1)} %\nCO ${fmtv(tg.dry_vol_pct && tg.dry_vol_pct.CO, 1)} / CO₂ ${fmtv(tg.dry_vol_pct && tg.dry_vol_pct.CO2, 1)} / H₂ ${fmtv(tg.dry_vol_pct && tg.dry_vol_pct.H2, 1)} % dry`, SIDE_R(rt + 4.5, zTop + 2.2), "model");
      this.label(lab, `Raceway: RAFT ${fmt(k.raft_C)} °C, depth ${fmt(k.raceway_depth_m, 2)} m`, SIDE_R(rh + 3.4, 1.0), "model");
      this.label(lab, `Blast ${fmt(k.blast_volume_Nm3_min)} Nm³/min at ${fmt(k.blast_temp_C)} °C`, SIDE_R(rh + 3.4, -1.0), "model");
      this.label(lab, `Hot metal ${fmt(k.hmt_C)} °C, Si ${fmt(k.hm_si_pct, 2)} %`, SIDE_R(rh + 2.2, zTh), "model");
      this.label(lab, `Metal ${fmtv(hs.metal_t, 0)} t, slag ${fmtv(hs.slag_t, 0)} t in hearth`, SIDE_R(rh + 2.2, zBot + 0.6), "model");
      this.label(lab, `Dripping zone ${fmt(k.dripping_zone_height_m, 1)} m`, SIDE_R(rh + 3.0, 3.0), "model");
      this.label(lab, `Thermal reserve ${fmt(k.thermal_reserve_T_C)} °C`, SIDE_R(rAt(geom.stockline_z_m * 0.55) + 2.4, geom.stockline_z_m * 0.55), "model");
    }
    // camera framing
    const H = zTop - zBot + 6;
    this.camera.position.set(H * VIEW[0], (zTop + zBot) / 2 + 1.5 + H * 0.12, H * VIEW[1]);
    this.controls.target.set(0, (zTop + zBot) / 2 + 1.5, 0);
    this.controls.update();
  }

  paintSection(fields, field) {
    const sec = this._group("section");
    const zf = fields.z_faces_m, F = fields.fields[field];
    if (!F) return;
    const edges = fields.r_edges_norm || [0, 1];
    const pos = [], col = [];
    const c = new THREE.Color();
    const quad = (x0, z0, x1, z1, x2, z2, x3, z3, color) => {
      c.set(color);
      for (const [x, z] of [[x0, z0], [x1, z1], [x2, z2], [x0, z0], [x2, z2], [x3, z3]]) { pos.push(x, z, 0); col.push(c.r, c.g, c.b); }
    };
    for (let r = 0; r < F.length; r++) {
      for (let j = 0; j < zf.length - 1; j++) {
        const v = F[r][j];
        if (v === null || v === undefined) continue;
        const z0 = zf[j], z1 = zf[j + 1], ra0 = this.rAt(z0), ra1 = this.rAt(z1);
        const color = fieldColor(field, v);
        for (const sgn of [-1, 1]) quad(sgn * edges[r] * ra0, z0, sgn * edges[r + 1] * ra0, z0, sgn * edges[r + 1] * ra1, z1, sgn * edges[r] * ra1, z1, color);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    const mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide }));
    // the section lies in the cut plane facing the viewer (rotated into the removed quarter)
    mesh.rotation.y = Math.PI * 0.25;
    sec.add(mesh);
  }
  setOption(k, v) {
    this.opts[k] = v;
    if (k === "layers" && this.groups.layers) this.groups.layers.visible = v;
    if (k === "shell" && this.groups.shell) this.groups.shell.visible = v;
  }
}

function fmt(q, d = 0) { const v = q && typeof q === "object" ? q.value : q; return fmtv(v, d); }
function fmtv(v, d = 0) { return v === null || v === undefined || !Number.isFinite(v) ? "-" : v.toFixed(d); }
