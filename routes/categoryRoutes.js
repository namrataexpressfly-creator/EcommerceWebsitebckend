import express from "express";
import { StatusCodes } from "http-status-codes";
import Category from "../models/Category.js";
import { requireSellerAuth, requireKycApproved } from "../middleware/auth.js";
import { sendError, check } from "../utils/validation.js";

const router = express.Router();

router.get("/", requireSellerAuth, async (req, res) => {
  const categories = await Category.find({ seller_id: req.user.id, is_active: true }).sort({ created_at: -1 });
  res.json(categories);
});

router.post("/", requireSellerAuth, requireKycApproved, async (req, res) => {
  try {
    const { name, slug, description, image_url } = req.body;
    check.required(name, "a category name");
    const category = await Category.create({ seller_id: req.user.id, name, slug, description, image_url: image_url || "" });
    res.status(StatusCodes.CREATED).json(category);
  } catch (err) {
    sendError(res, err);
  }
});

router.put("/:id", requireSellerAuth, requireKycApproved, async (req, res) => {
  try {
    if (req.body.name !== undefined) check.required(req.body.name, "a category name");
    const category = await Category.findOneAndUpdate(
      { _id: req.params.id, seller_id: req.user.id },
      { $set: req.body },
      { new: true, runValidators: true }
    );
    if (!category) return res.status(StatusCodes.NOT_FOUND).json({ error: "We couldn't find that category — it may have already been removed." });
    res.json(category);
  } catch (err) {
    sendError(res, err);
  }
});


router.delete("/:id", requireSellerAuth, async (req, res) => {
  try {
    const category = await Category.findOneAndUpdate(
      { _id: req.params.id, seller_id: req.user.id },
      { $set: { is_active: false } },
      { new: true }
    );
    if (!category) return res.status(StatusCodes.NOT_FOUND).json({ error: "We couldn't find that category — it may have already been removed." });
    res.json({ ok: true });
  } catch (err) {
    sendError(res, err);
  }
});

export default router;
