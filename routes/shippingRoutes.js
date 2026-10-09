import express from "express";
import mongoose from "mongoose";
import { StatusCodes } from "http-status-codes";
import { requireSellerAuth } from "../middleware/auth.js";
import Order from "../models/Order.js";
import Warehouse from "../models/Warehouse.js";
import Plugin from "../models/Plugin.js";
import { isSellerVisible } from "../services/pluginReview.js";
import StorePlugin from "../models/StorePlugin.js";
import Shipment from "../models/Shipment.js";
import { buildShipmentContext } from "../services/shippingContext.js";
import {
  callPluginApi,
  isReady,
  missingRequired,
  normalizeEvents,
  normalizeRates,
  mapCourierStatus,
  PluginApiError,
  route,
} from "../services/pluginEngine.js";
import { syncOrderFromShipments } from "../services/shipmentSync.js";
import { ensureCourierWarehouse } from "../services/courierWarehouse.js";
import { ensureWebhookRegistered, trackingWebhookUrl } from "../services/courierWebhook.js";

const router = express.Router();
router.use(requireSellerAuth);

const bad = (res, msg, code = StatusCodes.BAD_REQUEST) => res.status(code).json({ error: msg });
const SHIPPABLE = ["pending", "confirmed", "packed", "shipped"];

async function loadOrder(req, res) {
  if (!mongoose.isValidObjectId(req.params.orderId)) {
    bad(res, "Order not found.", StatusCodes.NOT_FOUND);
    return null;
  }
  const order = await Order.findOne({ _id: req.params.orderId, seller_id: req.user.id });
  if (!order) bad(res, "Order not found.", StatusCodes.NOT_FOUND);
  return order;
}

async function loadReadyPlugin(req, res, storePluginId) {
  if (!mongoose.isValidObjectId(storePluginId)) {
    bad(res, "Please choose a shipping plugin.");
    return null;
  }
  const storePlugin = await StorePlugin.findOne({ _id: storePluginId, seller_id: req.user.id });
  const plugin = storePlugin && (await Plugin.findById(storePlugin.plugin_id));
  if (!storePlugin || !plugin) {
    bad(res, "Shipping plugin not found.", StatusCodes.NOT_FOUND);
    return null;
  }
  if (!isSellerVisible(plugin)) {
    res.status(StatusCodes.CONFLICT).json({
      error: "This courier plugin is not available right now. It may be under review.",
      code: "PLUGIN_UNAVAILABLE",
    });
    return null;
  }
  if (!isReady(plugin, storePlugin)) {
    res.status(StatusCodes.CONFLICT).json({
      error: "This plugin isn't ready. Finish its setup first.",
      code: "PLUGIN_NOT_READY",
      missing: missingRequired(plugin, storePlugin),
    });
    return null;
  }
  return { plugin, storePlugin };
}

async function pickWarehouse(order, warehouseId) {
  const ids = (order.pickup_warehouse_ids || []).map(String);
  const id = warehouseId ? String(warehouseId) : ids[0];
  if (!id || !ids.includes(id)) return null;
  return Warehouse.findById(id);
}


router.get("/:orderId/options", route(async (req, res) => {
  const order = await loadOrder(req, res);
  if (!order) return;

  const [storePlugins, warehouses, shipments] = await Promise.all([
    StorePlugin.find({ seller_id: req.user.id, status: "active" }),
    Warehouse.find({ _id: { $in: order.pickup_warehouse_ids || [] } }).select("name code address contact_phone"),
    Shipment.find({ order_id: order._id, is_active: true }).select("warehouse_id awb_number courier_name status tracking_url"),
  ]);
  const plugins = await Plugin.find({ _id: { $in: storePlugins.map((s) => s.plugin_id) } });
  const pById = new Map(plugins.map((p) => [String(p._id), p]));

  const options = storePlugins
    .map((sp) => ({ sp, p: pById.get(String(sp.plugin_id)) }))
    .filter(({ p }) => isSellerVisible(p))
    .map(({ sp, p }) => ({
      store_plugin_id: sp._id,
      app_name: p.app_name,
      logo: p.logo,
      environment: sp.environment,
      ready: isReady(p, sp),
      missing: missingRequired(p, sp),
      can_rate: p.adapter_key ? true : p.apis.some((a) => ["get_rating", "order_rate"].includes(a.api_type)),
    }));

  res.json({
    can_ship: SHIPPABLE.includes(order.status) && ["paid", "cod_pending"].includes(order.payment_status),
    plugins: options,
    warehouses,
    shipments,
    redirect_to_plugins: !options.some((o) => o.ready),
  });
}));


router.post("/:orderId/rates", route(async (req, res) => {
  const order = await loadOrder(req, res);
  if (!order) return;
  const found = await loadReadyPlugin(req, res, req.body.store_plugin_id);
  if (!found) return;
  const warehouse = await pickWarehouse(order, req.body.warehouse_id);
  if (!warehouse) return bad(res, "Pickup warehouse not found for this order.");

  let context;
  try {
    context = await buildShipmentContext(order, warehouse);
  } catch (err) {
    return bad(res, err.message, err.status || 400);
  }

  const { plugin, storePlugin } = found;
  context.courier_warehouse_id = await ensureCourierWarehouse({ plugin, storePlugin, warehouse, context });
  const apiType = plugin.adapter_key || plugin.apis.some((a) => a.api_type === "get_rating") ? "get_rating" : "order_rate";
  const { raw, api, mapped } = await callPluginApi({ plugin, storePlugin, apiType, context });

  const rates = api ? normalizeRates(raw, api) : mapped.rates || [];
  res.json({
    warehouse_id: warehouse._id,
    package: context.package,
    rates: rates.map(({ _raw, ...r }) => r),
  });
}));


router.post("/:orderId/ship", route(async (req, res) => {
  const order = await loadOrder(req, res);
  if (!order) return;
  if (!SHIPPABLE.includes(order.status)) return bad(res, `A ${order.status} order can't be shipped.`);
  if (!["paid", "cod_pending"].includes(order.payment_status)) return bad(res, "Payment isn't complete for this order yet.");

  const found = await loadReadyPlugin(req, res, req.body.store_plugin_id);
  if (!found) return;
  const warehouse = await pickWarehouse(order, req.body.warehouse_id);
  if (!warehouse) return bad(res, "Pickup warehouse not found for this order.");

  const already = await Shipment.findOne({ order_id: order._id, warehouse_id: warehouse._id, is_active: true });
  if (already) return bad(res, "A shipment already exists for this pickup warehouse.", StatusCodes.CONFLICT);

  let context;
  try {
    context = await buildShipmentContext(order, warehouse);
  } catch (err) {
    return bad(res, err.message, err.status || 400);
  }

  const { plugin, storePlugin } = found;
  const rate = req.body.rate || {};
  const webhook_url = trackingWebhookUrl(req, storePlugin);


  await ensureWebhookRegistered({ plugin, storePlugin, url: webhook_url }).catch((e) =>
    console.error(`Could not register tracking webhook with ${plugin.app_name}:`, e.message)
  );
  context.courier_warehouse_id = await ensureCourierWarehouse({ plugin, storePlugin, warehouse, context });

  const { raw, mapped } = await callPluginApi({
    plugin,
    storePlugin,
    apiType: "order_create",
    context: { ...context, rate, webhook_url },
  });

  if (!mapped.awb) {
    throw new PluginApiError(`${plugin.app_name} did not return an AWB number.`, { details: JSON.stringify(raw).slice(0, 300) });
  }

  const shipment = await Shipment.create({
    order_id: order._id,
    seller_id: order.seller_id,
    store_plugin_id: storePlugin._id,
    plugin_id: plugin._id,
    warehouse_id: warehouse._id,
    courier_name: String(mapped.courier_name || rate.name || plugin.app_name),
    awb_number: String(mapped.awb),
    tracking_url: mapped.tracking_url || null,
    label_url: mapped.label_url || null,
    rate_charged: Number(rate.charge) || 0,
    estimated_delivery: mapped.estimated_delivery ? new Date(mapped.estimated_delivery) : null,
    events: [{ status: "created", note: `Shipment created with ${plugin.app_name}`, at: new Date() }],
    raw_response: raw,
  });

  order.set("shipment.courier_partner", plugin.slug);
  order.set("shipment.plugin_id", plugin._id);
  order.set("shipment.awb_number", shipment.awb_number);
  order.set("shipment.tracking_url", shipment.tracking_url);
  order.set("shipment.estimated_delivery", shipment.estimated_delivery);
  if (["pending", "confirmed"].includes(order.status)) {
    order.status = "packed";
  }
  order.status_history.push({
    status: order.status,
    note: `Shipment created via ${plugin.app_name} · AWB ${shipment.awb_number}`,
  });
  await order.save();

  res.status(StatusCodes.CREATED).json(shipment);
}));


router.post("/shipment/:shipmentId/track", route(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.shipmentId)) return bad(res, "Shipment not found.", StatusCodes.NOT_FOUND);
  const shipment = await Shipment.findOne({ _id: req.params.shipmentId, seller_id: req.user.id });
  if (!shipment) return bad(res, "Shipment not found.", StatusCodes.NOT_FOUND);

  const [storePlugin, plugin] = await Promise.all([
    StorePlugin.findById(shipment.store_plugin_id),
    Plugin.findById(shipment.plugin_id),
  ]);
  if (!storePlugin || !plugin) return bad(res, "The plugin for this shipment was removed.", StatusCodes.CONFLICT);
  if (!isSellerVisible(plugin)) return bad(res, "This courier plugin is under review right now, so tracking can't be refreshed yet.", StatusCodes.CONFLICT);


  if (!plugin.adapter_key && !plugin.apis.some((a) => a.api_type === "tracking")) return res.json(shipment);

  const { raw, api, mapped } = await callPluginApi({
    plugin,
    storePlugin,
    apiType: "tracking",
    context: { awb: shipment.awb_number },
  });

  const events = api ? normalizeEvents(raw, api) : mapped.events || [];
  const known = new Set(shipment.events.map((e) => `${e.status}|${new Date(e.at).getTime()}`));
  for (const e of events) {
    if (!known.has(`${e.status}|${new Date(e.at).getTime()}`)) shipment.events.push(e);
  }
  const latest = mapCourierStatus(mapped.status || events[events.length - 1]?.status);
  if (latest) shipment.status = latest;
  await shipment.save();
  await syncOrderFromShipments(shipment.order_id);

  res.json(shipment);
}));


router.get("/:orderId/shipments", route(async (req, res) => {
  const order = await loadOrder(req, res);
  if (!order) return;
  res.json(await Shipment.find({ order_id: order._id }).select("-raw_response").sort({ created_at: -1 }));
}));

export default router;
