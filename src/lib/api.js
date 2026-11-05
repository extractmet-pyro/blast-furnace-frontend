// REST + stream client for the BF twin backend (/api/v1). The base URL is baked in at build time
// (VITE_API_BASE_URL). Tokens live in sessionStorage only (cleared with the tab). Every error is
// surfaced with the backend's structured {error:{code,message,details,request_id}} body.

const ENV_BASE = (import.meta.env && import.meta.env.VITE_API_BASE_URL) || "";
export const API_BASE = (ENV_BASE || (typeof location !== "undefined" && location.port === "5173" ? "http://localhost:8000" : "")).replace(/\/$/, "");

export class ApiError extends Error {
  constructor(status, body, path) {
    const e = (body && body.error) || {};
    super(e.message || `HTTP ${status}`);
    this.status = status;
    this.code = e.code || `HTTP_${status}`;
    this.details = e.details;
    this.requestId = e.request_id;
    this.path = path;
  }
}

const store = {
  get(k) { try { return sessionStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { v == null ? sessionStorage.removeItem(k) : sessionStorage.setItem(k, v); } catch { /* storage unavailable */ } },
};

export const auth = {
  get token() { return store.get("bf_token"); },
  get role() { return store.get("bf_role") || "VIEWER"; },
  get user() { return store.get("bf_user") || "anonymous"; },
  set(token, role, user) { store.set("bf_token", token); store.set("bf_role", role); store.set("bf_user", user); },
  clear() { store.set("bf_token", null); store.set("bf_role", null); store.set("bf_user", null); },
};

const ROLE_RANK = { VIEWER: 1, OPERATOR: 2, METALLURGIST: 3, PROCESS_ENGINEER: 4, ADMIN: 5 };
export const hasRole = (min) => (ROLE_RANK[auth.role] || 0) >= (ROLE_RANK[min] || 99);

async function request(method, path, { body, query, timeoutMs = 30000, raw = false, headers = {}, form } = {}) {
  const url = new URL(API_BASE + path, typeof location !== "undefined" ? location.href : "http://localhost");
  if (query) Object.entries(query).forEach(([k, v]) => v !== undefined && v !== null && url.searchParams.set(k, v));
  const h = { ...headers };
  if (auth.token) h.Authorization = `Bearer ${auth.token}`;
  let payload;
  if (form) payload = form;
  else if (body !== undefined) { h["Content-Type"] = "application/json"; payload = JSON.stringify(body); }
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  let res;
  try {
    res = await fetch(url, { method, headers: h, body: payload, signal: ctl.signal });
  } catch (err) {
    clearTimeout(timer);
    const e = new ApiError(0, { error: { code: err.name === "AbortError" ? "TIMEOUT" : "NETWORK",
      message: err.name === "AbortError" ? `No response from the backend within ${timeoutMs / 1000} s` :
        `Backend not reachable at ${API_BASE || "(same origin)"} - check VITE_API_BASE_URL and CORS_ORIGINS` } }, path);
    throw e;
  }
  clearTimeout(timer);
  if (res.status === 401 && auth.token) auth.clear();
  if (raw) {
    if (!res.ok) throw new ApiError(res.status, await res.json().catch(() => null), path);
    return res;
  }
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
  if (!res.ok) throw new ApiError(res.status, data, path);
  return data;
}

export const api = {
  get: (p, query, o) => request("GET", p, { query, ...o }),
  post: (p, body, o) => request("POST", p, { body, ...o }),
  put: (p, body, o) => request("PUT", p, { body, ...o }),
  del: (p, o) => request("DELETE", p, o),
  upload: (p, file, fields = {}) => {
    const fd = new FormData();
    fd.append("file", file);
    Object.entries(fields).forEach(([k, v]) => fd.append(k, v));
    return request("POST", p, { form: fd, timeoutMs: 120000 });
  },
  async download(p, query, filename) {
    const res = await request("GET", p, { query, raw: true, timeoutMs: 120000 });
    const blob = await res.blob();
    const cd = res.headers.get("Content-Disposition") || "";
    const m = /filename="([^"]+)"/.exec(cd);
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = (m && m[1]) || filename || "export";
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  },
  async login(username, password) {
    const r = await request("POST", "/api/v1/auth/login", { body: { username, password } });
    auth.set(r.access_token, r.role, username);
    return r;
  },
  async waitJob(id, onProgress, { intervalMs = 1500, maxMs = 30 * 60 * 1000 } = {}) {
    const t0 = Date.now();
    for (;;) {
      const j = await api.get(`/api/v1/simulations/${id}`);
      onProgress && onProgress(j);
      if (!["PENDING", "RUNNING"].includes(j.status)) return j;
      if (Date.now() - t0 > maxMs) throw new ApiError(0, { error: { code: "JOB_TIMEOUT", message: "Job did not finish in time" } }, id);
      await new Promise((r) => setTimeout(r, intervalMs));
    }
  },
};

// ---------------------------------------------------------------------------------------- stream
// WebSocket with sequence tracking; reconnects with back-off and resumes from the last sequence.
// Falls back to HTTP polling when WebSockets are blocked (corporate proxies).
export class Stream {
  constructor(onEvent, onState) {
    this.onEvent = onEvent;
    this.onState = onState || (() => {});
    this.lastSeq = 0;
    this.retry = 0;
    this.mode = "ws";
    this.closed = false;
    this.lastMsgAt = 0;
  }
  start() { this.closed = false; this._connect(); this._watchdog = setInterval(() => this._check(), 5000); }
  stop() { this.closed = true; clearInterval(this._watchdog); clearTimeout(this._poll); try { this.ws && this.ws.close(); } catch { /* closed */ } }
  _wsUrl() {
    const base = API_BASE || location.origin;
    const u = new URL(base.replace(/^http/, "ws") + "/api/v1/stream");
    if (auth.token) u.searchParams.set("token", auth.token);
    if (this.lastSeq) u.searchParams.set("since_seq", this.lastSeq);
    return u.toString();
  }
  _connect() {
    if (this.closed) return;
    if (this.mode === "poll") return this._pollLoop();
    let ws;
    try { ws = new WebSocket(this._wsUrl()); } catch { this.mode = "poll"; return this._pollLoop(); }
    this.ws = ws;
    this.onState("connecting");
    ws.onopen = () => { this.retry = 0; this.onState("live"); };
    ws.onmessage = (m) => {
      this.lastMsgAt = Date.now();
      let ev;
      try { ev = JSON.parse(m.data); } catch { return; }
      if (ev.type === "resync_required") { this.lastSeq = ev.latest_seq; this.onEvent({ type: "resync" }); return; }
      if (ev.seq && ev.seq > this.lastSeq) this.lastSeq = ev.seq;
      this.onEvent(ev);
    };
    ws.onclose = (e) => {
      if (this.closed) return;
      this.onState("reconnecting");
      if (e.code === 4401 || e.code === 4403) { this.mode = "poll"; }
      this.retry += 1;
      if (this.retry > 3) this.mode = "poll";
      setTimeout(() => this._connect(), Math.min(1000 * 2 ** this.retry, 15000));
    };
    ws.onerror = () => { /* onclose follows */ };
  }
  async _pollLoop() {
    if (this.closed) return;
    this.onState("polling");
    try {
      const r = await api.get("/api/v1/stream/poll", { since_seq: this.lastSeq, limit: 200 }, { timeoutMs: 15000 });
      if (r.resync_required) this.onEvent({ type: "resync" });
      for (const ev of r.events) { if (ev.seq > this.lastSeq) this.lastSeq = ev.seq; this.onEvent(ev); }
      if (!r.events.length && r.latest_seq > this.lastSeq) this.lastSeq = r.latest_seq;
      this.lastMsgAt = Date.now();
    } catch { this.onState("offline"); }
    this._poll = setTimeout(() => this._pollLoop(), 4000);
  }
  _check() {
    if (this.mode === "ws" && this.lastMsgAt && Date.now() - this.lastMsgAt > 40000) {
      this.onState("stale");
      try { this.ws && this.ws.close(); } catch { /* closed */ }
    }
  }
}
