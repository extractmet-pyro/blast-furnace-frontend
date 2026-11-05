// App shell: situation strip, display hierarchy navigation (ISA-101 levels), hash router, live stream.
import "@fontsource/barlow-semi-condensed/latin-400.css";
import "@fontsource/barlow-semi-condensed/latin-500.css";
import "@fontsource/barlow-semi-condensed/latin-600.css";
import "@fontsource/barlow-condensed/latin-500.css";
import "@fontsource/barlow-condensed/latin-600.css";
import "./styles.css";
import { API_BASE, Stream, api, auth } from "./lib/api.js";
import { geometry, invalidate, onStreamEvent, refreshStatus, state, subscribe } from "./lib/store.js";
import { clear, errorMsg, field, h, timeUTC, toast } from "./lib/ui.js";
import { PAGES, NAV } from "./pages/index.js";

const strip = document.getElementById("strip");
const rail = document.getElementById("rail");
const view = document.getElementById("view");
let current = null;

function theme(t) {
  try { if (t) localStorage.setItem("bf_theme", t); } catch { /* ignore */ }
  let v = t;
  try { v = v || localStorage.getItem("bf_theme"); } catch { /* ignore */ }
  document.documentElement.dataset.theme = v === "night" ? "night" : "day";
}

// ------------------------------------------------------------------------------- situation strip
function renderStrip() {
  const s = state.status;
  clear(strip);
  if (!s) {
    strip.append(h("span", { class: "plant" }, "BF Twin desk"),
      h("span", { class: "chip bad" }, state.lastError ? errorMsg(state.lastError) : "Connecting to backend ", API_BASE || "(same origin)"));
    strip.append(h("span", { class: "spacer" }), userChip());
    return;
  }
  const fresh = s.data_fresh;
  const health = s.model_health;
  strip.append(
    h("span", { class: "plant", title: s.plant ? s.plant.note || "" : "" }, s.plant ? s.plant.name : "Blast furnace"),
    h("span", { class: "chip synthetic", title: s.label }, s.data_origin === "SYNTHETIC" ? "Synthetic demo data" : s.data_origin),
    h("span", { class: "chip", title: s.mode_description }, "Mode ", h("b", {}, s.mode.replace(/_/g, " ").toLowerCase())),
    h("span", { class: `chip ${fresh ? "good" : "bad"}`, title: `Last good critical data ${s.last_good_data_utc || "never"}` },
      h("span", { class: `dot ${fresh ? "ok" : "bad"}` }), "Data ", h("b", {}, timeUTC(s.data_time_utc)), fresh ? "" : " stale"),
    h("span", { class: `chip ${health === "HEALTHY" ? "good" : health === "DEGRADED" ? "warn" : "bad"}`, title: (s.health_reasons || []).join("; ") },
      "Model ", h("b", {}, health.toLowerCase())),
    h("span", { class: `chip ${s.balance_status === "OK" ? "good" : "bad"}`, title: "Element and energy balance closure of the last step" },
      "Balance ", h("b", {}, s.balance_status === "OK" ? "closed" : s.balance_status.toLowerCase())),
    h("span", { class: `chip ${s.data_quality_score >= 70 ? "" : "warn"}` }, "Data quality ", h("b", {}, s.data_quality_score ?? "-")),
    h("a", { class: `chip ${s.critical_alarm ? "bad" : s.active_alarms ? "warn" : ""}`, href: "#/alarms" }, "Alarms ", h("b", {}, s.active_alarms)),
    h("span", { class: "chip", title: "No code path writes to plant systems" }, "Plant writes ", h("b", {}, "none")),
    h("span", { class: "chip", title: `Stream: ${state.streamState}` }, h("span", { class: `dot ${state.streamState === "live" ? "ok" : state.streamState === "polling" ? "warn" : "bad"}` }), state.streamState),
    h("span", { class: "spacer" }),
    h("button", { class: "btn", title: "Toggle day / night-shift display", onclick: () => theme(document.documentElement.dataset.theme === "night" ? "day" : "night") }, "Theme"),
    userChip(),
  );
}
function userChip() {
  return h("button", { class: "chip", onclick: loginDialog, title: "Sign in / switch role" },
    auth.token ? [h("b", {}, auth.user), " ", auth.role.toLowerCase().replace("_", " ")] : "Viewer (sign in)");
}

function loginDialog() {
  const u = h("input", { autocomplete: "username", value: auth.token ? auth.user : "operator" });
  const p = h("input", { type: "password", autocomplete: "current-password" });
  const msg = h("p", { class: "note" }, "Demo accounts: viewer, operator, metallurgist, engineer, admin. The demo password is the backend's DEMO_USER_PASSWORD (Render dashboard, Environment tab).");
  const d = h("dialog", {},
    h("form", { method: "dialog", onsubmit: async (e) => {
      e.preventDefault();
      try { await api.login(u.value.trim(), p.value); d.close(); toast(`Signed in as ${auth.user} (${auth.role})`, "ok"); restartStream(); route(); }
      catch (err) { msg.textContent = errorMsg(err); msg.style.color = "var(--crit)"; }
    } },
      h("div", { class: "body" }, h("h3", { style: { marginTop: 0 } }, "Sign in"), field("Username", u), field("Password", p), msg),
      h("footer", {},
        auth.token ? h("button", { type: "button", class: "btn", onclick: () => { auth.clear(); d.close(); restartStream(); route(); } }, "Sign out") : null,
        h("button", { type: "button", class: "btn", onclick: () => d.close() }, "Cancel"),
        h("button", { type: "submit", class: "btn primary" }, "Sign in"))));
  document.body.appendChild(d);
  d.addEventListener("close", () => setTimeout(() => d.remove(), 0));
  d.showModal();
}

// ------------------------------------------------------------------------------------- navigation
function renderRail() {
  clear(rail);
  const cur = location.hash.replace(/^#\//, "") || "overview";
  for (const [group, keys] of NAV) {
    rail.append(h("h4", {}, group));
    for (const k of keys) {
      const p = PAGES[k];
      rail.append(h("a", { href: `#/${k}`, "aria-current": k === cur ? "page" : null },
        p.title, k === "alarms" && state.status && state.status.active_alarms ? h("span", { class: "count" }, state.status.active_alarms) : null));
    }
  }
}

async function route() {
  const key = location.hash.replace(/^#\//, "").split("?")[0] || "overview";
  const page = PAGES[key] || PAGES.overview;
  if (current && current.unmount) { try { current.unmount(); } catch (e) { console.error(e); } }
  clear(view);
  renderRail();
  const head = h("div", { class: "page-head" }, h("div", {}, h("h1", {}, page.title), h("p", {}, page.purpose)));
  const body = h("div", {});
  view.append(head, body);
  current = page;
  try {
    await page.mount(body, { head, actions: (...btns) => head.append(h("div", { class: "actions" }, btns)) });
  } catch (e) {
    if (e && e.code === "TWIN_NOT_READY" && /INITIALISING/.test(e.message || "")) {
      // start-up (for example a sleeping free-plan service waking up) or a new configuration: retry by itself
      body.append(h("div", { class: "banner" }, `The twin is initialising (${e.message.replace(/^Twin state is INITIALISING: /, "")}). This display reloads by itself in a few seconds.`));
      const hash = location.hash;
      setTimeout(() => { if (location.hash === hash && current === page) route(); }, 4000);
    } else {
      body.append(h("div", { class: "banner crit" }, `This display could not load: ${errorMsg(e)}`));
    }
  }
  view.focus({ preventScroll: true });
}

// ------------------------------------------------------------------------------------------ stream
let stream = null;
function restartStream() {
  if (stream) stream.stop();
  stream = new Stream(onStreamEvent, (st) => { state.streamState = st; renderStrip(); });
  stream.start();
}
subscribe((kind) => {
  if (kind === "status") { renderStrip(); renderRail(); }
  if (kind === "resync") refreshStatus();
  if (current && current.onTick && kind === "tick") { try { current.onTick(state.tick); } catch (e) { console.error(e); } }
  if (current && current.onEvent && kind === "event") { try { current.onEvent(state.events[0]); } catch (e) { console.error(e); } }
});

let lastConfigVersion = null;
async function statusLoop() {
  const s = await refreshStatus();
  if (s && lastConfigVersion !== null && s.config_version !== lastConfigVersion) { invalidate(); toast("Plant configuration changed - displays reloaded", "info"); route(); }
  if (s) lastConfigVersion = s.config_version;
  setTimeout(statusLoop, 8000);
}

theme();
window.addEventListener("hashchange", route);
renderStrip();
statusLoop().then(() => { route(); restartStream(); geometry().catch(() => {}); });
