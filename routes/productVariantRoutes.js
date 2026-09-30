import express from "express";
import { StatusCodes } from "http-status-codes";
import ProductVariant from "../models/ProductVariant.js";
import { requireSellerAuth, requireKycApproved } from "../middleware/auth.js";
import { sendError } from "../utils/validation.js";

const router = express.Router();

router.use(requireSellerAuth);


router.get("/", async (req, res) => {
  try {
    const variants = await ProductVariant.find({ seller_id: req.user.id }).sort({ created_at: -1 });
    res.json(variants);
  } catch (err) {
    sendError(res, err);
  }
});

router.get("/active", async (req, res) => {
  try {
    const variants = await ProductVariant.find({ seller_id: req.user.id, is_active: true }).sort({ name: 1 });
    const usable = variants
      .map((v) => ({
        _id: v._id,
        name: v.name,
        options: v.options.filter((o) => o.is_active),
      }))
      .filter((v) => v.options.length > 0);
    res.json(usable);
  } catch (err) {
    sendError(res, err);
  }
});

router.get("/:id", async (req, res) => {
  try {
    const variant = await ProductVariant.findOne({ _id: req.params.id, seller_id: req.user.id });
    if (!variant) return res.status(StatusCodes.NOT_FOUND).json({ error: "We couldn't find that variant — it may have already been removed." });
    res.json(variant);
  } catch (err) {
    sendError(res, err);
  }
});

router.post("/", requireKycApproved, async (req, res) => {
  try {
    const { name, options } = req.body;
    const cleanOptions = (options || [])
      .map((o) => ({ value: String(o.value || "").trim(), image_url: o.image_url || "", is_active: o.is_active !== false }))
      .filter((o) => o.value);

    if (!name || !String(name).trim()) {
      return res.status(StatusCodes.BAD_REQUEST).json({ error: "Please enter a name for this variant (e.g. Size, Color)." });
    }
    if (cleanOptions.length === 0) {
      return res.status(StatusCodes.BAD_REQUEST).json({ error: "Please add at least one option (e.g. Small, Medium, Large)." });
    }

    const variant = await ProductVariant.create({
      seller_id: req.user.id,
      name: name.trim(),
      options: cleanOptions,
    });
    res.status(StatusCodes.CREATED).json(variant);
  } catch (err) {
    if (err.code === 11000) {
      return res.status(StatusCodes.CONFLICT).json({ error: "You already have a variant with this name." });
    }
    sendError(res, err);
  }
});

router.put("/:id", requireKycApproved, async (req, res) => {
  try {
    const { name, options, is_active } = req.body;
    const update = {};
    if (name !== undefined) {
      if (!String(name).trim()) {
        return res.status(StatusCodes.BAD_REQUEST).json({ error: "Please enter a name for this variant (e.g. Size, Color)." });
      }
      update.name = name.trim();
    }
    if (is_active !== undefined) update.is_active = is_active;
    if (options !== undefined) {
      const cleanOptions = options
        .map((o) => ({ value: String(o.value || "").trim(), image_url: o.image_url || "", is_active: o.is_active !== false }))
        .filter((o) => o.value);
      if (cleanOptions.length === 0) {
        return res.status(StatusCodes.BAD_REQUEST).json({ error: "Please add at least one option (e.g. Small, Medium, Large)." });
      }
      update.options = cleanOptions;
    }

    const variant = await ProductVariant.findOneAndUpdate(
      { _id: req.params.id, seller_id: req.user.id },
      { $set: update },
      { new: true, runValidators: true }
    );
    if (!variant) return res.status(StatusCodes.NOT_FOUND).json({ error: "We couldn't find that variant — it may have already been removed." });
    res.json(variant);
  } catch (err) {
    if (err.code === 11000) {
      return res.status(StatusCodes.CONFLICT).json({ error: "You already have a variant with this name." });
    }
    sendError(res, err);
  }
});

router.delete("/:id", async (req, res) => {
  try {
    const variant = await ProductVariant.findOneAndDelete({ _id: req.params.id, seller_id: req.user.id });
    if (!variant) return res.status(StatusCodes.NOT_FOUND).json({ error: "We couldn't find that variant — it may have already been removed." });
    res.json({ ok: true });
  } catch (err) {
    sendError(res, err);
  }
});

export default router;
