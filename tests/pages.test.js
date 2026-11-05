// Display smoke tests: every page of the desk mounts in jsdom against API payloads recorded from the
// backend in demo mode (synthetic data; tests/fixtures/api_recording.json.gz, history arrays thinned).
// Plotly and the WebGL renderer are stubbed because jsdom has neither; data fetching, tiles, tables,
// the SVG schematic and the Three.js scene graph with its value labels run for real.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const REC = JSON.parse(gunzipSync(readFileSync(join(here, "fixtures", "api_recording.json.gz"))).toString("utf8"));

vi.mock("plotly.js-dist-min", () => ({ default: { newPlot: vi.fn(() => Promise.resolve()), react: vi.fn(() => Promise.resolve()), purge: vi.fn() } }));
vi.mock("three", async (importOriginal) => {
  const THREE = await importOriginal();
  class WebGLRenderer {               // jsdom has no WebGL context; everything else in the scene is real
    constructor() { this.domElement = document.createElement("canvas"); }
    setPixelRatio() {}
    setSize() {}
    render() {}
    dispose() {}
  }
  return { ...THREE, WebGLRenderer };
});

const missing = [];
const reply = (status, body) => ({
  ok: status >= 200 && status < 300, status,
  headers: { get: (k) => (String(k).toLowerCase() === "content-type" ? "application/json" : null) },
  text: async () => JSON.stringify(body), json: async () => body,
});
function recorded(method, url) {
  const u = new URL(url);
  const exact = `${method} ${u.pathname}${u.search}`;
  if (exact in REC.responses) return REC.responses[exact];
  const base = `${method} ${u.pathname}`;
  const k = Object.keys(REC.responses).find((x) => x === base || x.startsWith(base + "?"));
  return k ? REC.responses[k] : undefined;
}

let PAGES, THREE, Furnace3D, fieldColor;
beforeAll(async () => {
  globalThis.fetch = vi.fn(async (url, opts = {}) => {
    const method = (opts.method || "GET").toUpperCase();
    const body = recorded(method, String(url));
    if (body === undefined) {
      missing.push(`${method} ${new URL(String(url)).pathname}`);
      return reply(404, { error: { code: "NOT_RECORDED", message: "endpoint not in the recording" } });
    }
    return reply(200, body);
  });
  sessionStorage.setItem("bf_token", "test-token");
  sessionStorage.setItem("bf_role", "ADMIN");
  sessionStorage.setItem("bf_user", "admin");
  ({ PAGES } = await import("../src/pages/index.js"));
  THREE = await import("three");
  ({ Furnace3D } = await import("../src/viz/furnace3d.js"));
  ({ fieldColor } = await import("../src/viz/schematic.js"));
});
afterAll(() => { sessionStorage.clear(); });

const PAGE_IDS = ["overview", "furnace3d", "schematic", "trends", "burden", "blast", "gas", "hearth", "refractory",
  "profiles", "balance", "streams", "thermo", "forecasts", "mpc", "scenarios", "alarms",
  "data", "energy", "config", "admin", "help"];

describe("every display mounts against recorded backend payloads", () => {
  it("covers the whole page registry", () => {
    expect(Object.keys(PAGES).sort()).toEqual([...PAGE_IDS].sort());
  });
  for (const id of PAGE_IDS) {
    it(id, async () => {
      const errors = [];
      const spy = vi.spyOn(console, "error").mockImplementation((...a) => errors.push(a.map(String).join(" ")));
      missing.length = 0;
      const head = document.createElement("header");
      const root = document.createElement("main");
      document.body.append(head, root);
      try {
        await PAGES[id].mount(root, { head, actions: (...btns) => head.append(...btns) });
        await new Promise((r) => setTimeout(r, 60));          // follow-up requests settle
        expect(missing).toEqual([]);
        expect(errors).toEqual([]);
        const text = root.textContent;
        expect(text.length).toBeGreaterThan(60);
        expect(text).not.toMatch(/not in the recording|Backend not reachable|Unexpected server error/);
      } finally {
        if (PAGES[id].unmount) PAGES[id].unmount();
        spy.mockRestore();
        head.remove();
        root.remove();
      }
    });
  }
});

describe("3-D furnace is built from backend values", () => {
  it("labels and the section plane come from the twin state and field payloads", () => {
    const geom = REC.responses["GET /api/v1/twin/geometry"];
    const st = REC.responses["GET /api/v1/twin/state"];
    const fl = REC.responses["GET /api/v1/twin/fields"];
    const el = document.createElement("div");
    document.body.append(el);
    const scene = new Furnace3D(el);
    try {
      scene.build(geom, fl, st, "T_gas_C");
      const labels = [];
      scene.scene.traverse((o) => { if (o.element) labels.push(o.element.textContent); });
      const k = st.kpis;
      expect(labels).toContain(`Hot metal ${k.hmt_C.value.toFixed(0)} °C, Si ${k.hm_si_pct.value.toFixed(2)} %`);
      expect(labels).toContain(`Raceway: RAFT ${k.raft_C.value.toFixed(0)} °C, depth ${k.raceway_depth_m.value.toFixed(2)} m`);
      expect(labels.some((t) => t.startsWith(`Top gas ${k.top_gas_T_uptake_C.value.toFixed(0)} °C (uptake)`))).toBe(true);
      // section plane: two faces x six vertices per model cell, coloured by the field value of that cell
      const F = fl.fields.T_gas_C;
      const cells = F.reduce((a, row) => a + row.filter((v) => v !== null && v !== undefined).length, 0);
      const mesh = scene.groups.section.children[0];
      const colors = mesh.geometry.getAttribute("color");
      expect(colors.count).toBe(cells * 2 * 6);
      const c0 = new THREE.Color(fieldColor("T_gas_C", F[0][0]));
      expect([colors.getX(0), colors.getY(0), colors.getZ(0)].map((v) => v.toFixed(4))).toEqual([c0.r, c0.g, c0.b].map((v) => v.toFixed(4)));
    } finally {
      scene.dispose();
      el.remove();
    }
  });
});
