import express from "express";
import { StatusCodes } from "http-status-codes";
import Warehouse from "../models/Warehouse.js";
import Product from "../models/Product.js";
import { requireSellerAuth, requireKycApproved } from "../middleware/auth.js";
import { sendError, check } from "../utils/validation.js";
import { coordsForPincode } from "../utils/warehouseAllocator.js";

const router = express.Router();

function resolveLocation(location, address) {
  const blank = (v) => v === undefined || v === null || v === "";
  const lat = blank(location?.lat) ? NaN : Number(location.lat);
  const lng = blank(location?.lng) ? NaN : Number(location.lng);
  if (Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) {
    return { lat, lng };
  }
  return coordsForPincode(address?.pincode) || { lat: null, lng: null };
}


router.get("/", requireSellerAuth, async (req, res) => {
  try {
    const warehouses = await Warehouse.find({ seller_id: req.user.id }).sort({ is_active: -1, created_at: -1 });
    res.json(warehouses);
  } catch (err) {
    sendError(res, err);
  }
});

router.get("/:id", requireSellerAuth, async (req, res) => {
  try {
    const warehouse = await Warehouse.findOne({ _id: req.params.id, seller_id: req.user.id });
    if (!warehouse) return res.status(StatusCodes.NOT_FOUND).json({ error: "We couldn't find that warehouse." });
    res.json(warehouse);
  } catch (err) {
    sendError(res, err);
  }
});

router.post("/", requireSellerAuth, requireKycApproved, async (req, res) => {
  try {
    const { name, code, address, contact_phone, location, priority } = req.body;
    check.required(name, "a warehouse name");
    check.phone(contact_phone);

    const existing = await Warehouse.findOne({
      seller_id: req.user.id,
      name: String(name).trim(),
    }).collation({ locale: "en", strength: 2 });
    if (existing) {
      return res.status(StatusCodes.CONFLICT).json({
        error: `You already have a warehouse named "${existing.name}" — please choose a different name.`,
      });
    }

    const warehouse = await Warehouse.create({
      seller_id: req.user.id,
      name: String(name).trim(),
      code: code ? String(code).trim() : "",
      address: address || {},
      location: resolveLocation(location, address),
      priority: Number(priority) || 0,
      contact_phone: String(contact_phone).trim(),
    });
    res.status(StatusCodes.CREATED).json(warehouse);
  } catch (err) {
    sendError(res, err);
  }
});

router.put("/:id", requireSellerAuth, requireKycApproved, async (req, res) => {
  try {
    const { name, code, address, contact_phone, location, priority } = req.body;
    if (name !== undefined) check.required(name, "a warehouse name");
    if (contact_phone !== undefined) check.phone(contact_phone);

    if (name !== undefined) {
      const existing = await Warehouse.findOne({
        seller_id: req.user.id,
        _id: { $ne: req.params.id },
        name: String(name).trim(),
      }).collation({ locale: "en", strength: 2 });
      if (existing) {
        return res.status(StatusCodes.CONFLICT).json({
          error: `You already have a warehouse named "${existing.name}" — please choose a different name.`,
        });
      }
    }

    const update = {};
    if (name !== undefined) update.name = String(name).trim();
    if (code !== undefined) update.code = String(code || "").trim();
    if (address !== undefined) update.address = address;
    if (address !== undefined || location !== undefined) update.location = resolveLocation(location, address);
    if (priority !== undefined) update.priority = Number(priority) || 0;
    if (contact_phone !== undefined) update.contact_phone = String(contact_phone).trim();

    const warehouse = await Warehouse.findOneAndUpdate(
      { _id: req.params.id, seller_id: req.user.id },
      { $set: update },
      { new: true, runValidators: true }
    );
    if (!warehouse) return res.status(StatusCodes.NOT_FOUND).json({ error: "We couldn't find that warehouse." });
    res.json(warehouse);
  } catch (err) {
    sendError(res, err);
  }
});


router.patch("/:id/status", requireSellerAuth, async (req, res) => {
  try {
    const isActive = !!req.body.is_active;


    if (!isActive && req.body.force !== true) {
      const stocked = await Product.countDocuments({
        seller_id: req.user.id,
        warehouse_stock: { $elemMatch: { warehouse_id: req.params.id, qty: { $gt: 0 } } },
      });
      if (stocked > 0) {
        return res.status(StatusCodes.CONFLICT).json({
          error: `${stocked} product(s) still have stock here. Transfer it to another warehouse first, or deactivate anyway.`,
          products_with_stock: stocked,
        });
      }
    }
    const warehouse = await Warehouse.findOneAndUpdate(
      { _id: req.params.id, seller_id: req.user.id },
      { $set: { is_active: isActive } },
      { new: true }
    );
    if (!warehouse) return res.status(StatusCodes.NOT_FOUND).json({ error: "We couldn't find that warehouse." });
    res.json(warehouse);
  } catch (err) {
    sendError(res, err);
  }
});



router.post("/transfer", requireSellerAuth, async (req, res) => {
  try {
    const { product_id, from_warehouse_id, to_warehouse_id } = req.body;
    const qty = Number(req.body.qty);
    if (!Number.isInteger(qty) || qty <= 0) {
      return res.status(StatusCodes.BAD_REQUEST).json({ error: "Quantity must be a whole number above 0." });
    }
    if (String(from_warehouse_id) === String(to_warehouse_id)) {
      return res.status(StatusCodes.BAD_REQUEST).json({ error: "Please choose two different warehouses." });
    }

    const owned = await Warehouse.countDocuments({
      seller_id: req.user.id,
      _id: { $in: [from_warehouse_id, to_warehouse_id] },
    });
    if (owned !== 2) return res.status(StatusCodes.NOT_FOUND).json({ error: "We couldn't find that warehouse." });

    const take = await Product.updateOne(
      {
        _id: product_id,
        seller_id: req.user.id,
        warehouse_stock: { $elemMatch: { warehouse_id: from_warehouse_id, qty: { $gte: qty } } },
      },
      { $inc: { "warehouse_stock.$[f].qty": -qty } },
      { arrayFilters: [{ "f.warehouse_id": from_warehouse_id }] }
    );
    if (take.modifiedCount !== 1) {
      return res.status(StatusCodes.CONFLICT).json({ error: "The warehouse you are moving stock from doesn't have enough units." });
    }

    const add = await Product.updateOne(
      { _id: product_id, "warehouse_stock.warehouse_id": to_warehouse_id },
      { $inc: { "warehouse_stock.$.qty": qty } }
    );
    if (add.modifiedCount !== 1) {

      await Product.updateOne(
        { _id: product_id },
        { $push: { warehouse_stock: { warehouse_id: to_warehouse_id, qty } } }
      );
    }
    res.json({ ok: true });
  } catch (err) {
    sendError(res, err);
  }
});

router.get("/:id/usage", requireSellerAuth, async (req, res) => {
  try {
    const count = await Product.countDocuments({
      seller_id: req.user.id,
      "warehouse_stock.warehouse_id": req.params.id,
    });
    res.json({ product_count: count });
  } catch (err) {
    sendError(res, err);
  }
});

export default router;
