import express from "express";
import mongoose from "mongoose";
import { StatusCodes } from "http-status-codes";
import Order from "../models/Order.js";
import AbandonedCheckout from "../models/AbandonedCheckout.js";
import VisitLog from "../models/VisitLog.js";
import Transaction from "../models/Transaction.js";
import Seller from "../models/Seller.js";
import Customer from "../models/Customer.js";
import Product from "../models/Product.js";
import Warehouse from "../models/Warehouse.js";
import { moveOrderToWarehouse } from "../utils/warehouseAllocator.js";
import { requireSellerAuth } from "../middleware/auth.js";

const router = express.Router();
router.use(requireSellerAuth);

router.get("/orders", async (req, res) => {
  const { status } = req.query;

  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
  const filter = { seller_id: req.user.id, is_active: true };
  if (status) filter.status = status;

  const q = String(req.query.q || "").trim().slice(0, 60);
  if (q) {
    const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    filter.$or = [
      { tracking_token: rx },
      { "shipping_address.name": rx },
      { "shipping_address.phone": rx },
      { "shipping_address.city": rx },
      { "items.name": rx },
      { payment_method: rx },
      { payment_status: rx },
    ];
  }

  const skip = (page - 1) * limit;
  const [orders, total] = await Promise.all([
    Order.find(filter).sort({ created_at: -1 }).skip(skip).limit(limit),
    Order.countDocuments(filter),
  ]);
  res.json({ orders, total, page, limit });
});


const VOLUMETRIC_DIVISOR = 5000;
const round3 = (n) => Math.round(n * 1000) / 1000;

router.get("/orders/:id", async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) {
    return res.status(StatusCodes.NOT_FOUND).json({ error: "We couldn't find that order. Please check and try again." });
  }

  const order = await Order.findOne({ _id: req.params.id, seller_id: req.user.id, is_active: true })
    .populate("customer_id", "name phone email")
    .lean();
  if (!order) return res.status(StatusCodes.NOT_FOUND).json({ error: "We couldn't find that order. Please check and try again." });

  const productIds = (order.items || []).map((i) => i.product_id);
  const [seller, products] = await Promise.all([
    Seller.findById(req.user.id).select("name store_slug").lean(),
    Product.find({ _id: { $in: productIds }, seller_id: req.user.id })
      .select("sku images weight_kg length_cm width_cm height_cm warehouse_stock combinations._id combinations.sku")
      .lean(),
  ]);
  const productById = new Map(products.map((p) => [String(p._id), p]));

  let physical = 0;
  let volumetric = 0;
  const lineItems = (order.items || []).map((item) => {
    const p = productById.get(String(item.product_id));
    const combo =
      item.combination_id && p
        ? (p.combinations || []).find((c) => String(c._id) === String(item.combination_id))
        : null;

    const w = Number(p?.weight_kg);
    const l = Number(p?.length_cm);
    const wd = Number(p?.width_cm);
    const h = Number(p?.height_cm);
    const hasDims = l > 0 && wd > 0 && h > 0;
    if (w > 0) physical += w * item.quantity;
    if (hasDims) volumetric += ((l * wd * h) / VOLUMETRIC_DIVISOR) * item.quantity;

    return {
      product_id: item.product_id,
      name: item.name,
      variant_label: item.variant_label || "",
      sku: combo?.sku || p?.sku || null,
      image: p?.images?.[0] || null,
      quantity: item.quantity,
      unit_price: item.price,
      discount_amount: item.discount_amount || 0,
      tax_amount: item.tax_amount || 0,
      total: item.price * item.quantity - (item.discount_amount || 0) + (item.tax_amount || 0),
      dimensions_cm: hasDims ? { l, w: wd, h } : null,
    };
  });


  let pickupWarehouses = [];
  if (order.pickup_warehouse_ids?.length) {
    pickupWarehouses = await Warehouse.find({ _id: { $in: order.pickup_warehouse_ids }, seller_id: req.user.id })
      .select("name code address contact_phone is_active")
      .lean();
  } else {
    const warehouseIds = [
      ...new Set(
        products.flatMap((p) => (p.warehouse_stock || []).filter((s) => s.qty > 0).map((s) => String(s.warehouse_id)))
      ),
    ];
    pickupWarehouses = warehouseIds.length
      ? await Warehouse.find({ _id: { $in: warehouseIds }, seller_id: req.user.id }).select("name code address contact_phone").lean()
      : [];
  }
  if (!pickupWarehouses.length) {
    const fallback = await Warehouse.findOne({ seller_id: req.user.id, is_active: true })
      .sort({ created_at: 1 })
      .select("name code address contact_phone")
      .lean();
    if (fallback) pickupWarehouses = [fallback];
  }


  let paidAt = order.paid_at || null;
  if (!paidAt && order.payment_status === "paid") {
    const ev = (order.status_history || []).find((e) => /^payment/i.test(e.note || ""));
    paidAt = ev?.at || null;
  }

  const customer = order.customer_id && order.customer_id._id ? order.customer_id : null;

  res.json({
    order: { ...order, customer_id: customer?._id || null, paid_at: paidAt },
    customer,
    store: { name: seller?.name || "", slug: seller?.store_slug || "" },
    line_items: lineItems,
    package: {
      physical_weight_kg: physical > 0 ? round3(physical) : null,
      volumetric_weight_kg: volumetric > 0 ? round3(volumetric) : null,
      chargeable_weight_kg: physical > 0 || volumetric > 0 ? round3(Math.max(physical, volumetric)) : null,
    },
    pickup_warehouses: pickupWarehouses,
  });
});



router.put("/orders/:id/pickup-warehouse", async (req, res) => {
  try {
    const { warehouse_id } = req.body;
    if (!mongoose.isValidObjectId(req.params.id) || !mongoose.isValidObjectId(warehouse_id)) {
      return res.status(StatusCodes.BAD_REQUEST).json({ error: "Please choose a valid order and warehouse." });
    }

    const [order, warehouse] = await Promise.all([
      Order.findOne({ _id: req.params.id, seller_id: req.user.id, is_active: true }),
      Warehouse.findOne({ _id: warehouse_id, seller_id: req.user.id, is_active: true }),
    ]);
    if (!order) return res.status(StatusCodes.NOT_FOUND).json({ error: "We couldn't find that order. Please check and try again." });
    if (!warehouse) return res.status(StatusCodes.NOT_FOUND).json({ error: "That warehouse doesn't exist or is switched off." });

    if (!["pending", "confirmed", "packed"].includes(order.status)) {
      return res
        .status(StatusCodes.CONFLICT)
        .json({ error: "Pickup warehouse can only be changed before the order is shipped." });
    }

    const result = await moveOrderToWarehouse(order, warehouse._id);
    if (!result.ok) return res.status(StatusCodes.CONFLICT).json({ error: result.error });

    order.status_history.push({ status: order.status, note: `Pickup warehouse changed to ${warehouse.name}` });
    await order.save();
    res.json({ ok: true, pickup_warehouses: [warehouse] });
  } catch (err) {
    console.error(err);
    res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({ error: "We couldn't change the pickup warehouse. Please try again." });
  }
});

router.put("/orders/:id/status", async (req, res) => {
  const { status, note } = req.body;
  const order = await Order.findOneAndUpdate(
    { _id: req.params.id, seller_id: req.user.id },
    {
      $set: { status },
      $push: { status_history: { status, note: note || "" } },
    },
    { new: true }
  );
  if (!order) return res.status(StatusCodes.NOT_FOUND).json({ error: "We couldn't find that order. Please check and try again." });

  if (status === "delivered" && order.payment_method === "cod") {
    const alreadyLogged = await Transaction.exists({ order_id: order._id, type: "cod_collected" });
    if (!alreadyLogged) {
      await Transaction.create({
        seller_id: order.seller_id,
        order_id: order._id,
        type: "cod_collected",
        order_total: order.total_amount,
        platform_fee: 0,
        seller_amount: order.total_amount,
        note: "Cash collected on delivery",
      });
    }
  }

  res.json(order);
});

router.put("/orders/:id/shipment", async (req, res) => {
  const { type, courier_partner, awb_number, tracking_url, estimated_delivery } = req.body;

  const update = {};
  if (type) {
    if (!["standard", "express", "self_pickup"].includes(type)) {
      return res.status(StatusCodes.BAD_REQUEST).json({ error: "Please choose a valid shipment type." });
    }
    update["shipment.type"] = type;
  }
  if (courier_partner !== undefined) update["shipment.courier_partner"] = courier_partner;
  if (awb_number !== undefined) update["shipment.awb_number"] = awb_number;
  if (tracking_url !== undefined) update["shipment.tracking_url"] = tracking_url;
  if (estimated_delivery !== undefined) update["shipment.estimated_delivery"] = estimated_delivery;

  const order = await Order.findOneAndUpdate(
    { _id: req.params.id, seller_id: req.user.id },
    { $set: update },
    { new: true }
  );
  if (!order) return res.status(StatusCodes.NOT_FOUND).json({ error: "We couldn't find that order. Please check and try again." });
  res.json(order);
});

router.get("/analytics/revenue", async (req, res) => {
  const sellerId = new mongoose.Types.ObjectId(req.user.id);
  const from = req.query.from ? new Date(req.query.from) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const to = req.query.to ? new Date(req.query.to) : new Date();

  const pipeline = [
    {
      $match: {
        seller_id: sellerId,
        created_at: { $gte: from, $lte: to },
        payment_status: { $in: ["paid", "cod_pending"] },
        status: { $ne: "cancelled" },
      },
    },
    {
      $group: {
        _id: { $dateToString: { format: "%Y-%m-%d", date: "$created_at" } },
        revenue: { $sum: "$total_amount" },
        order_count: { $sum: 1 },
      },
    },
    { $sort: { _id: 1 } },
    { $project: { _id: 0, date: "$_id", revenue: 1, order_count: 1 } },
  ];

  const daily = await Order.aggregate(pipeline);
  const totals = daily.reduce(
    (acc, d) => ({ revenue: acc.revenue + d.revenue, order_count: acc.order_count + d.order_count }),
    { revenue: 0, order_count: 0 }
  );

  res.json({ from, to, daily, totals });
});


router.get("/analytics/top-products", async (req, res) => {
  const sellerId = new mongoose.Types.ObjectId(req.user.id);
  const limit = Number(req.query.limit) || 10;

  const pipeline = [
    { $match: { seller_id: sellerId, payment_status: { $in: ["paid", "cod_pending"] } } },
    { $unwind: "$items" },
    {
      $group: {
        _id: "$items.product_id",
        name: { $first: "$items.name" },
        units_sold: { $sum: "$items.quantity" },
        revenue: { $sum: { $multiply: ["$items.price", "$items.quantity"] } },
      },
    },
    { $sort: { revenue: -1 } },
    { $limit: limit },
    {
      $lookup: {
        from: "products",
        localField: "_id",
        foreignField: "_id",
        as: "product",
      },
    },
    {
      $project: {
        _id: 0,
        product_id: "$_id",
        name: 1,
        units_sold: 1,
        revenue: 1,
        current_stock: { $arrayElemAt: ["$product.stock_qty", 0] },
      },
    },
  ];

  const topProducts = await Order.aggregate(pipeline);
  res.json(topProducts);
});

router.get("/analytics/conversion", async (req, res) => {
  const sellerId = new mongoose.Types.ObjectId(req.user.id);
  const from = req.query.from ? new Date(req.query.from) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const to = req.query.to ? new Date(req.query.to) : new Date();

  const [totalVisits, totalOrders] = await Promise.all([
    VisitLog.countDocuments({ seller_id: sellerId, created_at: { $gte: from, $lte: to } }),
    Order.countDocuments({ seller_id: sellerId, created_at: { $gte: from, $lte: to }, is_active: true }),
  ]);

  const conversion_rate = totalVisits > 0 ? Number(((totalOrders / totalVisits) * 100).toFixed(2)) : 0;

  res.json({ from, to, total_visits: totalVisits, total_orders: totalOrders, conversion_rate });
});

router.get("/analytics/abandoned", async (req, res) => {
  const sellerId = new mongoose.Types.ObjectId(req.user.id);

  const [entries, funnel] = await Promise.all([
    AbandonedCheckout.find({ seller_id: sellerId, recovered: false }).sort({ created_at: -1 }).limit(50),
    AbandonedCheckout.aggregate([
      { $match: { seller_id: sellerId } },
      { $group: { _id: "$step_reached", count: { $sum: 1 }, total_value: { $sum: "$cart_value" } } },
      { $sort: { count: -1 } },
    ]),
  ]);

  res.json({ entries, funnel });
});

export default router;
