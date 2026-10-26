import express from "express";
import crypto from "crypto";
import StorePlugin from "../models/StorePlugin.js";
import Plugin from "../models/Plugin.js";
import Shipment from "../models/Shipment.js";
import { getPath, mapCourierStatus } from "../services/pluginEngine.js";
import { syncOrderFromShipments } from "../services/shipmentSync.js";
import { FINAL_SHIPMENT_STATUSES, mapStandardStatus, normaliseLabel } from "../services/standardPlugin.js";

const router = express.Router();

const safeEqual = (a, b) => {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

const readJsonBody = (req) => {
  const text = typeof req.body === "string" ? req.body : "";
  try {
    return { body: JSON.parse(text || "{}") };
  } catch {
    return { error: true };
  }
};

const asDate = (v) => {
  const d = v ? new Date(v) : null;
  return d && !Number.isNaN(d.getTime()) ? d : null;
};

const scanKey = (ref, label, at) => (ref ? `ref:${ref}` : `${normaliseLabel(label)}|${at.getTime()}`);

async function handleStandardWebhook(req, res, sp) {
  const parsed = readJsonBody(req);
  const body = parsed.body;
  if (parsed.error || !body || typeof body !== "object" || Array.isArray(body)) {
    return res.status(400).json({ success: false, message: "The request body must be valid JSON." });
  }

  const eventType = String(body.event_type ?? "TRACKING_UPDATED").trim().toUpperCase();
  if (eventType !== "TRACKING_UPDATED") return res.json({ success: true, ignored: "event_type not supported" });

  const awb = String(body.awb ?? "").trim();
  if (!awb) return res.status(400).json({ success: false, message: "awb is required." });

  const label = String(body.last_tracking_status ?? body.status ?? "").trim();
  const logs = Array.isArray(body.tracking_logs) ? body.tracking_logs.filter((l) => l && typeof l === "object") : [];
  if (!label && logs.length === 0) {
    return res.status(400).json({ success: false, message: "last_tracking_status or tracking_logs is required." });
  }

  const shipment = await Shipment.findOne({ store_plugin_id: sp._id, awb_number: awb });
  if (!shipment) return res.json({ success: true, ignored: "unknown awb" });


  const now = new Date();
  let scans = logs.map((l) => {
    const remark = String(l.remark ?? "").trim();
    const location = String(l.location ?? "").trim();
    return {
      status: String(l.scan ?? "").trim() || label || "Update",
      note: [remark, location && `(${location})`].filter(Boolean).join(" "),
      remark,
      location,
      at: asDate(l.scan_date_time) || now,
      ref: String(l._id ?? "").trim(),
    };
  });
  if (scans.length === 0) scans = [{ status: label, note: "", remark: "", location: "", at: now, ref: "" }]; 
  scans.sort((a, b) => a.at - b.at);


  const have = new Set(shipment.events.map((e) => scanKey(e.ref, e.status, new Date(e.at))));
  const fresh = scans.filter((e) => {
    const key = scanKey(e.ref, e.status, e.at);
    if (have.has(key)) return false;
    have.add(key);
    return true;
  });
  if (fresh.length === 0) return res.json({ success: true, ignored: "duplicate" });
  shipment.events.push(...fresh);


  let st = mapStandardStatus(label);
  if (!st.known) st = mapStandardStatus(scans[scans.length - 1].status);
  if (!st.known && (body.order_status_id ?? body.status_id) != null) st = mapStandardStatus(String(body.order_status_id ?? body.status_id));

  if (st.value && !FINAL_SHIPMENT_STATUSES.includes(shipment.status)) shipment.status = st.value;

  // Track every courier status by its id and name, even the ones that do not change the order status.
  const rawId = body.order_status_id ?? body.status_id;
  const current = {
    id: String(st.id ?? rawId ?? ""),
    name: st.known ? st.label : label || scans[scans.length - 1].status,
    label: st.known ? st.track : label || scans[scans.length - 1].status,
    description: st.description || "",
    at: scans[scans.length - 1].at,
  };
  const prev = shipment.status_history[shipment.status_history.length - 1];
  if (current.name && (!prev || prev.name !== current.name)) shipment.status_history.push(current);
  if (current.name && (!shipment.courier_status || new Date(current.at) >= new Date(shipment.courier_status.at || 0))) {
    shipment.courier_status = current;
  }

  await shipment.save();
  await syncOrderFromShipments(shipment.order_id);

  res.json({ success: true, message: "Tracking updated." });
}


router.post("/:storePluginId/:secret", async (req, res) => {
  try {
    const sp = await StorePlugin.findById(req.params.storePluginId).catch(() => null);
    if (!sp || !safeEqual(sp.webhook_secret, req.params.secret)) {
      return res.status(401).json({ ok: false, success: false, message: "Invalid webhook URL." });
    }

    const plugin = await Plugin.findById(sp.plugin_id);
    if (plugin?.integration === "standard") {
      try {
        return await handleStandardWebhook(req, res, sp);
      } catch (err) {
        console.error("Standard plugin webhook error:", err);
        return res.status(500).json({ success: false, message: "Something went wrong on our side. Please retry." });
      }
    }
    const api = plugin?.apis.find((a) => a.api_type === "tracking");
    if (!plugin || !api) return res.json({ ok: true, ignored: "no tracking mapping" });


    let body = {};
    const text = typeof req.body === "string" ? req.body : "";
    if (api.response_type === "xml") {
      const { XMLParser } = await import("fast-xml-parser");
      body = new XMLParser({ ignoreAttributes: false }).parse(text);
    } else {
      try {
        body = JSON.parse(text || "{}");
      } catch {
        return res.json({ ok: true, ignored: "unreadable body" });
      }
    }

    const map = { ...(api.response_mapping || {}), ...(api.webhook_mapping || {}) };
    const awb = getPath(body, map.awb);
    const courierStatus = getPath(body, map.status);
    if (!awb) return res.json({ ok: true, ignored: "no awb" });

    const shipment = await Shipment.findOne({ store_plugin_id: sp._id, awb_number: String(awb) });
    if (!shipment) return res.json({ ok: true, ignored: "unknown awb" });

    shipment.events.push({
      status: String(courierStatus ?? "update"),
      note: String(getPath(body, map.note) ?? ""),
      at: getPath(body, map.at) ? new Date(getPath(body, map.at)) : new Date(),
    });
    const mapped = mapCourierStatus(courierStatus);
    if (mapped) shipment.status = mapped;
    await shipment.save();
    await syncOrderFromShipments(shipment.order_id);

    res.json({ ok: true });
  } catch (err) {
    console.error("Plugin webhook error:", err);
    res.json({ ok: false });
  }
});

export default router;
