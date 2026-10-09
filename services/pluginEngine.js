import { decrypt, encrypt } from "../utils/pluginCrypto.js";
export class PluginApiError extends Error {
  constructor(message, { status = 502, upstreamStatus = null, details = null } = {}) {
    super(message);
    this.name = "PluginApiError";
    this.status = status;
    this.upstreamStatus = upstreamStatus;
    this.details = details;
  }
}


export const route = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch((err) => {
    if (err instanceof PluginApiError) {
      return res.status(err.status).json({
        error: err.message,
        details: err.details ? String(err.details).slice(0, 500) : undefined,
      });
    }
    next(err);
  });



const TOKEN_RE = /\{\{\s*([\w.]+)\s*\}\}/g;
const SINGLE_RE = /^\{\{\s*([\w.]+)\s*\}\}$/;

export function getPath(obj, path) {
  if (!path) return undefined;
  return String(path)
    .split(".")
    .reduce((acc, key) => (acc === null || acc === undefined ? undefined : acc[key]), obj);
}


export function renderTemplate(tpl, ctx) {
  if (typeof tpl === "string") {
    const single = tpl.match(SINGLE_RE);
    if (single) {
      const v = getPath(ctx, single[1]);
      return v === undefined || v === null ? "" : v;
    }
    return tpl.replace(TOKEN_RE, (_, p) => {
      const v = getPath(ctx, p);
      return v === undefined || v === null ? "" : String(v);
    });
  }
  if (Array.isArray(tpl)) return tpl.map((t) => renderTemplate(t, ctx));
  if (tpl && typeof tpl === "object") {
    return Object.fromEntries(Object.entries(tpl).map(([k, v]) => [k, renderTemplate(v, ctx)]));
  }
  return tpl;
}



export function credentialsOf(storePlugin) {
  const out = {};
  for (const a of storePlugin.attributes || []) out[a.name] = decrypt(a.value);
  return out;
}

export function missingRequired(plugin, storePlugin) {
  const creds = credentialsOf(storePlugin);
  return (plugin.attributes || []).filter((a) => a.is_required && !creds[a.name]).map((a) => a.label || a.name);
}

export function isReady(plugin, storePlugin) {
  return (
    plugin.status === "active" &&
    storePlugin.status === "active" &&
    missingRequired(plugin, storePlugin).length === 0
  );
}

function baseUrl(plugin, environment) {
  const d =
    plugin.api_domains.find((x) => x.environment === environment) ||
    plugin.api_domains.find((x) => x.environment === "live") ||
    plugin.api_domains[0];
  if (!d) throw new PluginApiError(`${plugin.app_name} has no API domain configured.`, { status: 500 });
  return d.url.replace(/\/+$/, "");
}



async function parseBody(text, type) {
  if (!text) return {};
  if (type === "xml") {

    const { XMLParser } = await import("fast-xml-parser");
    return new XMLParser({ ignoreAttributes: false }).parse(text);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new PluginApiError("The courier sent a response we could not read.", { details: text.slice(0, 300) });
  }
}


function courierMessage(text) {
  try {
    const j = JSON.parse(text);
    const m = j?.message || j?.error;
    return typeof m === "string" ? m.slice(0, 200) : "";
  } catch {
    return "";
  }
}

async function rawRequest({ plugin, storePlugin, api, ctx }) {
  const method = api.method.toUpperCase();
  const path = String(renderTemplate(api.path, ctx));
  const full = /^https?:\/\//i.test(path) ? path : baseUrl(plugin, storePlugin.environment) + (path.startsWith("/") ? "" : "/") + path;

  if (process.env.NODE_ENV === "production" && !full.startsWith("https://")) {
    throw new PluginApiError("Courier URLs must use https.", { status: 500 });
  }

  const url = new URL(full);
  const headers = {
    Accept: api.response_type === "xml" ? "application/xml" : "application/json",
    ...renderTemplate(api.headers || {}, ctx),
  };
  const payload = renderTemplate(api.parameter ?? {}, ctx);

  let body;
  if (method === "GET" || method === "DELETE") {
    for (const [k, v] of Object.entries(payload || {})) {
      if (v !== "" && v !== null && v !== undefined) url.searchParams.set(k, String(v));
    }
  } else if (typeof payload === "string") {
    body = payload;
  } else {
    const ctKey = Object.keys(headers).find((h) => h.toLowerCase() === "content-type");
    if (ctKey && /x-www-form-urlencoded/i.test(headers[ctKey])) {
      body = new URLSearchParams(Object.entries(payload).map(([k, v]) => [k, String(v)])).toString();
    } else {
      body = JSON.stringify(payload);
      if (!ctKey) headers["Content-Type"] = "application/json";
    }
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  let res;
  try {
    res = await fetch(url, { method, headers, body, signal: controller.signal });
  } catch (err) {
    throw new PluginApiError(
      err.name === "AbortError" ? `${plugin.app_name} took too long to respond.` : `Could not reach ${plugin.app_name}.`,
      { status: 504 }
    );
  } finally {
    clearTimeout(timer);
  }

  const text = await res.text();
  if (!res.ok) {
    const said = courierMessage(text);
    throw new PluginApiError(`${plugin.app_name} rejected the request (${res.status})${said ? `: ${said}` : "."}`, {
      upstreamStatus: res.status,
      details: text.slice(0, 500),
    });
  }
  const parsed = await parseBody(text, api.response_type);

  if (plugin.integration === "standard" && parsed && parsed.success === false) {
    throw new PluginApiError(`${plugin.app_name}: ${String(parsed.message || "the request was not accepted.").slice(0, 300)}`, {
      status: 400,
      details: text.slice(0, 500),
    });
  }
  return { parsed, status: res.status };
}



async function ensureToken(plugin, storePlugin, creds, { force = false } = {}) {
  const tokenApi = plugin.apis.find((a) => a.api_type === "token_generation");
  if (!tokenApi) return null;

  const cache = storePlugin.token_cache;
  if (!force && cache?.token && cache.expires_at && cache.expires_at.getTime() > Date.now() + 60_000) {
    return decrypt(cache.token);
  }

  const { parsed } = await rawRequest({ plugin, storePlugin, api: tokenApi, ctx: { ...creds } });
  const map = tokenApi.response_mapping || {};
  const token = getPath(parsed, map.token || "token");
  if (!token) {
    throw new PluginApiError(`${plugin.app_name} did not return a login token. Please check your credentials.`, {
      status: 400,
      details: JSON.stringify(parsed).slice(0, 300),
    });
  }
  const ttl = Number(getPath(parsed, map.expires_in)) || Number(map.default_ttl_seconds) || 3000;
  storePlugin.token_cache = { token: encrypt(token), expires_at: new Date(Date.now() + ttl * 1000) };
  await storePlugin.save();
  return token;
}



export function mapResponse(parsed, mapping = {}) {
  const out = {};
  for (const [k, v] of Object.entries(mapping || {})) {
    if (typeof v === "string") out[k] = getPath(parsed, v);
  }
  return out;
}

async function runAdapter({ plugin, storePlugin, apiType, context, creds }) {
  if (!/^[a-z0-9_-]+$/i.test(plugin.adapter_key)) {
    throw new PluginApiError("Invalid adapter configured for this plugin.", { status: 500 });
  }
  let mod;
  try {
    mod = await import(`../adapters/${plugin.adapter_key}.js`);
  } catch {
    throw new PluginApiError(`Adapter "${plugin.adapter_key}" is not installed on the server.`, { status: 500 });
  }
  const fn = mod[apiType] || mod.default?.[apiType];
  if (typeof fn !== "function") {
    throw new PluginApiError(`${plugin.app_name} does not support "${apiType}".`, { status: 400 });
  }
  const result = await fn({ plugin, storePlugin, creds, context, environment: storePlugin.environment });
  return { raw: result?.raw ?? result, mapped: result?.mapped ?? result, api: null };
}

export async function callPluginApi({ plugin, storePlugin, apiType, context = {} }) {
  const creds = credentialsOf(storePlugin);

  if (plugin.adapter_key) return runAdapter({ plugin, storePlugin, apiType, context, creds });

  const api = plugin.apis.find((a) => a.api_type === apiType);
  if (!api) throw new PluginApiError(`${plugin.app_name} does not support "${apiType}".`, { status: 400 });

  const hasTokenApi = plugin.apis.some((a) => a.api_type === "token_generation");
  const run = async (force) => {
    const token = apiType === "token_generation" ? null : await ensureToken(plugin, storePlugin, creds, { force });
    return rawRequest({ plugin, storePlugin, api, ctx: { ...creds, token, ...context } });
  };

  let result;
  try {
    result = await run(false);
  } catch (err) {

    if (err instanceof PluginApiError && err.upstreamStatus === 401 && hasTokenApi && apiType !== "token_generation") {
      result = await run(true);
    } else {
      throw err;
    }
  }
  return { raw: result.parsed, mapped: mapResponse(result.parsed, api.response_mapping), api };
}



function mapItem(item, itemMap) {
  if (!itemMap) return item;
  const out = {};
  for (const [k, p] of Object.entries(itemMap)) out[k] = getPath(item, p);
  return out;
}


export function normalizeRates(raw, api) {
  const map = api?.response_mapping || {};
  const list = getPath(raw, map.rates);
  if (!Array.isArray(list)) return Array.isArray(raw) ? raw.map((i) => mapItem(i, map.rate_item)) : [];
  return list.map((item) => ({ ...mapItem(item, map.rate_item), _raw: item }));
}

export function normalizeEvents(raw, api) {
  const map = api?.response_mapping || {};
  const list = getPath(raw, map.events);
  if (!Array.isArray(list)) return [];
  return list.map((item) => {
    const e = mapItem(item, map.event_item) || {};
    return { status: String(e.status ?? ""), note: String(e.note ?? ""), at: e.at ? new Date(e.at) : new Date() };
  });
}


export function mapCourierStatus(text) {
  const s = String(text || "").toLowerCase();
  if (!s) return null;
  if (/out for delivery|ofd/.test(s)) return "out_for_delivery";
  if (/rto|return/.test(s)) return "returned";
  if (/cancel/.test(s)) return "cancelled";
  if (/deliver/.test(s)) return "delivered";
  if (/transit|picked|pick up|pickup done|shipped|dispatch|manifest/.test(s)) return "shipped";
  return null;
}
