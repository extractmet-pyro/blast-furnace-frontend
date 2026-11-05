// Shared state: system status, live tick (from the stream), recent events and cached reference data.
import { api } from "./api.js";

const listeners = new Set();
export const state = {
  status: null,
  tick: null,
  ticks: [],          // rolling buffer of stream ticks (for sparklines between REST refreshes)
  events: [],
  geometry: null,
  config: null,
  streamState: "connecting",
  lastError: null,
};

export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
export function emit(kind, payload) { listeners.forEach((fn) => { try { fn(kind, payload); } catch (e) { console.error(e); } }); }

export function onStreamEvent(ev) {
  if (ev.type === "tick") {
    state.tick = ev;
    state.ticks.push(ev);
    if (state.ticks.length > 720) state.ticks.shift();
    emit("tick", ev);
  } else if (ev.type === "event") {
    state.events.unshift(ev);
    if (state.events.length > 300) state.events.pop();
    emit("event", ev);
  } else if (ev.type === "resync") {
    emit("resync", ev);
  } else if (ev.type === "heartbeat") {
    emit("heartbeat", ev);
  }
}

export async function refreshStatus() {
  try {
    state.status = await api.get("/api/v1/system/status", null, { timeoutMs: 15000 });
    state.lastError = null;
  } catch (e) {
    state.lastError = e;
  }
  emit("status", state.status);
  return state.status;
}

export async function geometry(force = false) {
  if (!state.geometry || force) state.geometry = await api.get("/api/v1/twin/geometry");
  return state.geometry;
}
export async function config(force = false) {
  if (!state.config || force) state.config = await api.get("/api/v1/config/plant");
  return state.config;
}
export function invalidate() { state.geometry = null; state.config = null; }
