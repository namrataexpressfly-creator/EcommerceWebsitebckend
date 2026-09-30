import express from "express";
import { StatusCodes } from "http-status-codes";
import Coupon from "../models/Coupon.js";
import { requireSellerAuth, requireKycApproved } from "../middleware/auth.js";
import { sendError, check } from "../utils/validation.js";

const router = express.Router();
router.use(requireSellerAuth);

function checkCouponLimits(b) {
  const isSet = (v) => v !== undefined && v !== null && v !== "";
  if (isSet(b.min_order_value)) check.positiveNumber(b.min_order_value, "Minimum order value");
  if (isSet(b.usage_limit)) check.positiveNumber(b.usage_limit, "Usage limit");
}

router.get("/", async (req, res) => {
  const coupons = await Coupon.find({ seller_id: req.user.id }).sort({ created_at: -1 });
  res.json(coupons);
});

router.post("/", requireKycApproved, async (req, res) => {
  try {
    const { code, discount_type, discount_value, applies_to, product_ids, category_ids } = req.body;
    check.required(code, "a coupon code");
    checkCouponLimits(req.body);
    if (discount_type) check.oneOf(discount_type, ["percentage", "flat"], "Discount type");
    if (discount_value !== undefined) {
      discount_type === "percentage"
        ? check.percentage(discount_value, "Discount percentage")
        : check.positiveNumber(discount_value, "Discount amount");
    }
    if (applies_to === "products" && !(product_ids || []).length) {
      return res.status(StatusCodes.BAD_REQUEST).json({ error: "Pick at least one product for this coupon to apply to." });
    }
    if (applies_to === "category" && !(category_ids || []).length) {
      return res.status(StatusCodes.BAD_REQUEST).json({ error: "Pick at least one category for this coupon to apply to." });
    }
    const coupon = await Coupon.create({ ...req.body, code: String(code).trim().toUpperCase(), seller_id: req.user.id });
    res.status(StatusCodes.CREATED).json(coupon);
  } catch (err) {
    sendError(res, err);
  }
});

router.put("/:id", requireKycApproved, async (req, res) => {
  try {
    checkCouponLimits(req.body);
    if (req.body.discount_type) check.oneOf(req.body.discount_type, ["percentage", "flat"], "Discount type");
    if (req.body.discount_value !== undefined) {
      req.body.discount_type === "percentage"
        ? check.percentage(req.body.discount_value, "Discount percentage")
        : check.positiveNumber(req.body.discount_value, "Discount amount");
    }
    if (req.body.applies_to === "products" && !(req.body.product_ids || []).length) {
      return res.status(StatusCodes.BAD_REQUEST).json({ error: "Pick at least one product for this coupon to apply to." });
    }
    if (req.body.applies_to === "category" && !(req.body.category_ids || []).length) {
      return res.status(StatusCodes.BAD_REQUEST).json({ error: "Pick at least one category for this coupon to apply to." });
    }
    const coupon = await Coupon.findOneAndUpdate({ _id: req.params.id, seller_id: req.user.id }, { $set: req.body }, { new: true, runValidators: true });
    if (!coupon) return res.status(StatusCodes.NOT_FOUND).json({ error: "We couldn't find that coupon — it may have already been removed." });
    res.json(coupon);
  } catch (err) {
    sendError(res, err);
  }
});

router.delete("/:id", async (req, res) => {
  try {
    const coupon = await Coupon.findOneAndUpdate(
      { _id: req.params.id, seller_id: req.user.id },
      { $set: { is_active: false } },
      { new: true }
    );
    if (!coupon) return res.status(StatusCodes.NOT_FOUND).json({ error: "We couldn't find that coupon — it may have already been removed." });
    res.json({ ok: true });
  } catch (err) {
    sendError(res, err);
  }
});

export default router;
