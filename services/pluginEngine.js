import { decrypt, encrypt } from "../utils/pluginCrypto.js";
import { buildStandardApis, pathsFromApis, mapStandardStatus } from "./standardPlugin.js";
export class PluginApiError extends Error {
  constructor(message, { status = 502, upstreamStatus = null, details = null, url = null } = {}) {
    super(message);
    this.url = url;
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
      return v === undefined ? "" : v;
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


export function pluginApis(plugin) {
  return plugin.integration === "standard" ? buildStandardApis(pathsFromApis(plugin.apis)) : plugin.apis;
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

    const where = process.env.NODE_ENV === "production" ? "" : ` [${method} ${url.origin}${url.pathname}]`;
    throw new PluginApiError(`${plugin.app_name} rejected the request (${res.status})${said ? `: ${said}` : "."}${where}`, {
      upstreamStatus: res.status,
      details: text.slice(0, 500),
      url: `${method} ${url.origin}${url.pathname}`,
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

export async function loginFresh(plugin, storePlugin) {
  return ensureToken(plugin, storePlugin, credentialsOf(storePlugin), { force: true });
}

export function mapResponse(parsed, mapping = {}) {
  const out = {};
  for (const [k, v] of Object.entries(mapping || {})) {
    if (typeof v !== "string") continue;
   
    out[k] = getPath(parsed, v) ?? getPath(parsed?.data, v);
  }

  if (mapping && "label_url" in mapping && !out.label_url) {
    out.label_url = parsed?.data?.shipping_label_url ?? parsed?.shipping_label_url ?? parsed?.data?.label ?? undefined;
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

const usesBearer = (api) =>
  Object.entries(api.headers || {}).some(([k, v]) => /^authorization$/i.test(k) && /^bearer\s/i.test(String(v)));

const asRawToken = (api) => {

  const plain = typeof api.toObject === "function" ? api.toObject() : api;
  return {
    ...plain,
    headers: Object.fromEntries(
      Object.entries(plain.headers || {}).map(([k, v]) => [k, /^authorization$/i.test(k) ? String(v).replace(/^bearer\s+/i, "") : v])
    ),
  };
};

export async function callPluginApi({ plugin, storePlugin, apiType, context = {}, parameter, method }) {
  const creds = credentialsOf(storePlugin);

  if (plugin.adapter_key) return runAdapter({ plugin, storePlugin, apiType, context, creds });

  const apis = pluginApis(plugin);
  const api = apis.find((a) => a.api_type === apiType);
  if (!api) throw new PluginApiError(`${plugin.app_name} does not support "${apiType}".`, { status: 400 });


  const baseApi =
    parameter === undefined && !method
      ? api
      : { ...(typeof api.toObject === "function" ? api.toObject() : api), ...(parameter !== undefined ? { parameter } : {}), ...(method ? { method } : {}) };

  const hasTokenApi = apis.some((a) => a.api_type === "token_generation");
  const canSwitch = usesBearer(baseApi);
  const prefRaw = canSwitch && storePlugin.auth_scheme === "raw";

  const run = async (force, raw) => {
    const token = apiType === "token_generation" ? null : await ensureToken(plugin, storePlugin, creds, { force });
    return rawRequest({ plugin, storePlugin, api: raw ? asRawToken(baseApi) : baseApi, ctx: { ...creds, token, ...context } });
  };


  const plan = [[false, prefRaw]];
  if (canSwitch) plan.push([false, !prefRaw]);
  plan.push([true, prefRaw]);
  if (canSwitch) plan.push([true, !prefRaw]);

  let result;
  let lastErr;
  for (const [force, raw] of plan) {
    try {
      result = await run(force, raw);
      if (canSwitch && (storePlugin.auth_scheme === "raw") !== raw) {
        storePlugin.auth_scheme = raw ? "raw" : "bearer";
        await storePlugin.save();
      }
      break;
    } catch (err) {
      lastErr = err;
      const retryable = err instanceof PluginApiError && err.upstreamStatus === 401 && hasTokenApi && apiType !== "token_generation";
      if (!retryable) {
    
        if (err instanceof PluginApiError && err.upstreamStatus >= 400 && err.upstreamStatus < 500 && apiType !== "token_generation") {
          try {
            const sent = JSON.stringify(renderTemplate(baseApi.parameter, { ...creds, token: "***", ...context }));
            console.warn(`[plugin] ${plugin.app_name} "${apiType}" was rejected (${err.upstreamStatus}) at ${err.url || "unknown URL"}: ${err.details || err.message}. Request body sent: ${sent.slice(0, 1500)}`);
          } catch {}
        }
        throw err;
      }
    }
  }
  if (!result) throw lastErr;
  return { raw: result.parsed, mapped: mapResponse(result.parsed, baseApi.response_mapping), api: baseApi };
}



function mapItem(item, itemMap) {
  if (!itemMap) return item;
  const out = {};
  for (const [k, p] of Object.entries(itemMap)) out[k] = getPath(item, p);
  return out;
}


const first = (o, keys) => {
  for (const k of keys) if (o?.[k] !== undefined && o?.[k] !== null && o?.[k] !== "") return o[k];
  return undefined;
};


const r2n = (n) => Math.round(n * 100) / 100;
const money = (v) => (v === undefined || v === null || v === "" || Number.isNaN(Number(v)) ? undefined : r2n(Number(v)));


function parseDate(v) {
  if (!v) return null;
  const m = /^(\d{2})-(\d{2})-(\d{4})$/.exec(String(v));
  if (m) return Date.UTC(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
  const t = new Date(v).getTime();
  return Number.isNaN(t) ? null : t;
}
function daysBetween(from, to) {
  const a = parseDate(from);
  const b = parseDate(to);
  return a === null || b === null ? undefined : Math.round((b - a) / 86400000);
}

function extraFields(item) {
  const pickup = first(item, ["expected_pickup", "pickup_date", "pickup_time"]);
  const delivery = first(item, ["expressfly_edd", "estimated_delivery", "edd", "etd", "delivery_date"]);
  const out = {
    logo: first(item, ["logo_image", "logo", "logo_url"]),
    expected_pickup: pickup,
    estimated_delivery: delivery,
    tat: first(item, ["tat", "estimated_delivery_days", "delivery_time"]) ?? daysBetween(pickup, delivery),
    freight: money(item.additional_charges?.freight_charge ?? first(item, ["freight_charge", "freight", "sub_total"])),
    cod: money(first(item, ["cod_charge", "cod"])),
    gst: money(first(item, ["gst_tax", "gst", "tax_amount"])),
  };
  return Object.fromEntries(Object.entries(out).filter(([, v]) => v !== undefined));
}

function lenientRates(raw) {
  const candidates = [raw, raw?.data, raw?.data?.rates, raw?.data?.couriers, raw?.data?.services, raw?.rates, raw?.couriers, raw?.services, raw?.result, raw?.results];
  const list = candidates.find((c) => Array.isArray(c) && c.length);
  if (!list) return [];
  return list
    .filter((i) => i && typeof i === "object")
    .map((item, idx) => {
      const name = first(item, ["logistic", "courier_name", "courier", "partner", "api_name", "name", "service_name", "service"]);
      const charge = first(item, ["charge", "total_charge", "freight_charge", "rate", "price", "amount", "total"]);
      return {
        brand: first(item, ["logistic", "courier", "courier_name", "partner"]),
        id: String(first(item, ["logistic_id", "id", "_id", "rate_id", "courier_id", "service_id", "courier_code"]) ?? name ?? idx),
        name: name !== undefined ? String(name) : "Courier",
        charge: Number(charge) || 0,
        eta: first(item, ["eta", "estimated_delivery_days", "delivery_time", "tat", "etd", "estimated_delivery"]) ?? "",
        ...extraFields(item),
        _raw: item,
      };
    });
}

export function normalizeRates(raw, api) {
  const map = api?.response_mapping || {};
  const list = getPath(raw, map.rates);
  const standard = Array.isArray(list)
    ? list.map((item) => ({ ...extraFields(item), ...mapItem(item, map.rate_item), _raw: item }))
    : Array.isArray(raw)
      ? raw.map((i) => mapItem(i, map.rate_item))
      : [];
  return standard.length ? standard : lenientRates(raw);
}

export function rateDetails(item) {
  if (!item || typeof item !== "object") return {};
  const out = {};
  for (const [k, v] of Object.entries(item)) {
    if (Object.keys(out).length >= 12) break;
    if (/token|secret|password|key/i.test(k) || k.length > 40) continue;
    if (typeof v === "number" || typeof v === "boolean" || (typeof v === "string" && v.length > 0 && v.length <= 80)) out[k] = v;
  }
  return out;
}

export function courierNote(raw) {
  const t = first(raw, ["message", "msg", "error", "reason"]) ?? first(raw?.data, ["message", "msg", "error"]);
  return typeof t === "string" ? t.slice(0, 200) : "";
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
  const known = mapStandardStatus(text);
  if (known.known) return known.value;
  if (/not picked|not pickup|manifest|pending|ready to ship/.test(s)) return null;
  if (/out for delivery|ofd/.test(s) && !/rto|return/.test(s)) return "out_for_delivery";
  if (/rto|return/.test(s)) return /deliver/.test(s) && !/undeliver/.test(s) ? "returned" : null; // only a finished return changes the order
  if (/cancel/.test(s)) return "cancelled";
  if (/undeliver|ndr/.test(s)) return null;
  if (/deliver/.test(s)) return "delivered";
  if (/transit|picked|pick up|pickup done|shipped|dispatch/.test(s)) return "shipped";
  return null;
}