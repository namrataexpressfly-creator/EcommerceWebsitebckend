
import express from "express";
import { StatusCodes } from "http-status-codes";
import Banner from "../models/Banner.js";
import { requireSellerAuth, requireKycApproved } from "../middleware/auth.js";
import { sendError, check } from "../utils/validation.js";

const router = express.Router();

const MAX_BANNERS = 5;
const TITLE_MAX = 40;
const SUBTITLE_MAX = 80;

router.get("/store/:slug/banners", async (req, res) => {
  try {
    const banners = await Banner.find({ store_slug: req.params.slug, is_active: true })
      .sort({ order: 1 })
      .limit(MAX_BANNERS)
      .select("image_url title subtitle link_url order");
    res.json(banners);
  } catch (err) {
    sendError(res, err);
  }
});

router.get("/seller/banners", requireSellerAuth, async (req, res) => {
  try {
    const banners = await Banner.find({ seller_id: req.user.id, is_active: true }).sort({ order: 1 });
    res.json(banners);
  } catch (err) {
    sendError(res, err);
  }
});

router.post("/seller/banners", requireSellerAuth, requireKycApproved, async (req, res) => {
  try {
    const { image_url, title, subtitle, link_url } = req.body;
    check.required(image_url, "an image for the slide");
    check.required(title, "a title for the slide");
    check.maxLength(title, TITLE_MAX, "The slide title");
    check.maxLength(subtitle, SUBTITLE_MAX, "The slide subtitle");

    const count = await Banner.countDocuments({ seller_id: req.user.id, is_active: true });
    if (count >= MAX_BANNERS) {
      return res
        .status(StatusCodes.BAD_REQUEST)
        .json({ error: `You can only have up to ${MAX_BANNERS} slides. Remove one to add another.` });
    }

    const banner = await Banner.create({
      seller_id: req.user.id,
      store_slug: req.user.store_slug,
      image_url,
      title,
      subtitle: subtitle || "",
      link_url: link_url || "",
      order: count,
    });
    res.status(StatusCodes.CREATED).json(banner);
  } catch (err) {
    sendError(res, err);
  }
});


router.patch("/seller/banners/:id", requireSellerAuth, requireKycApproved, async (req, res) => {
  try {
    const allowed = ["image_url", "title", "subtitle", "link_url", "order"];
    const updates = {};
    for (const key of allowed) {
      if (req.body[key] !== undefined) updates[key] = req.body[key];
    }
    if (updates.title !== undefined) check.required(updates.title, "a title for the slide");
    if (updates.image_url !== undefined) check.required(updates.image_url, "an image for the slide");
    if (updates.title !== undefined) check.maxLength(updates.title, TITLE_MAX, "The slide title");
    if (updates.subtitle !== undefined) check.maxLength(updates.subtitle, SUBTITLE_MAX, "The slide subtitle");

    const banner = await Banner.findOneAndUpdate(
      { _id: req.params.id, seller_id: req.user.id },
      { $set: updates },
      { new: true }
    );
    if (!banner) return res.status(StatusCodes.NOT_FOUND).json({ error: "We couldn't find that slide — it may have already been removed." });
    res.json(banner);
  } catch (err) {
    sendError(res, err);
  }
});


router.delete("/seller/banners/:id", requireSellerAuth, async (req, res) => {
  try {
    const banner = await Banner.findOneAndUpdate(
      { _id: req.params.id, seller_id: req.user.id },
      { $set: { is_active: false } },
      { new: true }
    );
    if (!banner) return res.status(StatusCodes.NOT_FOUND).json({ error: "We couldn't find that slide — it may have already been removed." });
    res.json({ ok: true });
  } catch (err) {
    sendError(res, err);
  }
});

export default router;