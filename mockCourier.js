import http from "http";

const PORT = 5005;
const TOKEN = "mock-token-123";
const TOKEN_TTL_SECONDS = 3600;

const warehouses = new Map(); 
const rates = new Map();
const shipments = new Map(); 
const byOrder = new Map(); 
let trackingUrl = null; 
const lastPayload = new Map(); 
const STATUS_LABELS = {
  created: "Created",
  picked_up: "Picked Up",
  in_transit: "In Transit",
  out_for_delivery: "Out For Delivery",
  delivered: "Delivered",
  undelivered: "Undelivered",
  rto_initiated: "RTO Initiated",
  rto_delivered: "RTO Delivered",
  cancelled: "Cancelled",
};
let counter = 1000;

const send = (res, code, body) => {
  res.writeHead(code, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
};
const fail = (res, message, code = 400) => send(res, code, { success: false, message });
const readJson = (req) =>
  new Promise((resolve) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        resolve(null);
      }
    });
  });

const missing = (obj, fields) => fields.filter((f) => obj?.[f] === undefined || obj?.[f] === null || obj?.[f] === "");

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    const body = req.method === "POST" ? await readJson(req) : {};
    console.log(`${req.method} ${url.pathname}${url.search}`, body && Object.keys(body).length ? JSON.stringify(body) : "");

    
    if (req.method === "GET" && url.pathname === "/simulate") {
      if (!trackingUrl) return fail(res, "No tracking URL registered yet. In Expressfly click 'Save & test connection' first.");
      const awb = url.searchParams.get("awb");
      const key = url.searchParams.get("status") || "in_transit";
      const label = STATUS_LABELS[key] || key;
      let payload = url.searchParams.get("same") ? lastPayload.get(awb) : null;
      if (!payload) {
        const n = ++counter;
        payload = {
          _id: `6a46${String(n).padStart(20, "0")}`,
          order_no: "#EXP" + String(awb || "").replace(/\D/g, "").slice(-9),
          awb,
          last_tracking_status: label,
          tracking_logs: [
            {
              scan_date_time: new Date().toISOString(),
              scan: label,
              order_status_id: Object.keys(STATUS_LABELS).indexOf(key) + 1,
              location: url.searchParams.get("location") || "Mumbai",
              remark: url.searchParams.get("remark") || `${label} (from mock courier)`,
              longitude: "",
              latitude: "",
              _id: `6a47${String(n).padStart(20, "0")}`,
            },
          ],
          event_type: "TRACKING_UPDATED",
        };
        lastPayload.set(awb, payload);
      }
      try {
        const r = await fetch(trackingUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
        const answer = await r.text();
        console.log("  -> Expressfly answered", r.status, answer);
        return send(res, 200, { sent_to: trackingUrl, payload, expressfly_status: r.status, expressfly_answer: safeJson(answer) });
      } catch (e) {
        return fail(res, `Could not reach Expressfly: ${e.message}`, 502);
      }
    }

    if (body === null) return fail(res, "Body must be valid JSON.");
    if (req.method !== "POST") return fail(res, "Unauthorized", 401);

    // 1) login
    if (url.pathname === "/login") {
      const m = missing(body, ["username", "password"]);
      if (m.length) return fail(res, `Missing: ${m.join(", ")}`);
      if (body.username !== "test-user" || body.password !== "test-pass") return fail(res, "Invalid username or password", 401);
      return send(res, 200, { success: true, token: TOKEN, expires_in: TOKEN_TTL_SECONDS });
    }

    if (req.headers.authorization !== `Bearer ${TOKEN}`) return fail(res, "Unauthorized", 401);
    if (req.headers["x-expressfly-version"] !== "1") return fail(res, "Missing header X-Expressfly-Version: 1");

    // 2) create warehouse
    if (url.pathname === "/create-warehouse") {
      const m = missing(body, ["warehouse_ref", "name", "phone"]).concat(missing(body.address, ["line1", "city", "state", "pincode"]).map((f) => `address.${f}`));
      if (m.length) return fail(res, `Missing: ${m.join(", ")}`);
      if (!warehouses.has(body.warehouse_ref)) warehouses.set(body.warehouse_ref, `CW-${++counter}`);
      return send(res, 200, { success: true, warehouse_id: warehouses.get(body.warehouse_ref) });
    }

    // 3) get rates
    if (url.pathname === "/get-rates") {
      const m = missing(body, ["pickup_pincode", "delivery_pincode", "payment_mode", "weight_kg"]);
      if (m.length) return fail(res, `Missing: ${m.join(", ")}`);
      if (!["prepaid", "cod"].includes(body.payment_mode)) return fail(res, 'payment_mode must be "prepaid" or "cod".');
      if (body.warehouse_id && ![...warehouses.values()].includes(body.warehouse_id)) return fail(res, `Unknown warehouse_id ${body.warehouse_id}.`);
      if (String(body.delivery_pincode) === "000000") return fail(res, "Pincode 000000 is not serviceable.");
      const w = Number(body.weight_kg) || 0.5;
      const list = [
        { id: `RATE-${++counter}`, courier_name: "Mock Express", charge: Math.round((80 + w * 20 + (body.payment_mode === "cod" ? 25 : 0)) * 100) / 100, currency: "INR", eta: "2 days" },
        { id: `RATE-${++counter}`, courier_name: "Mock Standard", charge: Math.round((55 + w * 10 + (body.payment_mode === "cod" ? 25 : 0)) * 100) / 100, currency: "INR", eta: "5 days" },
      ];
      list.forEach((r) => rates.set(r.id, r));
      return send(res, 200, { success: true, rates: list });
    }

    // 4) ship order
    if (url.pathname === "/ship-orders") {
      const m = missing(body, ["rate_id", "order_id", "payment_mode"])
        .concat(missing(body.pickup, ["name", "phone", "pincode"]).map((f) => `pickup.${f}`))
        .concat(missing(body.delivery, ["name", "phone", "line1", "city", "state", "pincode"]).map((f) => `delivery.${f}`))
        .concat(missing(body.package, ["weight_kg"]).map((f) => `package.${f}`));
      if (m.length) return fail(res, `Missing: ${m.join(", ")}`);
      if (!Array.isArray(body.items) || !body.items.length) return fail(res, "items must be a non-empty list.");
      if (!rates.has(body.rate_id)) return fail(res, `Unknown rate_id ${body.rate_id}. Call /get-rates first.`);
      if (byOrder.has(body.order_id)) return send(res, 200, { success: true, ...shipments.get(byOrder.get(body.order_id)) }); 
      const awb = `MOCK${Date.now()}${++counter}`;
      const shipment = {
        awb,
        courier_name: rates.get(body.rate_id).courier_name,
        tracking_url: `http://localhost:${PORT}/track-page/${awb}`,
        label_url: `http://localhost:${PORT}/labels/${awb}.pdf`,
        estimated_delivery: new Date(Date.now() + 3 * 86400000).toISOString(),
      };
      shipments.set(awb, shipment);
      byOrder.set(body.order_id, awb);
      return send(res, 200, { success: true, ...shipment });
    }

    // 5) set tracking webhook url
    if (url.pathname === "/set-webhook-url") {
      const hook = body.track_order_endpoint || body.tracking_url;
      if (!/^https?:\/\//i.test(String(hook || ""))) return fail(res, "track_order_endpoint must be an http(s) URL.");
      trackingUrl = hook;
      console.log("  tracking_url stored:", trackingUrl);
      return send(res, 200, { success: true });
    }

    fail(res, "Not found", 404);
  })
  .listen(PORT, () => console.log(`Mock courier running at http://localhost:${PORT}   (login: test-user / test-pass)`));

function safeJson(t) {
  try {
    return JSON.parse(t);
  } catch {
    return t;
  }
}
