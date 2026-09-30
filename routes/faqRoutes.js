import express from "express";
import { StatusCodes } from "http-status-codes";
import StorefrontConfig from "../models/StorefrontConfig.js";
import { requireSellerAuth } from "../middleware/auth.js";
import { sendError, check } from "../utils/validation.js";

const router = express.Router();

router.get("/store/:slug/faqs", async (req, res) => {
  try {
    const slug = String(req.params.slug || "").toLowerCase().trim();
    const config = await StorefrontConfig.findOne({ slug, is_active: true })
      .select("store_name slug faqs")
      .lean();
    if (!config) return res.status(StatusCodes.NOT_FOUND).json({ error: "We couldn't find this store. Please check the link." });
    res.json({ store_name: config.store_name, slug: config.slug, faqs: config.faqs || [] });
  } catch (err) {
    sendError(res, err);
  }
});

router.get("/seller/faqs", requireSellerAuth, async (req, res) => {
  try {
    const config = await StorefrontConfig.findOne({ seller_id: req.user.id }).select("faqs").lean();
    if (!config) return res.status(StatusCodes.NOT_FOUND).json({ error: "We couldn't find your store settings." });
    res.json({ faqs: config.faqs || [] });
  } catch (err) {
    sendError(res, err);
  }
});


router.put("/seller/faqs", requireSellerAuth, async (req, res) => {
  try {
    const faqs = Array.isArray(req.body.faqs) ? req.body.faqs : [];
    const cleaned = faqs
      .map((f) => ({
        question: String(f.question || "").trim(),
        answer: String(f.answer || "").trim(),
      }))
      .filter((f) => f.question && f.answer);

    check.maxCount(cleaned, 100, "FAQs");

    const config = await StorefrontConfig.findOneAndUpdate(
      { seller_id: req.user.id },
      { $set: { faqs: cleaned } },
      { new: true, runValidators: true }
    );
    if (!config) return res.status(StatusCodes.NOT_FOUND).json({ error: "We couldn't find your store settings." });
    res.json({ faqs: config.faqs });
  } catch (err) {
    sendError(res, err);
  }
});

export default router;
