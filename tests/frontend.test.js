// Frontend unit tests (vitest + jsdom). Fixtures in tests/fixtures are real payloads captured from the
// backend API in demo mode (synthetic data), so these tests also pin the frontend-backend contract.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const fx = (n) => JSON.parse(readFileSync(join(here, "fixtures", `${n}.json`), "utf8"));

vi.mock("plotly.js-dist-min", () => ({ default: { newPlot: vi.fn(), react: vi.fn(), purge: vi.fn() } }));

const { fmt, labelize, unitOf, timeUTC, kpi, table, provenance, errorMsg, h } = await import("../src/lib/ui.js");
const { api, ApiError, Stream, auth, hasRole } = await import("../src/lib/api.js");
const { schematicSVG, fieldColor, FIELD_LABEL } = await import("../src/viz/schematic.js");
const { PAGES, NAV } = await import("../src/pages/index.js");

describe("formatting", () => {
  it("formats numbers, missing values and large values", () => {
    expect(fmt(1512.34, 0)).toBe("1512");
    expect(fmt(0.4567, 2)).toBe("0.46");
    expect(fmt(null)).toBe("-");
    expect(fmt(NaN)).toBe("-");
    expect(fmt(Infinity)).toBe("-");
    expect(fmt(2.5e6)).toBe("2.50M");
  });
  it("infers units from the API key-suffix convention", () => {
    expect(unitOf("hmt_C")).toBe("°C");
    expect(unitOf("fuel_rate_kg_tHM")).toBe("kg/tHM");
    expect(unitOf("production_t_d")).toBe("t/d");
    expect(unitOf("pressure_drop_kPa")).toBe("kPa");
    expect(unitOf("blast_pressure_kPa_g")).toBe("kPa(g)");
    expect(unitOf("solution_loss_kgC_tHM")).toBe("kgC/tHM");
    expect(unitOf("blast_volume_Nm3_min")).toBe("Nm³/min");
    expect(unitOf("unknown_key")).toBe("");
  });
  it("labels keys and prints UTC times", () => {
    expect(labelize("hm_si_pct")).toBe("Hm si %");
    expect(timeUTC("2026-11-04T18:20:00Z")).toBe("18:20Z");
    expect(timeUTC(null)).toBe("-");
  });
});

describe("provenance and faceplates", () => {
  it("never renders a model value as measured", () => {
    const st = fx("state");
    const hmt = st.kpis.hmt_C;
    expect(hmt.provenance).toBe("MODEL");
    const el = kpi("Hot metal temperature", hmt, { d: 0 });
    expect(el.classList.contains("model")).toBe(true);
    expect(el.querySelector(".prov").textContent).toBe("Model");
    expect(provenance("MEASURED").className).toContain("measured");
    expect(provenance("HYBRID").textContent).toBe("Hybrid");
  });
  it("flags alarm and hard limits on tiles", () => {
    const lim = { low_alarm: 1480, low_hard: 1450, high_alarm: 1540, high_hard: 1570 };
    expect(kpi("x", { value: 1470, unit: "degC", provenance: "MODEL" }, { limits: lim }).className).toContain("alarm-warn");
    expect(kpi("x", { value: 1440, unit: "degC", provenance: "MODEL" }, { limits: lim }).className).toContain("alarm-crit");
    expect(kpi("x", { value: 1500, unit: "degC", provenance: "MODEL" }, { limits: lim }).className).not.toContain("alarm");
  });
  it("tables escape nothing they should not and show '-' for missing cells", () => {
    const t = table([{ label: "A", key: "a" }, { label: "B", key: "b", num: true, d: 1 }], [{ a: "<b>x</b>", b: null }]);
    const cells = t.querySelectorAll("td");
    expect(cells[0].textContent).toBe("<b>x</b>");          // text node, not HTML
    expect(cells[0].querySelector("b")).toBeNull();
    expect(cells[1].textContent).toBe("-");
  });
  it("h() does not treat data as markup", () => {
    const el = h("div", {}, "<img src=x onerror=alert(1)>");
    expect(el.querySelector("img")).toBeNull();
  });
});

describe("API client", () => {
  beforeEach(() => { sessionStorage.clear(); });
  afterEach(() => { vi.restoreAllMocks(); });
  it("maps the backend error envelope into ApiError", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: { code: "OUTSIDE_ENVELOPE", message: "blast_temp_C outside envelope", request_id: "r-1", details: [{ msg: "too high" }] } }),
      { status: 422, headers: { "Content-Type": "application/json" } })));
    let err;
    try { await api.post("/api/v1/simulations", { scenario_id: "S03" }); } catch (e) { err = e; }
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(422);
    expect(err.code).toBe("OUTSIDE_ENVELOPE");
    expect(errorMsg(err)).toContain("blast_temp_C outside envelope");
  });
  it("sends the bearer token only when signed in and ranks roles", async () => {
    const seen = [];
    vi.stubGlobal("fetch", vi.fn(async (url, init) => { seen.push(init.headers); return new Response("{}", { status: 200 }); }));
    await api.get("/api/v1/system/status");
    expect(seen[0].Authorization).toBeUndefined();
    auth.set("tok-123", "OPERATOR", "operator");
    await api.get("/api/v1/system/status");
    expect(seen[1].Authorization).toBe("Bearer tok-123");
    expect(hasRole("VIEWER")).toBe(true);
    expect(hasRole("OPERATOR")).toBe(true);
    expect(hasRole("PROCESS_ENGINEER")).toBe(false);
    auth.clear();
    expect(hasRole("OPERATOR")).toBe(false);
  });
});

describe("event stream (polling fallback)", () => {
  afterEach(() => { vi.restoreAllMocks(); });
  it("tracks sequence numbers, ignores stale events and signals resync", async () => {
    const poll = fx("poll");
    const seqs = poll.events.map((e) => e.seq);
    const calls = [];
    vi.stubGlobal("fetch", vi.fn(async (url) => {
      calls.push(String(url));
      const first = calls.length === 1;
      const body = first ? poll : { events: [], latest_seq: Math.max(...seqs) + 50, oldest_seq: Math.max(...seqs) + 40, resync_required: true };
      return new Response(JSON.stringify(body), { status: 200 });
    }));
    const got = [];
    const s = new Stream((ev) => got.push(ev));
    s.mode = "poll";
    await s._pollLoop();
    expect(s.lastSeq).toBe(Math.max(...seqs));
    await s._pollLoop();
    s.stop();
    expect(calls[1]).toContain(`since_seq=${Math.max(...seqs)}`);
    expect(got.some((e) => e.type === "resync")).toBe(true);
    expect(s.lastSeq).toBe(Math.max(...seqs) + 50);
  });
});

describe("furnace schematic", () => {
  it("draws the furnace to scale from the geometry payload with model and measured tags", () => {
    const geom = fx("geometry"), fields = fx("fields"), st = fx("state");
    const meas = { TG_TEMP: { tag: "TG_TEMP", value: 171.2, unit: "degC", quality: "GOOD" } };
    const svg = schematicSVG({ geom, fields, st, meas, field: "T_gas_C", width: 900 });
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg.trim().endsWith("</svg>")).toBe(true);
    const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
    expect(doc.querySelector("parsererror")).toBeNull();
    const text = doc.documentElement.textContent;
    for (const region of ["Throat", "Stack", "Belly", "Bosh", "Hearth"]) expect(text).toContain(region);
    expect(text).toMatch(/Raceway|raceway/);
    expect(doc.querySelectorAll(".val.model").length).toBeGreaterThan(3);
    expect(doc.querySelectorAll("rect, path, polygon").length).toBeGreaterThan(50);
  });
  it("maps field values onto the colour ramps", () => {
    expect(fieldColor("T_gas_C", 100)).not.toBe(fieldColor("T_gas_C", 2000));
    expect(FIELD_LABEL.T_gas_C).toContain("°C");
  });
});

describe("page registry", () => {
  it("every navigation entry resolves to a page with title, purpose and mount()", () => {
    const keys = NAV.flatMap(([, ks]) => ks);
    expect(keys.length).toBeGreaterThanOrEqual(22);
    for (const k of keys) {
      const p = PAGES[k];
      expect(p, k).toBeTruthy();
      expect(typeof p.title).toBe("string");
      expect(typeof p.purpose).toBe("string");
      expect(typeof p.mount).toBe("function");
    }
  });
  it("no page source contains a plant-write call", () => {
    const src = Object.keys(PAGES).map((k) => PAGES[k].mount.toString()).join("\n");
    expect(src).not.toMatch(/opcua|modbus|\/write\b|plant_write\s*:\s*true/i);
  });
});
