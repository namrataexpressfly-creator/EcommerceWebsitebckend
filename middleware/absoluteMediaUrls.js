// Image links in API responses are always full URLs, e.g.
//   https://ecommercewebsitebckend.onrender.com/uploads/categories/0ysZXPp9eO2c.png
// not "/uploads/categories/0ysZXPp9eO2c.png" (a relative link breaks on the Vercel site, which has a different address).
//
// - Responses: every "/uploads/..." value is turned into a full URL on the way out.
// - Requests: a full URL pointing at this server's /uploads is turned back into "/uploads/..." before it is saved,
//   so the database keeps portable paths and a change of backend address never breaks saved images.
//
// The address comes from PUBLIC_API_URL (set it on Render), otherwise from the request itself.

function baseUrl(req) {
  const fromEnv = (process.env.PUBLIC_API_URL || "").trim().replace(/\/+$/, "");
  if (fromEnv) return fromEnv;
  const proto = String(req.headers["x-forwarded-proto"] || req.protocol || "http").split(",")[0].trim();
  return `${proto}://${req.get("host")}`;
}

function relativize(value, base) {
  if (typeof value === "string") {
    return value.startsWith(`${base}/uploads/`) ? value.slice(base.length) : value;
  }
  if (Array.isArray(value)) return value.map((v) => relativize(v, base));
  if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = relativize(v, base);
    return out;
  }
  return value;
}

export default function absoluteMediaUrls(req, res, next) {
  const base = baseUrl(req);

  if (req.body && typeof req.body === "object") req.body = relativize(req.body, base);

  const originalJson = res.json.bind(res);
  res.json = (body) => {
    if (body === undefined) return originalJson(body);
    const text = JSON.stringify(body);
    if (typeof text !== "string" || !text.includes('/uploads/')) return originalJson(body);
    // Also covers links inside rich text (src=\"/uploads/...\"), because the quote is the same character.
    const fixed = text.replace(/"\/uploads\//g, `"${base}/uploads/`);
    res.set("Content-Type", "application/json; charset=utf-8");
    return res.send(fixed);
  };
  next();
}
